import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from 'electron'
// import { nativeTheme, type Rectangle } from 'electron' // нужно, если включить getEffectiveTheme/getViewScreenBounds ниже
import { join, dirname } from 'path'
import { promises as fs } from 'fs'
import { nanoid } from 'nanoid'
import { BridgeServer } from '@web-to-figma/bridge-protocol/server'
import {
  createMessage,
  type ApplyStylesMessage,
  type ErrorMessage,
  type ImportNodeMessage,
  type PlaceAssetMessage,
  type ResponseMessage,
  type ThemeSyncMessage
} from '@web-to-figma/bridge-protocol'
import { createConsoleLogger } from '@web-to-figma/shared'
import { BrowserController, isSearchQueryUrl, normalizeUrlInput } from './browser'
import { attachEditContextMenu } from './contextMenu'
import { ElementPicker } from './inspector'
import { RecentSitesStore } from './recentSites'
import { ProjectsStore } from './projects'
import { ReferenceItemsStore, referenceSiteKey } from './referenceItems'
import { StandaloneReferenceSitesStore } from './standaloneReferenceSites'
import { OverlayController } from './overlay'
import { scanPageAssets } from './assetScanner'
import { captureComponentDocument, captureComponentPreviewsOffscreen, scanPageComponents } from './componentScanner'
import { registerAutoUpdater, scheduleUpdateChecks } from './autoUpdater'
import type {
  AppSettings,
  ApplyStylesResult,
  ApplyStylesTargets,
  AssetScanResult,
  ComponentScanResult,
  ComponentPreviewResult,
  BridgeInfo,
  ColorMatchSource,
  ImportResult,
  ImportProgressEvent,
  OverlaySize,
  PickState,
  PopoverOpenParams,
  CreateProjectInput,
  Project,
  ProjectsSnapshot,
  QueueImportResult,
  QueueItemSummary,
  RecentSite,
  ReferenceItem,
  ReferenceSessionState,
  ScannedAsset,
  ScannedComponent,
  SelectionResult,
  StandaloneReferenceSite,
  TabsSnapshot,
  ViewBounds
} from '../shared/types'

// Явно, а не полагаясь на автоопределение по package.json (у scoped-имени
// "@web-to-figma/desktop" оно ненадёжно) — фиксирует путь app.getPath('userData')
// независимо от того, как запущен процесс (electron-vite dev / packaged build).
app.setName('web-to-figma')
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9333')
  // Позволяет подключаться DevTools-фронтендом извне localhost (по умолчанию
  // Chromium режектит WebSocket не с того же origin) — временно для живой
  // отладки верстки через CDP, только в dev.
  app.commandLine.appendSwitch('remote-allow-origins', '*')
}

const isDev = !app.isPackaged
const log = createConsoleLogger('main')

const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'system',
  themeId: 'default',
  customThemes: [],
  useMatchedTextStyles: false,
  useMatchedColorStyles: false,
  colorMatchSource: 'style',
  alsoCreateInstance: false,
  themeSyncEnabled: true,
  fullscreenMode: 'push',
  referenceNamePromptOnAdd: false,
  // Прежнее хардкод-поведение (см. AppSettings.captureViewport докстринг) —
  // ничего не меняется для существующих пользователей, пока не тронут
  // настройку сами.
  captureViewport: { forced: true, width: 1440, height: 900 },
  // Включено по умолчанию — прямо чинит жалобу пользователя ("длинные
  // блоки в миниатюре захватывает не полностью"), а не только опция для
  // тех, кто явно попросит.
  captureFullBlockThumbnail: true,
  // false — сохраняет прежнее поведение (см. AppSettings.sidePanelsHoverReveal
  // докстринг), опция для тех, кто явно включит.
  sidePanelsHoverReveal: false
}

interface BridgeSecret {
  token: string
  port: number | null
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

// Кастомный hover-тултип picker'а временно отключён (см. inspector.ts) —
// эти два хелпера ему и служили, оставлены закомментированными, не удалены.
//
// /** Та же логика 'system' → light/dark, что резолвит renderer через
//  *  prefers-color-scheme (ThemeProvider), но со стороны main для инжекта
//  *  темизированного hover-тултипа picker'а (hoverTooltip.ts), у которого нет
//  *  доступа к CSS инспектируемой страницы. */
// async function getEffectiveTheme(): Promise<'light' | 'dark'> {
//   const saved = await readJson<Partial<AppSettings>>(settingsPath())
//   const mode = saved?.themeMode ?? DEFAULT_SETTINGS.themeMode
//   return mode === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : mode
// }
//
// /** Экранный (не оконный) прямоугольник WebContentsView браузера — для
//  *  сопоставления screen.getCursorScreenPoint() с координатами страницы
//  *  (см. inspector.ts pollHover). */
// function getViewScreenBounds(): Rectangle | null {
//   if (!mainWindow || !browserController) return null
//   const viewBounds = browserController.getBounds()
//   if (!viewBounds) return null
//   const winBounds = mainWindow.getContentBounds()
//   return { x: winBounds.x + viewBounds.x, y: winBounds.y + viewBounds.y, width: viewBounds.width, height: viewBounds.height }
// }

function bridgeSecretPath(): string {
  return join(app.getPath('userData'), 'bridge.json')
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8')
}

/** Токен переживает перезапуски приложения — см. docs/bridge-protocol.md §Session token. */
async function loadOrCreateBridgeSecret(): Promise<BridgeSecret> {
  const existing = await readJson<BridgeSecret>(bridgeSecretPath())
  if (existing?.token) return existing
  const secret: BridgeSecret = { token: nanoid(24), port: null }
  await writeJson(bridgeSecretPath(), secret)
  return secret
}

let mainWindow: BrowserWindow | null = null
let bridgeServer: BridgeServer | null = null
let latestPluginTheme: ThemeSyncMessage | null = null
let bridgeInfo: BridgeInfo = { port: 0, pairingToken: '', connectionCount: 0 }
let browserController: BrowserController | null = null
// Второй, независимый встроенный браузер (по коррекции пользователя — "Открыть
// браузер" на странице референс-сайта НЕ должен переходить на вкладку
// "Браузер"/раздвигать её; вместо этого прямо в References встраивается
// отдельный вьюпорт, без нижней панели Ассеты/Компоненты, с собственными
// вкладками). BrowserController не держит singleton-состояния сам по себе
// (см. класс) — второй инстанс безопасен, монтируется ЛЕНИВО (см.
// mountReferenceBrowser) при первом reference:session-start, а не сразу при
// старте окна (обычно референсы вообще не открываются в сессии).
let referenceBrowserController: BrowserController | null = null
let referenceBrowserViewportBounds: ViewBounds | null = null
let elementPicker: ElementPicker | null = null
let overlayController: OverlayController | null = null
const componentPreviewJobs = new Map<string, symbol>()
let importProgressSequence = 0
// Отмена импорта (по запросу пользователя) — ключ AbortController'ом по id
// прогресса (тот же id, что уходит в renderer через import:progress), не
// единственным "текущим" — очередь мульти-импорта может держать несколько
// параллельно. `bridgeServer.request()` не умеет по-настоящему прервать уже
// отправленный запрос (нет abort-параметра, см. packages/bridge-protocol) —
// withCancel ниже гонится с этим сигналом и отклоняет ПРОМИС раньше, реальный
// ответ от Figma (если всё же придёт) просто игнорируется дальше по цепочке.
const importCancelHandles = new Map<string, AbortController>()

class ImportCancelledError extends Error {
  constructor() {
    super('Импорт отменён')
  }
}

function withCancel<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ImportCancelledError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new ImportCancelledError())
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      }
    )
  })
}

function createImportProgress(
  label: string,
  total = 1
): {
  update: (phase: ImportProgressEvent['phase'], progress: number, detail?: string, current?: number) => void
  finish: (ok: boolean, detail?: string) => void
  id: string
  signal: AbortSignal
} {
  const id = `import-${Date.now()}-${++importProgressSequence}`
  const controller = new AbortController()
  importCancelHandles.set(id, controller)
  const emit = (event: Omit<ImportProgressEvent, 'id' | 'label' | 'total'>): void => {
    const payload = { id, label, total, ...event } satisfies ImportProgressEvent
    mainWindow?.webContents.send('import:progress', payload)
    // Дублируем в 'picker' — тот единственный слой, который постоянно виден
    // НАД браузером в ЛЮБОМ режиме, включая полноэкранный (см. OverlayRoot.tsx
    // докстринг) — по жалобе пользователя, в fullscreen прогресс в главном
    // окне (обычная HTML-плашка ПОД нативным browser-вьюпортом) не виден
    // вообще, тулбар там скрыт.
    overlayController?.send('picker', 'import:progress', payload)
  }
  emit({ state: 'running', phase: 'preparing', progress: 0, detail: 'Подготовка…' })
  return {
    id,
    signal: controller.signal,
    update: (phase, progress, detail, current) =>
      emit({
        state: 'running',
        phase,
        progress: Math.max(0, Math.min(1, progress)),
        ...(detail ? { detail } : {}),
        ...(current !== undefined ? { current } : {})
      }),
    finish: (ok, detail) => {
      importCancelHandles.delete(id)
      emit({
        state: ok ? 'success' : 'error',
        phase: 'complete',
        progress: 1,
        detail: detail ?? (ok ? 'Готово' : 'Ошибка')
      })
    }
  }
}

// Отступ снизу — тот же 16px, что раньше был в CSS `.picker-float-bar{bottom:16px}`.
// Ширина/высота — стартовая оценка ДО первого `overlay:report-size` от
// рендерера (просто сама пилюля, без раскрытого попапа и без длинной подписи
// статуса пикера) — ЖИВОЙ БАГ, если оставить как константу: реальный контент
// (напр. подпись "Кликните на элемент страницы") бывает шире изначальной
// оценки, а bounds WebContentsView — это реальный размер холста, не auto-fit
// HTML-контейнер, так что то, что не влезло, физически обрезалось/скроллилось
// внутри фиксированных bounds. Обе оценки — временные, тут же перезаписываются
// первым же `overlay:report-size`.
// +48 (2×SHADOW_MARGIN, см. ниже) к голым размерам пилюли — стартовая оценка
// тоже должна учитывать паддинг под тень, иначе первый кадр до первого
// overlay:report-size короткой вспышкой обрезал бы тень так же, как и до
// этого фикса.
const TOOLBAR_WIDTH_GUESS = 140 + 48
const TOOLBAR_HEIGHT_GUESS = 48 + 48
// Визуальный зазор от низа браузера до самой пилюли/попапа — то, что
// пользователь реально видит как "отступ". Ниже он используется НЕ напрямую
// (см. TOOLBAR_BOTTOM_GAP) — минусуется на SHADOW_MARGIN, см. тот докстринг.
const TOOLBAR_VISUAL_BOTTOM_GAP = 16
// `.overlay-toolbar-stack` в CSS обёрнут паддингом на этот отступ со всех
// сторон (см. styles.css) — WebContentsView клипает контент СТРОГО по своим
// bounds, а box-shadow (var(--shadow), blur 20px + offset 6px) рендерится ЗА
// пределами border-box элемента; без запаса тень обрезалась прямым углом
// (живой баг, пойман пользователем на скриншоте). Раз паддинг — часть того
// же `.overlay-toolbar-stack`, что мы измеряем ResizeObserver'ом, репортится
// он автоматически (входит в getBoundingClientRect); по X это ничего не
// меняет (паддинг симметричный, центрирование остаётся верным само собой),
// а по Y нужно скорректировать нижний якорь на ту же величину, иначе
// видимая пилюля просто отъехала бы вверх на SHADOW_MARGIN лишних пикселей
// (см. TOOLBAR_BOTTOM_GAP ниже).
const SHADOW_MARGIN = 24
const TOOLBAR_BOTTOM_GAP = TOOLBAR_VISUAL_BOTTOM_GAP - SHADOW_MARGIN

/** Лимит узлов для "Импортировать страницу целиком" — заметно выше обычного
 *  MAX_NODES=400 в domSnapshot.ts (тот рассчитан на один выбранный элемент,
 *  а не на весь <body>), см. комментарий у `inspector:import-full-page`. */
const FULL_PAGE_MAX_NODES = 6000
/** Таймаут bridge-запроса именно для полного импорта страницы — сильно
 *  больше дефолтных 10с (REQUEST_TIMEOUT_MS), см. комментарий у
 *  `bridgeServer.request(message, FULL_PAGE_IMPORT_TIMEOUT_MS)` ниже. */
const FULL_PAGE_IMPORT_TIMEOUT_MS = 120_000

/**
 * Плавающий тулбар (pick/import/apply-to-selection) теперь ПОСТОЯННО живёт в
 * overlay-слое (по запросу пользователя — раньше сидел в HTML-полосе,
 * специально вырезанной снизу из bounds браузера, из-за чего сам браузер не
 * доходил до низа окна; см. renderer/styles.css до этого коммита). Больше не
 * "один попап, открытый по запросу с явным anchorTop от кнопки" (старое
 * `overlayKind`/`overlayGeometry`/`overlay:open` — Apply to Selection теперь
 * просто ЛОКАЛЬНЫЙ React state внутри самого overlay-рендерера, см.
 * OverlayRoot.tsx, никакого IPC-таргетирования "какой попап" не нужно), а
 * якорь всегда один — низ ТЕКУЩЕГО browser-viewport (см. browserViewportBounds
 * ниже, обновляется на каждый `browser:set-bounds`). И ширина, И высота
 * измеряются overlay-рендерером (ResizeObserver на `.overlay-toolbar-stack`,
 * см. OverlayRoot.tsx) и репортятся сюда через `overlay:report-size` —
 * контент сам решает, сколько места ему нужно (пилюля / раскрытый Apply to
 * Selection popover / длинная подпись статуса пикера), а не подгоняется под
 * заранее угаданную константу.
 */
let browserViewportBounds: ViewBounds | null = null
let toolbarOverlayWidth = TOOLBAR_WIDTH_GUESS
let toolbarOverlayHeight = TOOLBAR_HEIGHT_GUESS
// Overlay — второй WebContentsView, рисуется НАД ВСЕМ окном (включая
// HTML-модалки главного renderer'а вроде AssetLightbox, см. main/browser.ts
// class-docstring про порядок addChildView) — usePopoverVisibility.ts
// (renderer) прячет только нативный БРАУЗЕР этим же паттерном-счётчиком, но
// overlay-тулбар не имеет к нему отношения и продолжал бы плавать поверх
// полноэкранной модалки (живой баг, пойман пользователем на скриншоте:
// тулбар рисуется над просмотрщиком ассетов). Отдельный флаг вместо просто
// hide() — repositionToolbarOverlay() дергается на каждый resize/report-size
// и должен ЗНАТЬ, что показывать снова не нужно, пока модалка открыта.
let overlaySuppressed = false

/** Ленивый монтаж второго встроенного браузера (см. referenceBrowserController
 *  докстринг) — вызывается из reference:session-start, не из createWindow():
 *  большинство сессий вообще не заходят в референсы, заводить второй набор
 *  WebContentsView заранее незачем. `onNavigate`/`onFocus` у главного
 *  браузера намеренно не дублируются — recentSites/collapse-popover
 *  семантика этому режиму не нужна (см. план). */
function mountReferenceBrowser(): BrowserController | null {
  if (referenceBrowserController) return referenceBrowserController
  if (!mainWindow) return null
  referenceBrowserController = new BrowserController(mainWindow, (snapshot: TabsSnapshot) => {
    mainWindow?.webContents.send('reference-browser:tabs', snapshot)
    // Уточняет title/favicon сайта без проекта постфактум (см.
    // StandaloneReferenceSitesStore.updateMeta докстринг) — та же логика,
    // что RecentSitesStore получает от главного браузера, тут нужна только
    // для стандэлон-референсов: у привязанных к проекту title/favicon и так
    // захвачены один раз при добавлении (см. main/projects.ts addSite).
    if (referenceSession && !referenceSession.projectId) {
      for (const tab of snapshot.tabs) {
        if (tab.url === referenceSession.siteUrl) {
          void standaloneReferenceSitesStore.updateMeta(tab.url, { title: tab.title, faviconUrl: tab.faviconUrl })
        }
      }
    }
  })
  // НЕ .mount() (то грузит стартовую страницу) — вызывающая сторона
  // (reference:session-start) сразу создаёт вкладку с РЕАЛЬНЫМ url. Раньше
  // тут сначала грузилась стартовая страница, а следом (той же наносекундой)
  // прилетал .navigate(siteUrl) поверх ещё не начавшего загружаться
  // предыдущего loadURL — гонка из двух почти одновременных loadURL на
  // свежесозданном webContents, живой баг, поймал пользователь ("сайты не
  // загружаются", воспроизводилось нестабильно — именно гонка, не постоянная
  // поломка).
  return referenceBrowserController
}

function repositionToolbarOverlay(): void {
  // overlaySuppressed следует за activeView главного окна ('browser' vs
  // 'references', см. App.tsx Shell) и не знает про embedded-режим сбора
  // референсов (activeView там всё ещё 'references', suppressed=true) —
  // референс-сессия ИГНОРИРУЕТ этот флаг целиком, а не пытается им
  // координироваться (никакой гонки между двумя независимыми источниками
  // правды: пока референс-сессия активна, ей просто не мешает то, что
  // Shell-эффект думает про обычный браузер).
  if (overlaySuppressed && !referenceSession) {
    overlayController?.hide('picker')
    return
  }
  // Референс-сессия переносит плавающий тулбар пикера на встроенный
  // референс-браузер вместо главного — тот же ОДИН 'picker' слой, просто
  // другой якорь, а не второй тулбар.
  const bounds = referenceSession ? referenceBrowserViewportBounds : browserViewportBounds
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    overlayController?.hide('picker')
    return
  }
  // Не шире самой браузерной области — иначе при очень узком окне тулбар
  // вылезал бы за его пределы вместо того, чтобы хотя бы прижаться к краям.
  const width = Math.min(toolbarOverlayWidth, bounds.width)
  const x = Math.round(bounds.x + bounds.width / 2 - width / 2)
  const anchorBottom = bounds.y + bounds.height - TOOLBAR_BOTTOM_GAP
  overlayController?.setBounds('picker', {
    x,
    y: Math.round(anchorBottom - toolbarOverlayHeight),
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(toolbarOverlayHeight))
  })
}

// Generic popover overlay ('popover' слой) — anchor в тех же window-relative
// координатах, что и browserViewportBounds (renderer шлёт getBoundingClientRect()
// своей кнопки, см. AddToProjectButton.tsx). Гэп/угадываемый начальный размер —
// тот же смысл, что TOOLBAR_*_GUESS/TOOLBAR_VISUAL_BOTTOM_GAP выше, только для
// попапа, открывающегося ВНИЗ-ВПРАВО от кнопки (как обычный dropdown), а не
// центрированного снизу браузера.
const POPOVER_GAP = 6
const POPOVER_WIDTH_GUESS = 260
const POPOVER_HEIGHT_GUESS = 120
let popoverAnchor: ViewBounds | null = null
let popoverSize: OverlaySize = { width: POPOVER_WIDTH_GUESS, height: POPOVER_HEIGHT_GUESS }

function repositionPopoverOverlay(): void {
  if (!popoverAnchor || !mainWindow) return
  const winBounds = mainWindow.getContentBounds()
  const width = Math.min(popoverSize.width, winBounds.width)
  const height = Math.min(popoverSize.height, winBounds.height)
  // Открывается вниз-вправо от якоря, прижатый правым краем к правому краю
  // якоря (тот же 'down'-плейсмент, что у обычного Popover.tsx) — если снизу
  // не влезает, переворачивается вверх от якоря.
  let x = Math.round(popoverAnchor.x + popoverAnchor.width - width)
  x = Math.max(0, Math.min(x, winBounds.width - width))
  const spaceBelow = winBounds.height - (popoverAnchor.y + popoverAnchor.height)
  const openUp = spaceBelow < height + POPOVER_GAP && popoverAnchor.y > height + POPOVER_GAP
  const y = openUp ? Math.round(popoverAnchor.y - POPOVER_GAP - height) : Math.round(popoverAnchor.y + popoverAnchor.height + POPOVER_GAP)
  overlayController?.setBounds('popover', { x, y: Math.max(0, y), width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) })
}

function closePopoverOverlay(): void {
  if (!popoverAnchor) return
  popoverAnchor = null
  overlayController?.hide('popover')
  mainWindow?.webContents.send('overlay:popover-closed', undefined)
}

/** Ref-count с задержкой на закрытие — по запросу пользователя, "float" режим
 *  distraction-free (см. App.tsx Workspace, AppSettings.fullscreenMode). Два
 *  НЕЗАВИСИМЫХ источника наведения на одну и ту же плавающую панель: тонкая
 *  полоска-край в главном окне ('strip') и сам плавающий overlay-слой панели
 *  ('content', см. PanelOverlayRoot.tsx) — они живут в РАЗНЫХ webContents, не
 *  могут делить один React-хук с таймером, как это делает push-режим
 *  (useEdgeReveal). Панель остаётся открытой, пока ХОТЯ БЫ один источник её
 *  держит; закрывается с той же задержкой, что и useEdgeReveal (см. её
 *  докстринг про анти-flicker на стыке полоски/панели), только теперь считая
 *  источники, а не строя один общий таймер. */
function createHoverGate(onChange: (open: boolean) => void): { enter: () => void; leave: () => void; forceClose: () => void } {
  let sources = 0
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  return {
    enter: () => {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
      sources++
      if (sources === 1) onChange(true)
    },
    leave: () => {
      sources = Math.max(0, sources - 1)
      if (sources === 0) {
        hideTimer = setTimeout(() => onChange(false), 200)
      }
    },
    // Панель закрепили (см. AppSettings — pin, по запросу пользователя "в
    // любом полноэкранном режиме") — в float-режиме закреплённая панель
    // переключается на inline-показ (см. App.tsx effectiveLeftOpen), плавающий
    // слой больше не нужен НЕЗАВИСИМО от того, сколько источников наведения
    // всё ещё "держат" его технически (курсор мог остаться на полоске/панели)
    // — закрываем сразу, без задержки, и сбрасываем счётчик.
    forceClose: () => {
      sources = 0
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
      onChange(false)
    }
  }
}

// Плавающие панели ('panel-left'/'panel-right'/'panel-top' слои) — второй
// режим distraction-free (см. AppSettings.fullscreenMode 'float'),
// альтернатива push/resize: панель рисуется НАД browser-pane в отдельном
// overlay-слое, а не раздвигает его. Фиксированный размер (не resizable, в
// отличие от push-режима — там ширину/высоту меряет сам Workspace/BrowserPane)
// — сознательно упрощено для v1, см. PLAN addendum. 'left'/'right' — от низа
// тулбара до низа окна на всю доступную высоту; 'top' — вкладки+адресная
// строка браузера (см. BrowserPane.tsx), позиционируется НАД
// browserViewportBounds (см. browser:set-bounds ниже — тот же прямоугольник,
// что главное окно репортит для нативного browser-пейна), а не НАД всем
// окном — иначе перекрывал бы левую/правую колонки, если те открыты.
// 'references-left' — левый сайдбар вкладки "Референсы" во float-режиме (по
// запросу пользователя, "боковые панели в референс режиме всё равно не
// флоат") — ОТДЕЛЬНЫЙ overlay-слой от 'left' (тот жёстко показывает
// LeftSidebar основного браузера), а не тот же самый слой с переключением
// контента: hover-gate для 'left' привязан к leftReveal основного Workspace,
// который вообще не смотрит на активную вкладку верхнего уровня — если бы
// один слой показывал то LeftSidebar, то ReferencesSidebar по какому-то
// внешнему признаку, пришлось бы либо дублировать вообще все left/right
// hover-триггеры под обе вкладки, либо городить синхронизацию между Workspace
// и ReferencesView, которых сейчас нет и не должно появляться ради этого.
// Правая колонка (галерея референсов) НЕ переведена на float в этом заходе —
// ReferenceItemsPanel зависит от ТЕКУЩЕГО выбранного сайта (selectedSite),
// это React state ReferencesView.tsx, а не статический список типа проектов;
// синхронизировать его в отдельный overlay-рендерер (новый IPC bounce на
// каждое изменение выбора) - отдельная, более крупная задача, левая панель
// (просто навигация — проекты/сайты, ReferencesSidebar и так почти
// самодостаточна) оказалась посильной именно потому, что ей нужно
// синхронизировать только ДВА исходящих действия (клик по сайту/сайту без
// проекта), а не входящее состояние.
type PanelSide = 'left' | 'right' | 'top' | 'references-left' | 'references-right'
const PANEL_WIDTH: Record<'left' | 'right' | 'references-left' | 'references-right', number> = {
  left: 280,
  right: 380,
  'references-left': 280,
  'references-right': 380
}
// Какая вкладка верхнего уровня активна СЕЙЧАС (см. App.tsx Shell
// activeView) — нужно ТОЛЬКО чтобы hover-gate левой колонки знал, какой
// overlay-слой открывать ('left' или 'references-left'), см. leftPanelGate
// ниже. Обновляется через app:set-active-view (зовёт App.tsx при каждой
// смене вкладки), больше нигде не читается.
let activeTopView: 'browser' | 'references' = 'browser'
// 10px — тот же отступ, что и padding у .workspace в push-режиме (см.
// components.css) — раньше было 52 (с запасом "под тулбар", когда top-панель
// ещё не была плавающей отдельным слоем): пользователь явно попросил поднять
// все три плавающие панели ближе к краю окна (скрин — стрелка вверх на левой
// панели, "можно растянуть боковые панели наверх"), единая константа держит
// left/right/top визуально согласованными автоматически.
const PANEL_TOP = 10
const BROWSER_TOP_BAR_HEIGHT = 84

function repositionPanelOverlay(side: PanelSide): void {
  if (!mainWindow) return
  const winBounds = mainWindow.getContentBounds()
  if (side === 'top') {
    // y: PANEL_TOP (не вычитание BROWSER_TOP_BAR_HEIGHT из bounds.y) — в
    // float top-режиме сам bounds.y мал (там теперь только тонкая полоска
    // ревила, а не полноразмерный тулбар, см. BrowserPane.tsx isTopFloat),
    // так что старая формула почти всегда уходила в отрицательные значения
    // и клэмпилась в 0 — плавающая панель садилась вплотную к краю окна, БЕЗ
    // отступа, в отличие от left/right (те всегда начинаются с PANEL_TOP).
    // Единый отступ — жалоба пользователя на скриншоте, "разные отступы от
    // верхнего края".
    // Пока виден встроенный референс-браузер, а не основной (см.
    // referenceBrowserVisible докстринг — шире просто активной сессии сбора,
    // покрывает и "поиск сайта"), плавающая top-панель должна
    // позиционироваться над ЕГО viewport'ом, иначе легла бы на координаты
    // основного браузера (который сейчас вообще не отрисован) — живой баг,
    // поймал пользователь: "режим выбран поверх, а он почему-то раздвигает".
    const bounds = referenceBrowserVisible ? referenceBrowserViewportBounds : browserViewportBounds
    if (!bounds || bounds.width <= 0) return
    overlayController?.setBounds('panel-top', {
      x: Math.round(bounds.x),
      y: PANEL_TOP,
      width: Math.max(1, Math.ceil(bounds.width)),
      height: BROWSER_TOP_BAR_HEIGHT
    })
    return
  }
  const width = Math.min(PANEL_WIDTH[side], winBounds.width)
  const height = Math.max(0, winBounds.height - PANEL_TOP)
  const x = side === 'left' || side === 'references-left' ? 0 : Math.max(0, winBounds.width - width)
  overlayController?.setBounds(`panel-${side}`, { x, y: PANEL_TOP, width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) })
}

const panelVisible: Record<PanelSide, boolean> = {
  left: false,
  right: false,
  top: false,
  'references-left': false,
  'references-right': false
}

async function showPanelOverlay(side: PanelSide): Promise<void> {
  if (!mainWindow) return
  const id = `panel-${side}` as const
  if (!overlayController?.isMounted(id)) {
    // side уже закодирован в URL слоя (?overlay=panel-left/-right/-top, см.
    // main.tsx) — контенту не нужно отдельное сообщение "какую панель
    // рендерить", он просто монтируется один раз и дальше только меняются
    // bounds (тот же приём, что и у постоянно смонтированного 'picker' слоя).
    const devUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
    await overlayController?.mount(id, mainWindow, devUrl)
  }
  panelVisible[side] = true
  repositionPanelOverlay(side)
}

function hidePanelOverlay(side: PanelSide): void {
  panelVisible[side] = false
  overlayController?.hide(`panel-${side}`)
}

/** Клик в страницу браузера/переключение вида — тот же сигнал, что уже
 *  закрывает popover overlay (см. closePopoverOverlay) — закрывает и
 *  открытые плавающие панели, СРАЗУ, без задержки hover-gate (это не
 *  hover-уход, а явное "ушли из режима"). */
function closeAllPanelOverlays(): void {
  if (panelVisible.left) hidePanelOverlay('left')
  if (panelVisible.right) hidePanelOverlay('right')
  if (panelVisible.top) hidePanelOverlay('top')
  if (panelVisible['references-left']) hidePanelOverlay('references-left')
  if (panelVisible['references-right']) hidePanelOverlay('references-right')
}

const leftPanelGate = createHoverGate((open) => {
  const side: PanelSide = activeTopView === 'references' ? 'references-left' : 'left'
  if (open) void showPanelOverlay(side)
  else hidePanelOverlay(side)
})
const rightPanelGate = createHoverGate((open) => {
  // Тот же activeTopView-переключатель, что и у leftPanelGate (см. её
  // докстринг) — теперь и правая колонка "Референсов" (ReferenceItemsPanel)
  // умеет настоящий float, критично по требованию пользователя ("делай
  // float"), не push-only, как раньше.
  const side: PanelSide = activeTopView === 'references' ? 'references-right' : 'right'
  if (open) void showPanelOverlay(side)
  else hidePanelOverlay(side)
})
const topPanelGate = createHoverGate((open) => {
  if (open) void showPanelOverlay('top')
  else hidePanelOverlay('top')
})

const recentSites = new RecentSitesStore((list) => mainWindow?.webContents.send('recent-sites:updated', list))
const projectsStore = new ProjectsStore((snapshot) => mainWindow?.webContents.send('projects:updated', snapshot))
const referenceItemsStore = new ReferenceItemsStore((items) => mainWindow?.webContents.send('reference-items:updated', items))
const standaloneReferenceSitesStore = new StandaloneReferenceSitesStore((sites) =>
  mainWindow?.webContents.send('standalone-references:updated', sites)
)
/** QueueItem.id → уже созданный ReferenceItem.id, ТОЛЬКО для элементов,
 *  закоммиченных без миниатюры (офскрин-снимок ещё не успел, см.
 *  inspector.ts onItemThumbnailReady докстринг) — когда снимок всё-таки
 *  готов, patch'им сохранённый элемент задним числом и убираем запись. */
const pendingReferenceThumbnails = new Map<string, string>()
// Сессия сбора референс-элементов (по запросу пользователя) — держим ТУТ, а
// не в ElementPicker: тому нужен только голый siteKey для маршрутизации
// confirmQueueAdd (см. setReferenceMode), а title/projectId/url — это UI-
// метаданные для баннера/BottomPanel, ElementPicker про проекты знать не должен.
let referenceSession: ReferenceSessionState | null = null
function broadcastReferenceSession(): void {
  mainWindow?.webContents.send('reference:session-state', referenceSession)
  overlayController?.send('picker', 'reference:session-state', referenceSession)
  // 'panel-references-right' (плавающая правая колонка "Референсов", см.
  // rightPanelGate) рендерит ТОТ ЖЕ ReferenceItemsPanel, что и push-режим —
  // ему нужен ровно этот же referenceSession как проп `session`, а не
  // отдельное состояние: правая колонка и так видна ТОЛЬКО пока сессия
  // сбора активна (см. ReferencesView.tsx `collecting`), synchronизировать
  // больше нечего.
  overlayController?.send('panel-references-right', 'reference:session-state', referenceSession)
}

// Виден ли ПРЯМО СЕЙЧАС встроенный референс-браузер (а не основной) — шире,
// чем referenceSession !== null: "поиск сайта" (reference:browse-start,
// см. её докстринг) тоже показывает референс-браузер, но ЕЩЁ не заводит
// сессию сбора. Единственный источник правды для repositionPanelOverlay('top')
// и для 'panel-top' overlay-рендерера (см. BrowserTopBarOverlayContent.tsx) —
// какой из двух браузеров сейчас управлять/над чьим viewport'ом
// позиционироваться в float-режиме. Живой баг, поймал пользователь:
// "поверх" реально раздвигал вместо того, чтобы плавать — потому что раньше
// этого переключателя не было вовсе, ReferenceBrowserPane.tsx умел только push.
let referenceBrowserVisible = false
function setReferenceBrowserVisible(visible: boolean): void {
  if (referenceBrowserVisible === visible) return
  referenceBrowserVisible = visible
  overlayController?.send('panel-top', 'reference:browser-visible', visible)
  if (panelVisible.top) repositionPanelOverlay('top')
}

// Та же формула автоимени, что QueueConfirmCard.tsx/LeftSidebar.tsx уже
// используют для карточек очереди — третьей копии тут не избежать (main —
// отдельный рантайм от renderer, общий модуль сюда не дотянуть без сборки
// под оба таргета), но хотя бы не дублируется ВНУТРИ этого файла.
function queueItemLabel(element: { tag: string; id: string | null; classes: string[] }): string {
  if (element.id) return `${element.tag}#${element.id}`
  if (element.classes[0]) return `${element.tag}.${element.classes[0]}`
  return element.tag
}

function referenceItemInputFromQueueItem(
  item: { id: string; result: SelectionResult; thumbnail?: string; tabId: string; backendNodeId: number; sourceUrl: string },
  session: ReferenceSessionState
): Omit<ReferenceItem, 'id' | 'createdAt' | 'sentToFigmaAt'> {
  return {
    siteKey: referenceSiteKey(session.projectId, session.siteUrl),
    projectId: session.projectId,
    siteUrl: session.siteUrl,
    element: item.result.element,
    thumbnail: item.thumbnail,
    name: queueItemLabel(item.result.element),
    tabId: item.tabId,
    backendNodeId: item.backendNodeId,
    sourceUrl: item.sourceUrl
  }
}

/** Скриншот вкладки при добавлении сайта в проект как "референс" (по запросу
 *  пользователя — карточка референса в галерее должна иметь превью). Только
 *  для kind:'reference', не на каждый визит (см. projects:add-site ниже) —
 *  та же логика "не дёргаем compositor сайта лишний раз", что и в
 *  componentScanner.ts. Electron NativeImage.resize/toJPEG — тот же способ,
 *  что captureElementPreviewOffscreen там же использует, без внешней sharp. */
const THUMBNAIL_MAX_WIDTH = 480
/** Общий resize/JPEG-энкод хвост — переиспользуется и для скриншота вкладки
 *  (см. captureTabThumbnail ниже), и для картинки, выбранной пользователем на
 *  диске для проекта (см. projects:pick-thumbnail) — оба дают Electron
 *  `NativeImage`, дальше обработка идентична. */
function resizeToThumbnail(image: Electron.NativeImage): string | undefined {
  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0) return undefined
  const scale = Math.min(1, THUMBNAIL_MAX_WIDTH / width)
  const thumbnail =
    scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' }) : image
  return `data:image/jpeg;base64,${thumbnail.toJPEG(82).toString('base64')}`
}
async function captureTabThumbnail(wc: Electron.WebContents): Promise<string | undefined> {
  try {
    const image = await wc.capturePage()
    if (image.isEmpty()) return undefined
    return resizeToThumbnail(image)
  } catch (err) {
    log.debug('tab thumbnail capture failed', { message: (err as Error).message })
    return undefined
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0a0c',
    autoHideMenuBar: true,
    title: 'Web To Figma',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  attachEditContextMenu(mainWindow.webContents)

  browserController = new BrowserController(
    mainWindow,
    (snapshot: TabsSnapshot) => {
      mainWindow?.webContents.send('browser:tabs', snapshot)
      // title/favicon приходят отдельными событиями ПОСЛЕ did-navigate — каждый
      // патч state уточняет уже записанную визитом запись (см. RecentSitesStore).
      // По ВСЕМ вкладкам, не только активной — matched по url, no-op для
      // неизменившихся, но так фоновые вкладки тоже уточняют свою запись.
      for (const tab of snapshot.tabs) {
        void recentSites.updateLatestMeta(tab.url, { title: tab.title, faviconUrl: tab.faviconUrl })
      }
    },
    (url) => {
      elementPicker?.stopIfActive()
      void recentSites.recordVisit(url)
    },
    // Реальный клик В СТРАНИЦУ переводит OS-фокус на её webContents — это
    // единственный способ узнать о "клике снаружи" popover'а Apply to
    // Selection, раз тот теперь рисуется в overlay-рендерере (см. ниже),
    // а не в этом же окне, где сработал бы обычный document click-outside.
    // Тот же сигнал закрывает и generic popover overlay ('popover' слой) —
    // клик в саму страницу браузера тоже "снаружи" для него.
    () => {
      overlayController?.send('picker', 'overlay:collapse-popover', undefined)
      closePopoverOverlay()
    }
  )
  browserController.mount()

  elementPicker = new ElementPicker(
    // Референс-сессия временно переключает источник пика на встроенный
    // референс-браузер (см. reference:session-start) — один ElementPicker,
    // не два: CDP debugger никогда не кешируется между вызовами (см.
    // captureAndConvert), так что подмена источника замыканием безопасна.
    () => (referenceSession ? referenceBrowserController : browserController)?.getWebContents() ?? null,
    // Тоже overlayController.send — ApplyToSelectionContent живёт в overlay-
    // рендерере (отдельный webContents, см. overlay.ts), не в главном окне;
    // без этого он никогда не узнаёт, что элемент выбран (см. живой баг:
    // "Сначала выберите элемент" при уже выбранном в главном окне элементе).
    (result: SelectionResult) => {
      mainWindow?.webContents.send('inspector:selection', result)
      overlayController?.send('picker', 'inspector:selection', result)
    },
    // Тоже в оба webContents — PickerFloatBar (активная подсветка кнопки,
    // Esc/повторный клик по кнопке для отмены) живёт в overlay-рендерере, не
    // в главном окне (см. комментарий у onSelect выше); без этого
    // `pick.active` там навсегда оставался бы false после первого события,
    // и повторный клик по кнопке пикера в тулбаре запускал бы pick заново
    // вместо остановки (живой баг).
    (state: PickState) => {
      mainWindow?.webContents.send('inspector:pick-state', state)
      overlayController?.send('picker', 'inspector:pick-state', state)
    },
    // Queue-режим (мульти-импорт) — попап "Добавить/Отменить" живёт в
    // overlay-рендерере, та же причина double-send, что и выше.
    (item: QueueItemSummary) => {
      mainWindow?.webContents.send('inspector:queue-pending', item)
      overlayController?.send('picker', 'inspector:queue-pending', item)
    },
    (items: QueueItemSummary[]) => {
      mainWindow?.webContents.send('inspector:queue-updated', items)
      overlayController?.send('picker', 'inspector:queue-updated', items)
    },
    // Esc со уже выбранным элементом (см. inspector.ts clearSelection) — та
    // же причина double-send, что и у onSelect выше: hasSelection живёт
    // локальным state и в главном окне (InspectorPanel), и в overlay-
    // рендерере (PickerFloatBar/OverlayRoot).
    () => {
      mainWindow?.webContents.send('inspector:selection-cleared')
      overlayController?.send('picker', 'inspector:selection-cleared', undefined)
    },
    () => (referenceSession ? referenceBrowserController : browserController)?.getActiveTabId() ?? null,
    // Референс-элементы хранят tabId вкладки, где были собраны, и должны
    // резолвиться при отправке в Figma ДАЖЕ ПОСЛЕ выхода из сессии (когда
    // referenceSession уже null) — пробуем оба контроллера, а не только
    // "текущий" по режиму (tabId уникален внутри каждого контроллера, id
    // из разных наборов не пересекаются).
    (tabId) => browserController?.getWebContentsForTab(tabId) ?? referenceBrowserController?.getWebContentsForTab(tabId) ?? null,
    () => (referenceSession ? referenceBrowserController : browserController)?.getViewportSize() ?? { width: 0, height: 0 },
    async () => (await getCurrentSettings()).captureViewport,
    async () => (await getCurrentSettings()).captureFullBlockThumbnail,
    // getEffectiveTheme, getViewScreenBounds // 8-й/9-й аргумент для кастомного тултипа, см. inspector.ts
    (queueItemId, thumbnail) => {
      const referenceItemId = pendingReferenceThumbnails.get(queueItemId)
      if (!referenceItemId) return
      pendingReferenceThumbnails.delete(queueItemId)
      void referenceItemsStore.updateThumbnail(referenceItemId, thumbnail)
    }
  )

  // Overlay монтируется ПОСЛЕ browser-пейна — addChildView упорядочен по
  // времени добавления, поздние дети рисуются НАД более ранними (см. overlay.ts).
  const devUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  overlayController = new OverlayController()
  void overlayController.mount('picker', mainWindow, devUrl)
  // Якорь тулбара — browserViewportBounds, а те координаты уже РЕЛЯТИВНЫ
  // окну (renderer шлёт getBoundingClientRect() своего же div'а, см.
  // BrowserViewport.tsx) — чистое перемещение окна (move, без изменения
  // размера) их не меняет вообще, отдельный обработчик не нужен. На resize
  // тот же div сам переотправит новые bounds через свой ResizeObserver —
  // `browser:set-bounds` ниже и так переанкерит тулбар.

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void loadDevUrlWithRetry(mainWindow, process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * electron-vite сигналит "dev server running" и сразу запускает Electron, но
 * на некоторых машинах первый connect на localhost:5173 всё равно ловит
 * ECONNREFUSED — TCP-listener Vite открывается на пару кадров позже своего же
 * лога. Ретраим несколько раз с задержкой вместо падения в пустое окно.
 */
async function loadDevUrlWithRetry(win: BrowserWindow, url: string, attempt = 0): Promise<void> {
  try {
    await win.loadURL(url)
  } catch (err) {
    if (win.isDestroyed() || attempt >= 10) {
      log.warn('dev server load failed, giving up', { message: (err as Error).message, attempt })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    await loadDevUrlWithRetry(win, url, attempt + 1)
  }
}

async function startBridge(): Promise<void> {
  const secret = await loadOrCreateBridgeSecret()

  bridgeServer = new BridgeServer({
    token: secret.token,
    serverVersion: app.getVersion(),
    onConnectionCountChange: (count) => {
      bridgeInfo = { ...bridgeInfo, connectionCount: count }
      // `mainWindow?.` защищает только от null/undefined, не от "объект ещё
      // жив, но его webContents уже уничтожен" — живой краш при выходе из
      // приложения: `before-quit` вызывает bridgeServer.stop() →
      // teardownPeer() → этот колбэк синхронно, а к этому моменту в цепочке
      // quit окно иногда уже задестроено (Electron кидает "Object has been
      // destroyed" на .send() в такой момент, не TypeError на самом
      // mainWindow — тот по-прежнему не null). isDestroyed() — единственная
      // надёжная проверка.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bridge:status', { connectionCount: count })
      }
    },
    onAuthenticated: () => {
      if (latestPluginTheme) bridgeServer?.broadcast(latestPluginTheme)
    },
    onMessage: (message) => {
      // Ответы на запросы desktop (ImportNode и т.д.) перехватываются
      // BridgeServer.request() раньше этого колбэка — сюда попадают только
      // сообщения, ИНИЦИИРОВАННЫЕ плагином (напр. GetSelectionMessage, Phase 10+,
      // и theme-push — обратное направление синхронизации тем, см. "полный
      // синхрон" в PROJECT_MEMORY.md: Bridge Tools пересылает сюда тему,
      // полученную от Design Toolkit по отдельному Canvas Bridge каналу).
      log.debug('bridge message received', { kind: message.kind })
      if (message.kind === 'theme-push' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('theme:external-sync', message.payload)
      }
    }
  })

  const { port } = await bridgeServer.start()
  bridgeInfo = { port, pairingToken: secret.token, connectionCount: 0 }
  await writeJson(bridgeSecretPath(), { token: secret.token, port })
  log.info(`bridge listening on 127.0.0.1:${port}`)
}

/** Тот же merge, что и `settings:get` ниже — переиспользуется ElementPicker
 *  (getCaptureViewport) через модульную функцию, а не завязан на IPC. */
async function getCurrentSettings(): Promise<AppSettings> {
  const saved = await readJson<Partial<AppSettings>>(settingsPath())
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) }
}

function registerIpc(): void {
  ipcMain.handle('settings:get', (): Promise<AppSettings> => getCurrentSettings())

  ipcMain.handle('settings:save', async (_e, settings: AppSettings): Promise<void> => {
    await writeJson(settingsPath(), settings)
  })

  ipcMain.handle('theme:sync-plugin', (_e, theme: ThemeSyncMessage['payload']): void => {
    latestPluginTheme = createMessage<ThemeSyncMessage>('theme-sync', theme)
    bridgeServer?.broadcast(latestPluginTheme)
  })

  ipcMain.handle('app:get-version', (): string => app.getVersion())

  // Автодополнение строки поиска на вкладке "Референсы" (по запросу
  // пользователя — "гугловское автодополнение") — неофициальный, но давно
  // стабильный suggest-эндпоинт Google (client=firefox отдаёт чистый JSON-
  // массив без лишней chrome-специфичной метадаты типов подсказок). Из main,
  // не renderer — тот же повод, что и остальные fetch-и в этом файле
  // (избежать CORS/CSP страницы приложения, единая точка для таймаута/логов).
  ipcMain.handle('search:suggest', async (_e, query: string): Promise<string[]> => {
    const trimmed = query.trim()
    if (!trimmed) return []
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const response = await fetch(
        `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal }
      )
      clearTimeout(timeout)
      if (!response.ok) return []
      const data = (await response.json()) as [string, string[]]
      return Array.isArray(data[1]) ? data[1] : []
    } catch (err) {
      log.debug('search suggest failed', { message: (err as Error).message })
      return []
    }
  })

  ipcMain.handle('bridge:get-info', (): BridgeInfo => bridgeInfo)

  ipcMain.handle('browser:navigate', (_e, input: string): void => browserController?.navigate(input))
  // Со стартовой страницы (см. preload/browserTab.ts, main/startPage.ts) —
  // навигация ИМЕННО этой вкладки, откуда бы она ни была (главный браузер
  // или референс-браузер, оба используют один и тот же урезанный preload).
  // event.sender — webContents конкретной вкладки, которая прислала запрос,
  // так что здесь не нужно (и невозможно дёшево) искать, какому из двух
  // BrowserController она принадлежит — грузим URL прямо на нём.
  ipcMain.on('browser-tab:navigate', (event, input: string): void => {
    event.sender.loadURL(normalizeUrlInput(input)).catch((err: Error) => {
      log.debug('browser-tab navigate rejected', { input, message: err.message })
    })
  })
  ipcMain.handle('browser:back', (): void => browserController?.back())
  ipcMain.handle('browser:forward', (): void => browserController?.forward())
  ipcMain.handle('browser:reload', (): void => browserController?.reload())
  ipcMain.handle('browser:stop', (): void => browserController?.stop())
  ipcMain.handle('browser:set-bounds', (_e, bounds: ViewBounds): void => {
    browserController?.setBounds(bounds)
    browserViewportBounds = bounds
    repositionToolbarOverlay()
    if (panelVisible.left) repositionPanelOverlay('left')
    if (panelVisible.right) repositionPanelOverlay('right')
    if (panelVisible.top) repositionPanelOverlay('top')
  })
  ipcMain.handle('browser:set-hidden', (_e, hidden: boolean): void => browserController?.setHidden(hidden))
  ipcMain.handle('overlay:set-suppressed', (_e, suppressed: boolean): void => {
    overlaySuppressed = suppressed
    repositionToolbarOverlay()
    // Тот же сигнал, что переключает вид "Референсы"/модалки — плавающие
    // панели/верхняя панель браузера привязаны к browser-viewport, который
    // сейчас тоже прячется, оставлять их висеть было бы бессмысленно.
    if (suppressed) closeAllPanelOverlays()
  })

  // Пикер держит CDP debugger-сессию на КОНКРЕТНОМ webContents активной
  // вкладки (см. inspector.ts) — переключение/закрытие вкладки меняет,
  // какой webContents видим, поэтому сбрасываем активный pick-режим, чтобы
  // не остаться привязанными к уже невидимой вкладке.
  ipcMain.handle('browser:new-tab', (_e, url?: string): void => {
    elementPicker?.stopIfActive()
    browserController?.newTab(url)
  })
  ipcMain.handle('browser:close-tab', (_e, id: string): void => {
    elementPicker?.stopIfActive()
    browserController?.closeTab(id)
  })
  ipcMain.handle('browser:switch-tab', (_e, id: string): void => {
    elementPicker?.stopIfActive()
    browserController?.switchTab(id)
  })
  ipcMain.handle('browser:get-tabs', (): TabsSnapshot => browserController?.getTabsSnapshot() ?? { tabs: [], activeTabId: null })

  // Встроенный референс-браузер (см. referenceBrowserController докстринг
  // выше) — параллельный набор каналов, зеркалирующий browser:* один в один,
  // просто на второй, независимый BrowserController. Не монтируется здесь
  // заранее — до первого reference:session-start контроллера нет, эти
  // хендлеры тогда просто no-op (?. везде).
  ipcMain.handle('reference-browser:navigate', (_e, input: string): void => referenceBrowserController?.navigate(input))
  ipcMain.handle('reference-browser:back', (): void => referenceBrowserController?.back())
  ipcMain.handle('reference-browser:forward', (): void => referenceBrowserController?.forward())
  ipcMain.handle('reference-browser:reload', (): void => referenceBrowserController?.reload())
  ipcMain.handle('reference-browser:stop', (): void => referenceBrowserController?.stop())
  ipcMain.handle('reference-browser:set-bounds', (_e, bounds: ViewBounds): void => {
    referenceBrowserController?.setBounds(bounds)
    referenceBrowserViewportBounds = bounds
    repositionToolbarOverlay()
    // Тот же repositionPanelOverlay('top'), что и browser:set-bounds — та
    // теперь тоже смотрит на referenceSession и позиционируется по ЭТИМ
    // bounds, пока сессия активна (см. repositionPanelOverlay докстринг).
    if (panelVisible.top) repositionPanelOverlay('top')
  })
  ipcMain.handle('reference-browser:set-hidden', (_e, hidden: boolean): void => referenceBrowserController?.setHidden(hidden))
  ipcMain.handle('reference-browser:new-tab', (_e, url?: string): void => {
    elementPicker?.stopIfActive()
    referenceBrowserController?.newTab(url)
  })
  ipcMain.handle('reference-browser:close-tab', (_e, id: string): void => {
    elementPicker?.stopIfActive()
    referenceBrowserController?.closeTab(id)
  })
  ipcMain.handle('reference-browser:switch-tab', (_e, id: string): void => {
    elementPicker?.stopIfActive()
    referenceBrowserController?.switchTab(id)
  })
  ipcMain.handle(
    'reference-browser:get-tabs',
    (): TabsSnapshot => referenceBrowserController?.getTabsSnapshot() ?? { tabs: [], activeTabId: null }
  )

  // Тулбар теперь ВСЕГДА показан (не открывается/закрывается по запросу) —
  // единственное, что реально меняется динамически, это его высота (раскрыт
  // ли внутри него Apply to Selection popover, см. OverlayRoot.tsx).
  ipcMain.handle('overlay:report-size', (_e, size: OverlaySize): void => {
    toolbarOverlayWidth = size.width
    toolbarOverlayHeight = size.height
    repositionToolbarOverlay()
  })

  // Generic popover overlay ('popover' слой, см. overlay.ts докстринг) —
  // первая реализация обобщённого механизма (по запросу пользователя, вместо
  // usePopoverVisibility-подхода с прятаньем браузера под КАЖДЫЙ попап,
  // который может визуально пересечь browser-viewport). Любой новый попап —
  // ещё один `kind`, обрабатываемый в PopoverOverlayRoot.tsx, эта проводка
  // (open/close/report-size/reposition) переиспользуется как есть.
  ipcMain.handle('overlay:popover-open', async (_e, params: PopoverOpenParams): Promise<void> => {
    popoverAnchor = params.anchor
    const devUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
    if (mainWindow && !overlayController?.isMounted('popover')) {
      // Первое открытие за всё время работы приложения — ЖДЁМ реальной
      // загрузки страницы слоя перед send() ниже, иначе сообщение улетает в
      // пустоту (рендерер ещё не навесил свой IPC-listener), живой баг,
      // поймал пользователь: попап не показывал содержимое при первом клике.
      await overlayController?.mount('popover', mainWindow, devUrl)
    }
    overlayController?.send('popover', 'popover:show', { kind: params.kind, props: params.props })
    repositionPopoverOverlay()
  })
  ipcMain.handle('overlay:popover-close', (): void => {
    closePopoverOverlay()
  })
  ipcMain.handle('overlay:popover-report-size', (_e, size: OverlaySize): void => {
    popoverSize = size
    repositionPopoverOverlay()
  })
  // Действие внутри попапа/панели, которое должно обработать главное окно
  // (напр. "Новый проект" → CreateProjectModal, см. AddToProjectButton.tsx;
  // "закрепить панель" → App.tsx Workspace leftPinned/rightPinned state) —
  // в целом просто ретрансляция overlay-рендерер → главное окно, но у
  // 'pin-panel' есть побочный эффект здесь же: если панель закрепляют
  // (payload.pinned), её float-слой (если сейчас плавает) больше не нужен
  // независимо от текущего наведения — форсим закрытие сразу (см.
  // createHoverGate.forceClose), а не ждём, пока main-окно перерендерится и
  // само решит скрыть overlay отдельным вызовом.
  ipcMain.handle('overlay:popover-action', (_e, action: { type: string; payload?: unknown }): void => {
    if (action.type === 'pin-panel') {
      const payload = action.payload as { side: PanelSide; pinned: boolean }
      if (payload.pinned) {
        const gate =
          payload.side === 'left' || payload.side === 'references-left'
            ? leftPanelGate
            : payload.side === 'right' || payload.side === 'references-right'
              ? rightPanelGate
              : topPanelGate
        gate.forceClose()
      }
    }
    mainWindow?.webContents.send('overlay:popover-action', action)
  })

  // Float-режим distraction-free (см. createHoverGate докстринг выше) — два
  // независимых источника наведения (тонкая полоска в главном окне и сама
  // плавающая панель в overlay-слое) шлют сюда enter/leave, панель открыта,
  // пока хотя бы один держит её.
  ipcMain.handle('overlay:panel-hover', (_e, params: { side: PanelSide; entering: boolean }): void => {
    const gate =
      params.side === 'left' || params.side === 'references-left'
        ? leftPanelGate
        : params.side === 'right' || params.side === 'references-right'
          ? rightPanelGate
          : topPanelGate
    if (params.entering) gate.enter()
    else gate.leave()
  })

  // Активная вкладка верхнего уровня (см. App.tsx Shell activeView эффект) —
  // нужна ТОЛЬКО leftPanelGate, чтобы знать, какой overlay-слой открывать
  // при наведении на левый край в float-режиме (см. activeTopView докстринг
  // выше).
  ipcMain.handle('app:set-active-view', (_e, view: 'browser' | 'references'): void => {
    activeTopView = view
  })

  ipcMain.handle('inspector:start-pick', () => elementPicker?.start())
  ipcMain.handle('inspector:stop-pick', () => elementPicker?.stop())
  // Правая панель могла быть закрыта в момент клика пикером (пропустила
  // live-событие 'inspector:selection') — при открытии подхватывает уже
  // сделанный выбор через этот запрос вместо того, чтобы показывать пустое
  // состояние, пока пользователь не кликнет заново.
  ipcMain.handle('inspector:get-last-selection', (): SelectionResult | null => elementPicker?.getLastSelection() ?? null)
  // Клик по узлу Element tree в InspectorPanel — переключает выделение на
  // этот DOM-элемент, по запросу пользователя ("в дереве можно было
  // переключаться на объект, а не просто смотреть"), см. inspector.ts
  // selectBySourceSelector.
  ipcMain.handle(
    'inspector:select-tree-node',
    async (_e, sourceSelector: string): Promise<boolean> => (await elementPicker?.selectBySourceSelector(sourceSelector)) ?? false
  )

  // Queue-режим (мульти-импорт) — см. inspector.ts ElementPicker класс-докстринг.
  ipcMain.handle('inspector:set-queue-mode', (_e, active: boolean): void => elementPicker?.setQueueMode(active))
  // Диверсия в референс-стор (по запросу пользователя — сбор референс-
  // элементов переиспользует queue-режим целиком, см. main/inspector.ts
  // referenceSiteKey докстринг): если сейчас активна референс-сессия и
  // настройка "спрашивать имя" ВЫКЛЮЧЕНА (дефолт), коммитим сразу с
  // автоименем — подтверждённый элемент никогда не попадает в обычную
  // очередь/LeftSidebar. Если настройка включена, эта ручка не вызывается
  // вовсе — OverlayRoot.tsx вместо неё открывает попап имени (см.
  // reference:items-create-from-pending ниже), сама решает по уже
  // загруженным на своей стороне settings, звать какой из двух путей.
  ipcMain.handle('inspector:queue-confirm-add', async (): Promise<void> => {
    const item = elementPicker?.confirmQueueAdd()
    if (!item || !referenceSession) return
    const siteKey = referenceSiteKey(referenceSession.projectId, referenceSession.siteUrl)
    if (elementPicker?.getReferenceSiteKey() !== siteKey) return
    elementPicker.removeQueueItem(item.id)
    const created = await referenceItemsStore.create(referenceItemInputFromQueueItem(item, referenceSession))
    // Офскрин-миниатюра часто ещё не готова в этот момент (см.
    // inspector.ts onItemThumbnailReady докстринг) — регистрируем
    // корреляцию, чтобы patch'нуть её сюда, когда снимок доедет.
    if (!created.thumbnail) pendingReferenceThumbnails.set(item.id, created.id)
  })
  ipcMain.handle('inspector:queue-confirm-cancel', (): void => elementPicker?.confirmQueueCancel())

  // "Найти сайт" из строки поиска на стартовом экране "Референсов" (по
  // запросу пользователя) — раньше ЛЮБОЙ ввод в этой строке (включая
  // произвольный текстовый запрос, ушедший в google-поиск через
  // normalizeUrlInput) немедленно становился standalone-референсом и
  // запускал пикер — живой баг: гугл-поиск сохранялся как "сайт". Теперь
  // это отдельный, более лёгкий режим: просто монтирует/показывает
  // встроенный референс-браузер и переходит по адресу, НЕ трогая
  // referenceSession/standaloneReferenceSitesStore/elementPicker вообще —
  // пока пользователь не найдёт нужную страницу и не нажмёт "Начать сбор"
  // (обычный reference:session-start ниже, но уже с URL страницы, на
  // которой пользователь фактически остановился, а не с исходным запросом).
  // Начальное значение для 'panel-top' overlay-рендерера при монтировании
  // (тот монтируется лениво по первому наведению — см. showPanelOverlay —
  // референс-браузер к этому моменту вполне может уже быть виден). Живые
  // изменения дальше идут event'ом (см. setReferenceBrowserVisible).
  ipcMain.handle('reference:get-browser-visible', (): boolean => referenceBrowserVisible)
  // Начальное значение для 'panel-references-right' overlay-рендерера при
  // монтировании (тот монтируется лениво по первому наведению — см.
  // showPanelOverlay — сессия сбора к этому моменту вполне может уже быть
  // активна). Живые изменения дальше идут event'ом (см. broadcastReferenceSession).
  ipcMain.handle('reference:get-session-state', (): ReferenceSessionState | null => referenceSession)

  ipcMain.handle('reference:browse-start', (_e, url: string): void => {
    const browser = mountReferenceBrowser()
    browser?.setHidden(false)
    setReferenceBrowserVisible(true)
    if (browser && !browser.getActiveTabId()) browser.newTab(url)
    else browser?.navigate(url)
  })

  // Плавающая левая панель "Референсов" (см. PanelOverlayRoot.tsx
  // side:'references-left') живёт в ДРУГОМ рендерере — клик по сайту/
  // проекту там не может напрямую вызвать selectSite()/onOpenSite()
  // ReferencesView.tsx (тот React state — в главном окне). Просто
  // ретрансляция главному окну, тем же generic bounce-back паттерном, что
  // уже AddToProjectButton/pin-panel используют.
  ipcMain.handle('references:overlay-select-site', (_e, projectId: string | null, url: string): void => {
    mainWindow?.webContents.send('references:overlay-select-site', projectId, url)
  })
  ipcMain.handle('references:overlay-open-site', (_e, url: string): void => {
    mainWindow?.webContents.send('references:overlay-open-site', url)
  })

  // Сессия сбора референс-элементов (по запросу пользователя, см.
  // shared/types.ts ReferenceItem/ReferenceSessionState докстринг) —
  // переиспользует queue-режим целиком, см. inspector.ts referenceSiteKey.
  ipcMain.handle('reference:session-start', async (_e, projectId: string | null, siteUrl: string): Promise<void> => {
    let siteTitle = siteUrl
    if (projectId) {
      const project = projectsStore.getAll().projects.find((p) => p.id === projectId)
      const site = project?.sites.find((s) => s.url === siteUrl)
      siteTitle = site?.title || project?.name || siteUrl
    } else if (isSearchQueryUrl(siteUrl)) {
      // Свободнотекстовый гугл-поиск (по запросу пользователя — "любой поиск
      // не по домену... не должен попадать в недавние нигде") — не должно
      // случаться штатно (commitBrowsing берёт url уже открытой вкладки
      // browse-режима), но если пользователь нажал "Начать сбор" прямо на
      // странице результатов поиска, не успев перейти на реальный сайт — не
      // создаём запись в standalone-сторе, сессия просто использует "сырой"
      // siteUrl как ключ (referenceSiteKey), без персистентной истории.
      siteTitle = siteUrl
    } else {
      // Без проекта (по запросу пользователя — "начать с сайта, оформить как
      // референс потом") — запись в standalone-сторе создаётся здесь же, если
      // это первый заход на этот url (см. StandaloneReferenceSitesStore.upsert
      // докстринг про идемпотентность); title поначалу пуст (это же самый
      // первый визит), уточнится позже вместе с favicon тем же путём, что и
      // обычные вкладки (см. BrowserController onTabsChange в mountReferenceBrowser).
      const site = await standaloneReferenceSitesStore.upsert({ url: siteUrl, title: '', faviconUrl: null })
      siteTitle = site.title || siteUrl
    }
    referenceSession = { projectId, siteUrl, siteTitle }
    // Встроенный референс-браузер (по коррекции пользователя — НЕ переход на
    // вкладку "Браузер", отдельный вьюпорт прямо на странице референс-сайта,
    // см. mountReferenceBrowser) — монтируется при первом обращении, дальше
    // просто переиспользуется между сессиями, как и главный браузер живёт
    // всю сессию приложения.
    const browser = mountReferenceBrowser()
    // Явно снимаем hidden (см. reference:session-end — единственное место,
    // которое его ставит) — на случай, если предыдущая сессия закрылась
    // именно так; без этого newTab/navigate ниже физически ничего не
    // покажут (BrowserController.setBounds no-op, пока hidden === true, см.
    // ReferenceBrowserPane.tsx докстринг про живой баг).
    browser?.setHidden(false)
    setReferenceBrowserVisible(true)
    // Первое открытие — сразу создаём вкладку с РЕАЛЬНЫМ url (не грузим
    // стартовую страницу только чтобы тут же её перебить, см.
    // mountReferenceBrowser докстринг); повторное открытие (контроллер и
    // вкладка уже есть) — просто навигация в существующей вкладке.
    if (browser && !browser.getActiveTabId()) browser.newTab(siteUrl)
    else browser?.navigate(siteUrl)
    elementPicker?.setReferenceMode(referenceSiteKey(projectId, siteUrl))
    elementPicker?.setQueueMode(true)
    broadcastReferenceSession()
    // Пикер больше НЕ стартует автоматически при открытии сессии (по
    // запросу пользователя — "надо что бы я его включал с тулбара сам") —
    // пользователь включает его вручную кнопкой на PickerFloatBar, как в
    // обычном браузере.
  })
  ipcMain.handle('reference:session-end', async (): Promise<void> => {
    referenceSession = null
    elementPicker?.setReferenceMode(null)
    elementPicker?.setQueueMode(false)
    await elementPicker?.stop()
    // Единственное место, которое прячет референс-браузер (см.
    // reference:session-start докстринг выше и ReferenceBrowserPane.tsx —
    // раньше это делал renderer через unmount-эффект, живой баг под
    // StrictMode: hidden оставался true навсегда, все будущие bounds
    // молча игнорировались).
    referenceBrowserController?.setHidden(true)
    setReferenceBrowserVisible(false)
    broadcastReferenceSession()
    // Без этого тулбар пикера остался бы висеть над уже скрытым референс-
    // браузером до следующего случайного repositionToolbarOverlay() откуда-то
    // ещё — repositionToolbarOverlay() сам решит, показывать ли его дальше
    // (зависит от overlaySuppressed, см. докстринг функции).
    repositionToolbarOverlay()
  })
  ipcMain.handle('reference:items-get', (_e, siteKey: string): ReferenceItem[] => referenceItemsStore.getForSite(siteKey))
  ipcMain.handle(
    'reference:items-update-meta',
    async (_e, id: string, patch: { name?: string; description?: string }): Promise<void> => {
      await referenceItemsStore.updateMeta(id, patch)
    }
  )
  ipcMain.handle('reference:items-remove', async (_e, id: string): Promise<void> => {
    await referenceItemsStore.remove(id)
  })

  // Референс-сайты без проекта (по запросу пользователя), см.
  // main/standaloneReferenceSites.ts докстринг.
  ipcMain.handle('standalone-references:get', (): StandaloneReferenceSite[] => standaloneReferenceSitesStore.getAll())
  ipcMain.handle('standalone-references:remove', async (_e, url: string): Promise<void> => {
    await standaloneReferenceSitesStore.remove(url)
    await referenceItemsStore.removeForSite(referenceSiteKey(null, url))
  })
  ipcMain.handle('standalone-references:attach-to-project', async (_e, url: string, projectId: string): Promise<void> => {
    const site = standaloneReferenceSitesStore.getAll().find((s) => s.url === url)
    if (!site) return
    await projectsStore.addSite(projectId, { url: site.url, title: site.title, faviconUrl: site.faviconUrl }, 'reference')
    if (site.thumbnail) await projectsStore.setThumbnail(projectId, url, site.thumbnail)
    await standaloneReferenceSitesStore.remove(url)
    // Переносим уже собранные референс-элементы на новый siteKey — тот же
    // приём, что projects:move-site-to-project уже использует при смене
    // проекта у обычного ProjectSite (см. main/index.ts).
    const oldKey = referenceSiteKey(null, url)
    const newKey = referenceSiteKey(projectId, url)
    const items = referenceItemsStore.getForSite(oldKey)
    for (const item of items) {
      await referenceItemsStore.remove(item.id)
      await referenceItemsStore.create({
        siteKey: newKey,
        projectId,
        siteUrl: item.siteUrl,
        element: item.element,
        thumbnail: item.thumbnail,
        name: item.name,
        description: item.description,
        tabId: item.tabId,
        backendNodeId: item.backendNodeId,
        sourceUrl: item.sourceUrl
      })
    }
  })
  // Попап "имя/описание" (настройка referenceNamePromptOnAdd) — открывается и
  // управляется целиком в OverlayRoot.tsx/ReferenceNamePopoverContent.tsx (там
  // уже есть pendingQueueItem как onInspectorQueuePending); эта ручка делает
  // то же самое, что и авто-путь в inspector:queue-confirm-add выше, только
  // с введёнными name/description вместо автоимени.
  ipcMain.handle(
    'reference:items-create-from-pending',
    async (_e, name: string, description?: string): Promise<void> => {
      const item = elementPicker?.confirmQueueAdd()
      if (!item || !referenceSession) return
      elementPicker?.removeQueueItem(item.id)
      const created = await referenceItemsStore.create({
        ...referenceItemInputFromQueueItem(item, referenceSession),
        name,
        description
      })
      if (!created.thumbnail) pendingReferenceThumbnails.set(item.id, created.id)
    }
  )
  ipcMain.handle('inspector:queue-remove', (_e, id: string): void => elementPicker?.removeQueueItem(id))
  ipcMain.handle('inspector:queue-clear', (): void => elementPicker?.clearQueue())

  // Клик по карточке очереди "для проверки" (по запросу пользователя) —
  // переключает вкладку на ту, где был сделан пик (если сейчас активна другая),
  // затем подсвечивает исходный элемент и скроллит его в видимую область.
  ipcMain.handle('inspector:queue-locate', async (_e, id: string): Promise<ImportResult> => {
    const loc = elementPicker?.getQueueItemLocation(id)
    if (!loc) return { ok: false, error: 'Элемент не найден в очереди' }
    if (loc.tabId && browserController?.getActiveTabId() !== loc.tabId) browserController?.switchTab(loc.tabId)
    // Исходную вкладку могли закрыть после добавления элемента в очередь.
    // Не ищем backendNodeId в другой вкладке: CDP id не глобален и может
    // случайно совпасть с совершенно другим DOM-узлом.
    if (!loc.tabId || browserController?.getActiveTabId() !== loc.tabId) {
      return { ok: false, error: 'Исходная вкладка уже закрыта' }
    }
    const ok = (await elementPicker?.highlightBackendNode(loc.backendNodeId)) ?? false
    return ok ? { ok: true } : { ok: false, error: 'Элемент больше не найден на странице — возможно, она изменилась' }
  })

  // Esc с уже выбранным элементом (см. inspector.ts clearSelection класс-докстринг
  // про inputListenerWc) — снимает постоянную подсветку на странице и весь
  // связанный state, по запросу пользователя ("выделение никак не убрать").
  ipcMain.handle('inspector:clear-selection', async (): Promise<void> => {
    await elementPicker?.clearSelection()
  })
  // Левая панель могла быть смонтирована ПОСЛЕ того, как в очередь уже что-то
  // добавили (тот же класс живых багов, что и get-last-selection выше) —
  // подхватывает текущее состояние при монтировании, не ждёт live-события.
  ipcMain.handle('inspector:queue-get', (): QueueItemSummary[] => elementPicker?.getQueue() ?? [])

  ipcMain.handle('recent-sites:get', (): RecentSite[] => recentSites.getAll())
  ipcMain.handle('recent-sites:remove', async (_e, url: string): Promise<void> => {
    await recentSites.remove(url)
  })
  ipcMain.handle('recent-sites:toggle-pin', async (_e, url: string): Promise<void> => {
    await recentSites.togglePin(url)
  })

  // Проекты в сайдбаре (по запросу пользователя — "объединять сайты в
  // проекты, как чаты в Claude Desktop"), см. main/projects.ts ProjectsStore.
  ipcMain.handle('projects:get', (): ProjectsSnapshot => projectsStore.getAll())
  ipcMain.handle('projects:create', async (_e, input: CreateProjectInput): Promise<Project> => projectsStore.createProject(input))
  ipcMain.handle('projects:rename', async (_e, id: string, name: string): Promise<void> => {
    await projectsStore.renameProject(id, name)
  })
  ipcMain.handle(
    'projects:update',
    async (
      _e,
      id: string,
      patch: { name?: string; description?: string; icon?: string | null; thumbnail?: string | null }
    ): Promise<void> => {
      await projectsStore.updateProject(id, patch)
    }
  )
  // Диалог выбора картинки для проекта (по запросу пользователя — "своя
  // картинка" в попапе редактирования, см. CreateProjectModal.tsx) —
  // resizeToThumbnail переиспользует тот же resize/JPEG-энкод хвост, что уже
  // captureTabThumbnail использует для скриншота вкладки (см. THUMBNAIL_MAX_WIDTH
  // выше), просто источник NativeImage другой (файл, а не capturePage()).
  ipcMain.handle('projects:pick-thumbnail', async (): Promise<string | null> => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const image = nativeImage.createFromPath(result.filePaths[0])
    if (image.isEmpty()) return null
    return resizeToThumbnail(image) ?? null
  })
  ipcMain.handle('projects:delete', async (_e, id: string): Promise<void> => {
    await projectsStore.deleteProject(id)
  })
  ipcMain.handle('projects:reorder', async (_e, orderedIds: string[]): Promise<void> => {
    await projectsStore.reorderProjects(orderedIds)
  })
  ipcMain.handle(
    'projects:add-site',
    async (
      _e,
      projectId: string,
      site: { url: string; title: string; faviconUrl: string | null },
      kind: 'site' | 'reference'
    ): Promise<void> => {
      await projectsStore.addSite(projectId, site, kind)
      if (kind !== 'reference') return
      // Скриншот снимается только для референсов и только с активной
      // вкладки — "добавить как референс" всегда идёт с текущей открытой
      // страницы (см. AddToProjectButton.tsx), не с произвольного url.
      const tabId = browserController?.getActiveTabId()
      const wc = tabId ? browserController?.getWebContentsForTab(tabId) : null
      if (!wc) return
      const thumbnail = await captureTabThumbnail(wc)
      if (thumbnail) await projectsStore.setThumbnail(projectId, site.url, thumbnail)
    }
  )
  ipcMain.handle('projects:remove-site', async (_e, projectId: string, url: string): Promise<void> => {
    await projectsStore.removeSite(projectId, url)
    // Осиротевшие референс-элементы (см. ReferenceItemsStore) иначе остаются
    // мёртвым грузом в reference-items.json — сайт удалён, обратно к нему не
    // попасть.
    await referenceItemsStore.removeForSite(referenceSiteKey(projectId, url))
  })
  ipcMain.handle(
    'projects:move-site-kind',
    async (_e, projectId: string, url: string, toKind: 'site' | 'reference'): Promise<void> => {
      await projectsStore.moveSite(projectId, url, toKind)
    }
  )
  ipcMain.handle(
    'projects:move-site-to-project',
    async (_e, fromProjectId: string, toProjectId: string, url: string): Promise<void> => {
      await projectsStore.moveSiteToProject(fromProjectId, toProjectId, url)
      // siteKey включает projectId — перенос в другой проект меняет ключ,
      // старые референс-элементы иначе стали бы недостижимы (адресованы по
      // старому siteKey, которого больше никто не запрашивает).
      const oldKey = referenceSiteKey(fromProjectId, url)
      const items = referenceItemsStore.getForSite(oldKey)
      for (const item of items) {
        await referenceItemsStore.remove(item.id)
        await referenceItemsStore.create({
          siteKey: referenceSiteKey(toProjectId, url),
          projectId: toProjectId,
          siteUrl: item.siteUrl,
          element: item.element,
          thumbnail: item.thumbnail,
          name: item.name,
          description: item.description,
          tabId: item.tabId,
          backendNodeId: item.backendNodeId,
          sourceUrl: item.sourceUrl
        })
      }
    }
  )
  ipcMain.handle(
    'projects:reorder-sites',
    async (_e, projectId: string, kind: 'site' | 'reference', orderedUrls: string[]): Promise<void> => {
      await projectsStore.reorderSites(projectId, kind, orderedUrls)
    }
  )

  // Отмена импорта (по запросу пользователя, кнопка на плашке прогресса) —
  // см. importCancelHandles/withCancel докстринг выше.
  ipcMain.handle('import:cancel', (_e, id: string): void => {
    importCancelHandles.get(id)?.abort()
  })

  ipcMain.handle(
    'inspector:import-as-frame',
    async (
      _e,
      useMatchedTextStyles: boolean,
      useMatchedColorStyles: boolean,
      colorMatchSource: ColorMatchSource
    ): Promise<ImportResult> => {
      const progress = createImportProgress('Импорт фрейма')
      const startedAt = performance.now()
      // См. inspector.ts CAPTURE_MIN_WIDTH — desktop-ширина применяется здесь,
      // один раз перед реальным импортом, а не на каждом клике пикера
      // (это раньше вызывало заметный "дёрг" видимой страницы на каждый клик).
      progress.update('preparing', 0.08, 'Чтение DOM, стилей и ассетов…')
      await elementPicker?.prepareForImport()
      const preparedAt = performance.now()
      const document = elementPicker?.buildDocument(
        browserController?.getState().url ?? '',
        browserController?.getViewportSize() ?? { width: 0, height: 0 }
      )
      if (!document) {
        progress.finish(false, 'Элемент не выбран')
        return { ok: false, error: 'Сначала выберите элемент' }
      }
      if (!bridgeServer || bridgeServer.connectionCount === 0) {
        progress.finish(false, 'Figma не подключена')
        return { ok: false, error: 'Figma plugin не подключён — см. Bridge в toolbar' }
      }

      const message = createMessage<ImportNodeMessage>('import-node', {
        document,
        as: 'frame',
        useMatchedTextStyles,
        useMatchedColorStyles,
        colorMatchSource
      })
      try {
        progress.update('sending', 0.62, `DOM готов за ${((preparedAt - startedAt) / 1000).toFixed(1)} с · создание в Figma…`)
        const response = await withCancel(bridgeServer.request(message), progress.signal)
        if (response.kind === 'error') {
          const error = (response as ErrorMessage).payload.message
          progress.finish(false, error)
          return { ok: false, error }
        }
        progress.finish(true, `Готово за ${((performance.now() - startedAt) / 1000).toFixed(1)} с`)
        return { ok: true, failedAssets: elementPicker?.getLastFailedAssetsCount() }
      } catch (err) {
        const error = (err as Error).message
        progress.finish(false, error)
        return { ok: false, error }
      }
    }
  )

  // "Импортировать страницу целиком" (по запросу пользователя) — отдельный
  // инструмент на тулбаре, не требует предварительного клика пикером:
  // selectFullPage() сам разрешает <body> в backendNodeId, дальше тот же
  // prepareForImport()/buildDocument() путь, что и у Import as Frame.
  ipcMain.handle(
    'inspector:import-full-page',
    async (
      _e,
      useMatchedTextStyles: boolean,
      useMatchedColorStyles: boolean,
      colorMatchSource: ColorMatchSource
    ): Promise<ImportResult> => {
      const progress = createImportProgress('Импорт страницы целиком')
      const startedAt = performance.now()
      progress.update('preparing', 0.05, 'Поиск <body>…')
      const selected = await elementPicker?.selectFullPage()
      if (!selected) {
        progress.finish(false, 'Не удалось найти страницу — откройте сайт в браузере')
        return { ok: false, error: 'Сначала откройте страницу в браузере' }
      }
      // Обычный лимит узлов (см. domSnapshot.ts MAX_NODES=400) рассчитан на
      // ОДИН выбранный элемент — реальная страница целиком (шапка+навигация+
      // герой+секции) легко превышает его, из-за чего часть DOM'а молча не
      // попадала в снапшот (живой баг, поймал пользователь — герой-картинка
      // пропала при импорте страницы целиком, диагностика 'subtree-truncated'
      // это подтвердила). Только для полного импорта страницы — обычный
      // Import as Frame/Component продолжает использовать дефолт.
      progress.update('preparing', 0.08, 'Чтение DOM, стилей и ассетов…')
      await elementPicker?.prepareForImport(FULL_PAGE_MAX_NODES)
      const preparedAt = performance.now()
      const document = elementPicker?.buildDocument(
        browserController?.getState().url ?? '',
        browserController?.getViewportSize() ?? { width: 0, height: 0 }
      )
      if (!document) {
        progress.finish(false, 'Не удалось прочитать страницу')
        return { ok: false, error: 'Не удалось прочитать страницу' }
      }
      if (!bridgeServer || bridgeServer.connectionCount === 0) {
        progress.finish(false, 'Figma не подключена')
        return { ok: false, error: 'Figma plugin не подключён — см. Bridge в toolbar' }
      }

      const message = createMessage<ImportNodeMessage>('import-node', {
        document,
        as: 'frame',
        useMatchedTextStyles,
        useMatchedColorStyles,
        colorMatchSource
      })
      try {
        progress.update('sending', 0.62, `DOM готов за ${((preparedAt - startedAt) / 1000).toFixed(1)} с · создание в Figma…`)
        // Дефолтный таймаут запроса (10с, REQUEST_TIMEOUT_MS) рассчитан на
        // один выбранный элемент — плагин создаёт ноды в Figma синхронно,
        // одну за другой (figma.createFrame/loadFontAsync на каждый узел), и
        // для страницы целиком (до FULL_PAGE_MAX_NODES узлов) это легко
        // дольше 10с. Живой баг, поймал пользователь: "Bridge request
        // import-node timed out" и часть страницы не успела импортироваться
        // — desktop переставал ждать раньше, чем Figma заканчивала.
        const response = await withCancel(bridgeServer.request(message, FULL_PAGE_IMPORT_TIMEOUT_MS), progress.signal)
        if (response.kind === 'error') {
          const error = (response as ErrorMessage).payload.message
          progress.finish(false, error)
          return { ok: false, error }
        }
        progress.finish(true, `Готово за ${((performance.now() - startedAt) / 1000).toFixed(1)} с`)
        return { ok: true, failedAssets: elementPicker?.getLastFailedAssetsCount() }
      } catch (err) {
        const error = (err as Error).message
        progress.finish(false, error)
        return { ok: false, error }
      }
    }
  )

  // Import as Component (по запросу пользователя) — тот же одиночный pick,
  // что и Import as Frame выше, но `as:'component'` вместо `'frame'` — реальная
  // промоция в Figma Component/Instance целиком на стороне плагина (см.
  // designNode.ts renderDesignNode).
  ipcMain.handle(
    'inspector:import-as-component',
    async (
      _e,
      useMatchedTextStyles: boolean,
      useMatchedColorStyles: boolean,
      colorMatchSource: ColorMatchSource,
      alsoCreateInstance: boolean
    ): Promise<ImportResult> => {
      const progress = createImportProgress('Импорт компонента')
      const startedAt = performance.now()
      progress.update('preparing', 0.08, 'Чтение DOM, стилей и ассетов…')
      await elementPicker?.prepareForImport()
      const preparedAt = performance.now()
      const document = elementPicker?.buildDocument(
        browserController?.getState().url ?? '',
        browserController?.getViewportSize() ?? { width: 0, height: 0 }
      )
      if (!document) {
        progress.finish(false, 'Элемент не выбран')
        return { ok: false, error: 'Сначала выберите элемент' }
      }
      if (!bridgeServer || bridgeServer.connectionCount === 0) {
        progress.finish(false, 'Figma не подключена')
        return { ok: false, error: 'Figma plugin не подключён — см. Bridge в toolbar' }
      }

      const message = createMessage<ImportNodeMessage>('import-node', {
        document,
        as: 'component',
        useMatchedTextStyles,
        useMatchedColorStyles,
        colorMatchSource,
        alsoCreateInstance
      })
      try {
        progress.update('sending', 0.62, `DOM готов за ${((preparedAt - startedAt) / 1000).toFixed(1)} с · создание в Figma…`)
        const response = await withCancel(bridgeServer.request(message), progress.signal)
        if (response.kind === 'error') {
          const error = (response as ErrorMessage).payload.message
          progress.finish(false, error)
          return { ok: false, error }
        }
        progress.finish(true, `Готово за ${((performance.now() - startedAt) / 1000).toFixed(1)} с`)
        return { ok: true, failedAssets: elementPicker?.getLastFailedAssetsCount() }
      } catch (err) {
        const error = (err as Error).message
        progress.finish(false, error)
        return { ok: false, error }
      }
    }
  )

  // Горизонтальный отступ между фреймами батч-импорта из очереди — см.
  // ImportNodeMessageSchema.placementOffset (bridge-protocol) и
  // placeNearViewport в figma-plugin/renderers/designNode.ts.
  const QUEUE_IMPORT_GAP = 80

  ipcMain.handle(
    'inspector:import-queue',
    async (
      _e,
      useMatchedTextStyles: boolean,
      useMatchedColorStyles: boolean,
      colorMatchSource: ColorMatchSource
    ): Promise<QueueImportResult> => {
      if (!bridgeServer || bridgeServer.connectionCount === 0) {
        return { ok: false, imported: 0, failed: 0, error: 'Figma plugin не подключён — см. Bridge в toolbar' }
      }
      // Queue-mode автоматически запускает следующий pick после каждого Add.
      // Перед тяжёлой подготовкой освобождаем его CDP-сессию явно, иначе
      // очередь ждала собственный debugger и помечала элементы ошибочными.
      await elementPicker?.stop()
      const queued = elementPicker?.getQueue() ?? []
      if (queued.length === 0) return { ok: false, imported: 0, failed: 0, error: 'Очередь пуста' }
      const progress = createImportProgress('Импорт очереди', queued.length)
      const startedAt = performance.now()
      const prepared = await elementPicker!.prepareQueueDocuments(
        browserController?.getViewportSize() ?? { width: 0, height: 0 },
        (completed, total) => {
          progress.update('preparing', 0.05 + (completed / Math.max(1, total)) * 0.45, `Подготовка ${completed} из ${total}`, completed)
        }
      )
      const documents = prepared.documents
      const preparedAt = performance.now()

      // Последовательно, не параллельно — один запрос за раз к тому же
      // единственному подключённому плагину (bridgeServer.request() и так
      // резолвится по одному in-flight запросу за раз, см. docs/bridge-protocol.md).
      let imported = 0
      let failed = prepared.failed
      let x = 0
      for (const [index, document] of documents.entries()) {
        progress.update(
          'sending',
          0.5 + (index / Math.max(1, documents.length)) * 0.5,
          `DOM готов за ${((preparedAt - startedAt) / 1000).toFixed(1)} с · создание ${index + 1} из ${documents.length} в Figma`,
          index + 1
        )
        const message = createMessage<ImportNodeMessage>('import-node', {
          document,
          as: 'frame',
          useMatchedTextStyles,
          useMatchedColorStyles,
          colorMatchSource,
          placementOffset: { x, y: 0 }
        })
        try {
          const response = await withCancel(bridgeServer.request(message), progress.signal)
          if (response.kind === 'error') failed++
          else imported++
        } catch {
          failed++
        }
        x += document.root.size.width + QUEUE_IMPORT_GAP
      }

      // Очередь считается "потреблённой" после попытки импорта, независимо
      // от частичных неудач — то же поведение, что у одиночного импорта
      // (успех/ошибка сразу видны в результате, зависать в панели нечему
      // возвращаться: DOM-снапшот уже захвачен и не обновится сам собой).
      elementPicker?.clearQueue()
      progress.finish(
        failed === 0,
        failed === 0
          ? `Импортировано: ${imported} за ${((performance.now() - startedAt) / 1000).toFixed(1)} с`
          : `Импортировано: ${imported}, ошибок: ${failed}`
      )
      return { ok: failed === 0, imported, failed }
    }
  )

  // Отправка референс-элементов в Figma (по запросу пользователя — "по одной
  // либо все разом") — параллельный обработчик, не обобщение
  // inspector:import-queue выше: та ручка жёстко завязана на
  // ElementPicker.queue, а референс-элементы из неё сознательно ИЗЪЯТЫ (см.
  // диверсию в inspector:queue-confirm-add). Переиспользует ту же форму
  // ImportNodeMessage, линейное размещение через QUEUE_IMPORT_GAP и
  // createImportProgress — копируется тот же ~20-строчный цикл, а не
  // переизобретается. Авторасстановку сеткой сознательно не делаем — по
  // решению пользователя, отдельная будущая задача.
  async function sendReferenceItems(
    items: ReferenceItem[],
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource,
    label: string
  ): Promise<QueueImportResult> {
    if (!bridgeServer || bridgeServer.connectionCount === 0) {
      return { ok: false, imported: 0, failed: 0, error: 'Figma plugin не подключён — см. Bridge в toolbar' }
    }
    if (items.length === 0) return { ok: false, imported: 0, failed: 0, error: 'Нечего отправлять' }
    const progress = createImportProgress(label, items.length)
    const startedAt = performance.now()
    const prepared = await elementPicker!.prepareReferenceDocuments(
      items.map((i) => ({ id: i.id, tabId: i.tabId, backendNodeId: i.backendNodeId, sourceUrl: i.sourceUrl })),
      browserController?.getViewportSize() ?? { width: 0, height: 0 },
      (completed, total) => {
        progress.update('preparing', 0.05 + (completed / Math.max(1, total)) * 0.45, `Подготовка ${completed} из ${total}`, completed)
      }
    )
    const preparedAt = performance.now()

    let imported = 0
    let failed = 0
    let x = 0
    let sentIndex = 0
    for (const result of prepared) {
      if ('error' in result) {
        failed++
        continue
      }
      sentIndex++
      progress.update(
        'sending',
        0.5 + (sentIndex / Math.max(1, prepared.length)) * 0.5,
        `DOM готов за ${((preparedAt - startedAt) / 1000).toFixed(1)} с · создание ${sentIndex} в Figma`,
        sentIndex
      )
      const message = createMessage<ImportNodeMessage>('import-node', {
        document: result.document,
        as: 'frame',
        useMatchedTextStyles,
        useMatchedColorStyles,
        colorMatchSource,
        placementOffset: { x, y: 0 }
      })
      try {
        const response = await withCancel(bridgeServer.request(message), progress.signal)
        if (response.kind === 'error') failed++
        else {
          imported++
          await referenceItemsStore.markSent(result.id)
        }
      } catch {
        failed++
      }
      x += result.document.root.size.width + QUEUE_IMPORT_GAP
    }

    progress.finish(
      failed === 0,
      failed === 0
        ? `Импортировано: ${imported} за ${((performance.now() - startedAt) / 1000).toFixed(1)} с`
        : `Импортировано: ${imported}, ошибок: ${failed}`
    )
    return { ok: failed === 0, imported, failed }
  }

  ipcMain.handle(
    'reference:items-send',
    async (
      _e,
      id: string,
      useMatchedTextStyles: boolean,
      useMatchedColorStyles: boolean,
      colorMatchSource: ColorMatchSource
    ): Promise<ImportResult> => {
      const found = referenceItemsStore.findById(id)
      if (!found) return { ok: false, error: 'Референс-элемент не найден' }
      const result = await sendReferenceItems([found], useMatchedTextStyles, useMatchedColorStyles, colorMatchSource, 'Отправка референса')
      return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'Не удалось отправить' }
    }
  )
  ipcMain.handle(
    'reference:items-send-all',
    async (
      _e,
      siteKey: string,
      useMatchedTextStyles: boolean,
      useMatchedColorStyles: boolean,
      colorMatchSource: ColorMatchSource
    ): Promise<QueueImportResult> => {
      const items = referenceItemsStore.getForSite(siteKey).filter((i) => !i.sentToFigmaAt)
      return sendReferenceItems(items, useMatchedTextStyles, useMatchedColorStyles, colorMatchSource, 'Отправка референсов')
    }
  )

  ipcMain.handle('inspector:apply-styles', async (_e, targets: ApplyStylesTargets): Promise<ApplyStylesResult> => {
    const document = elementPicker?.buildDocument(
      browserController?.getState().url ?? '',
      browserController?.getViewportSize() ?? { width: 0, height: 0 }
    )
    if (!document) return { ok: false, error: 'Сначала выберите элемент' }
    if (!bridgeServer || bridgeServer.connectionCount === 0) {
      return { ok: false, error: 'Figma plugin не подключён — см. Bridge в toolbar' }
    }
    const progress = createImportProgress('Применение стилей')

    const message = createMessage<ApplyStylesMessage>('apply-styles', { document, targets })
    try {
      progress.update('sending', 0.55, 'Обновление выделения в Figma…')
      const response = await withCancel(bridgeServer.request(message), progress.signal)
      if (response.kind === 'error') {
        const error = (response as ErrorMessage).payload.message
        progress.finish(false, error)
        return { ok: false, error }
      }
      const payload = (response as ResponseMessage).payload as { appliedTo?: number; skipped?: string[] }
      progress.finish(true, `Обновлено: ${payload.appliedTo ?? 0}`)
      return { ok: true, appliedTo: payload.appliedTo, skipped: payload.skipped }
    } catch (err) {
      const error = (err as Error).message
      progress.finish(false, error)
      return { ok: false, error }
    }
  })

  // Панель ассетов (по запросу пользователя) — сканирует ВСЮ активную
  // вкладку, не привязано к текущему выбору через Inspector (см. assetScanner.ts).
  ipcMain.handle('assets:scan', async (): Promise<AssetScanResult> => {
    const wc = browserController?.getWebContents()
    if (!wc) return { assets: [], truncated: false }
    return scanPageAssets(wc)
  })

  ipcMain.handle('assets:copy', (_e, asset: ScannedAsset): ImportResult => {
    try {
      if (asset.mimeType === 'image/svg+xml') {
        // Копировать растровым изображением бессмысленно — это же исходный
        // код, а не пиксели; текстом можно вставить куда угодно (в код,
        // в Figma через "paste as SVG", и т.д.).
        const commaIndex = asset.data.indexOf(',')
        const markup = Buffer.from(asset.data.slice(commaIndex + 1), 'base64').toString('utf-8')
        clipboard.writeText(markup)
      } else {
        clipboard.writeImage(nativeImage.createFromDataURL(asset.data))
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('assets:send-to-figma', async (_e, asset: ScannedAsset): Promise<ImportResult> => {
    if (!bridgeServer || bridgeServer.connectionCount === 0) {
      return { ok: false, error: 'Figma plugin не подключён — см. Bridge в toolbar' }
    }
    const progress = createImportProgress('Импорт ассета')
    const message = createMessage<PlaceAssetMessage>('place-asset', {
      assetKind: asset.kind,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      data: asset.data
    })
    try {
      progress.update('sending', 0.55, 'Отправка ассета в Figma…')
      const response = await withCancel(bridgeServer.request(message), progress.signal)
      if (response.kind === 'error') {
        const error = (response as ErrorMessage).payload.message
        progress.finish(false, error)
        return { ok: false, error }
      }
      progress.finish(true)
      return { ok: true }
    } catch (err) {
      const error = (err as Error).message
      progress.finish(false, error)
      return { ok: false, error }
    }
  })

  ipcMain.handle('components:scan', async (): Promise<ComponentScanResult> => {
    const wc = browserController?.getWebContents()
    if (!wc) return { components: [], truncated: false }
    let result: ComponentScanResult
    try {
      result = await scanPageComponents(wc)
    } catch (err) {
      // Навигация может закрыть target между load-finished и автосканом. Это
      // нормальная отмена устаревшей работы, а не ошибка всего IPC-пайплайна.
      log.debug('component scan cancelled', { message: (err as Error).message })
      return { components: [], truncated: false }
    }
    const tabId = browserController?.getActiveTabId()
    const pageUrl = browserController?.getState().url ?? ''
    const viewport = browserController?.getViewportSize() ?? { width: 0, height: 0 }
    if (tabId && pageUrl && result.components.length > 0) {
      const token = Symbol(pageUrl)
      componentPreviewJobs.set(tabId, token)
      // Список кандидатов возвращается сразу. Скрытый renderer стартует на
      // следующем tick и присылает готовые изображения по одному.
      setTimeout(() => {
        void captureComponentPreviewsOffscreen(
          wc,
          pageUrl,
          result.components,
          viewport,
          (selector, thumbnail) => {
            if (componentPreviewJobs.get(tabId) !== token || mainWindow?.isDestroyed()) return
            mainWindow?.webContents.send('components:preview-ready', { tabId, pageUrl, selector, thumbnail })
          },
          () => componentPreviewJobs.get(tabId) === token
        ).finally(() => {
          if (componentPreviewJobs.get(tabId) === token) componentPreviewJobs.delete(tabId)
        })
      }, 0)
    }
    return result
  })

  ipcMain.handle(
    'components:preview',
    async (_e, component: ScannedComponent): Promise<ComponentPreviewResult> => {
      const wc = browserController?.getWebContents()
      if (!wc) return { ok: false, error: 'Нет открытой страницы' }
      if (!component.selector || component.selector.length > 4000) {
        return { ok: false, error: 'Некорректный кандидат компонента' }
      }
      let thumbnail: string | undefined
      await captureComponentPreviewsOffscreen(
        wc,
        browserController?.getState().url ?? '',
        [component],
        browserController?.getViewportSize() ?? { width: 0, height: 0 },
        (_selector, value) => {
          thumbnail = value
        }
      )
      return thumbnail
        ? { ok: true, thumbnail }
        : { ok: false, error: 'Элемент больше не найден на странице — запустите скан ещё раз' }
    }
  )

  ipcMain.handle('components:import', async (_e, component: ScannedComponent): Promise<ImportResult> => {
    if (!bridgeServer || bridgeServer.connectionCount === 0) {
      return { ok: false, error: 'Figma plugin не подключён — см. Bridge в toolbar' }
    }
    const wc = browserController?.getWebContents()
    if (!wc) return { ok: false, error: 'Нет открытой страницы' }
    if (!component.selector || component.selector.length > 4000) return { ok: false, error: 'Некорректный кандидат компонента' }
    const progress = createImportProgress('Импорт распознанного компонента')
    const startedAt = performance.now()

    try {
      progress.update('preparing', 0.08, 'Чтение DOM, стилей и ассетов…')
      const document = await captureComponentDocument(
        wc,
        component.selector,
        browserController?.getState().url ?? '',
        browserController?.getViewportSize() ?? { width: 0, height: 0 }
      )
      if (!document) {
        progress.finish(false, 'Элемент больше не найден')
        return { ok: false, error: 'Элемент больше не найден на странице — запустите скан ещё раз' }
      }
      const preparedAt = performance.now()
      const saved = await readJson<Partial<AppSettings>>(settingsPath())
      const settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) }
      const message = createMessage<ImportNodeMessage>('import-node', {
        document,
        as: 'component',
        useMatchedTextStyles: settings.useMatchedTextStyles,
        useMatchedColorStyles: settings.useMatchedColorStyles,
        colorMatchSource: settings.colorMatchSource,
        alsoCreateInstance: settings.alsoCreateInstance
      })
      progress.update('sending', 0.62, `DOM готов за ${((preparedAt - startedAt) / 1000).toFixed(1)} с · создание в Figma…`)
      const response = await withCancel(bridgeServer.request(message), progress.signal)
      if (response.kind === 'error') {
        const error = (response as ErrorMessage).payload.message
        progress.finish(false, error)
        return { ok: false, error }
      }
      progress.finish(true, `Готово за ${((performance.now() - startedAt) / 1000).toFixed(1)} с`)
      return { ok: true }
    } catch (err) {
      const error = (err as Error).message
      progress.finish(false, error)
      return { ok: false, error }
    }
  })
}

app.whenReady().then(async () => {
  registerIpc()
  registerAutoUpdater()
  await recentSites.load()
  await projectsStore.load()
  await referenceItemsStore.load()
  await standaloneReferenceSitesStore.load()
  try {
    // Провал старта bridge (порт занят даже во ВСЁМ fallback-диапазоне —
    // см. PORT_FALLBACK_RANGE, зафиксировано живьём: за долгую сессию с
    // множеством перезапусков dev-режима скопились зависшие процессы,
    // державшие все 10 портов подряд) НЕ должен ронять весь app.whenReady()
    // и оставлять пользователя без единого окна и без единой ошибки на
    // экране — окно должно открыться в любом случае, просто индикатор
    // Bridge покажет "не подключено".
    await startBridge()
  } catch (err) {
    log.error('bridge failed to start — window will still open', { message: (err as Error).message })
  }
  createWindow()
  scheduleUpdateChecks()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// try/catch — намеренная защита от повтора живого бага: необработанное
// исключение внутри bridgeServer.stop() (см. onConnectionCountChange выше)
// раньше обрывало выполнение ДО следующей строки — app.quit() просто не
// успевал вызваться, и процессы зависали (видно в Диспетчере задач как
// живые "Web To Figma.exe" после закрытия окна). Закрытие окна должно
// приводить к реальному выходу из приложения ВСЕГДА, что бы ни случилось с
// остановкой bridge.
app.on('window-all-closed', () => {
  try {
    bridgeServer?.stop()
  } catch (err) {
    log.error('bridge stop failed on window-all-closed', { message: (err as Error).message })
  }
  if (process.platform !== 'darwin') app.quit()
})

// Дублирует остановку bridge из window-all-closed — эта ветка не всегда
// срабатывает (напр. programmatic app.quit() без предварительного закрытия
// окна, или macOS Cmd+Q через меню), а держащийся порт мешает следующему
// запуску (см. docs/architecture.md — по этой причине port-fallback
// исчерпывался за долгую сессию). stop() безопасно вызывать повторно —
// внутри уже проверяет null.
app.on('before-quit', () => {
  try {
    bridgeServer?.stop()
  } catch (err) {
    log.error('bridge stop failed on before-quit', { message: (err as Error).message })
  }
})
