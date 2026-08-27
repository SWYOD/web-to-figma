import { app, BrowserWindow, clipboard, ipcMain, nativeImage, shell } from 'electron'
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
import { BrowserController } from './browser'
import { attachEditContextMenu } from './contextMenu'
import { ElementPicker } from './inspector'
import { RecentSitesStore } from './recentSites'
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
  QueueImportResult,
  QueueItemSummary,
  RecentSite,
  ScannedAsset,
  ScannedComponent,
  SelectionResult,
  TabsSnapshot,
  ViewBounds
} from '../shared/types'

// Явно, а не полагаясь на автоопределение по package.json (у scoped-имени
// "@web-to-figma/desktop" оно ненадёжно) — фиксирует путь app.getPath('userData')
// независимо от того, как запущен процесс (electron-vite dev / packaged build).
app.setName('web-to-figma')
if (!app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', '9333')

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
  themeSyncEnabled: true
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
let elementPicker: ElementPicker | null = null
let overlayController: OverlayController | null = null
const componentPreviewJobs = new Map<string, symbol>()
let importProgressSequence = 0

function createImportProgress(label: string, total = 1): {
  update: (phase: ImportProgressEvent['phase'], progress: number, detail?: string, current?: number) => void
  finish: (ok: boolean, detail?: string) => void
} {
  const id = `import-${Date.now()}-${++importProgressSequence}`
  const emit = (event: Omit<ImportProgressEvent, 'id' | 'label' | 'total'>): void => {
    mainWindow?.webContents.send('import:progress', { id, label, total, ...event } satisfies ImportProgressEvent)
  }
  emit({ state: 'running', phase: 'preparing', progress: 0, detail: 'Подготовка…' })
  return {
    update: (phase, progress, detail, current) =>
      emit({
        state: 'running',
        phase,
        progress: Math.max(0, Math.min(1, progress)),
        ...(detail ? { detail } : {}),
        ...(current !== undefined ? { current } : {})
      }),
    finish: (ok, detail) =>
      emit({
        state: ok ? 'success' : 'error',
        phase: 'complete',
        progress: 1,
        detail: detail ?? (ok ? 'Готово' : 'Ошибка')
      })
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

function repositionToolbarOverlay(): void {
  if (overlaySuppressed) {
    overlayController?.hide()
    return
  }
  const bounds = browserViewportBounds
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    overlayController?.hide()
    return
  }
  // Не шире самой браузерной области — иначе при очень узком окне тулбар
  // вылезал бы за его пределы вместо того, чтобы хотя бы прижаться к краям.
  const width = Math.min(toolbarOverlayWidth, bounds.width)
  const x = Math.round(bounds.x + bounds.width / 2 - width / 2)
  const anchorBottom = bounds.y + bounds.height - TOOLBAR_BOTTOM_GAP
  overlayController?.setBounds({
    x,
    y: Math.round(anchorBottom - toolbarOverlayHeight),
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(toolbarOverlayHeight))
  })
}

const recentSites = new RecentSitesStore((list) => mainWindow?.webContents.send('recent-sites:updated', list))

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
    () => overlayController?.send('overlay:collapse-popover', undefined)
  )
  browserController.mount()

  elementPicker = new ElementPicker(
    () => browserController?.getWebContents() ?? null,
    // Тоже overlayController.send — ApplyToSelectionContent живёт в overlay-
    // рендерере (отдельный webContents, см. overlay.ts), не в главном окне;
    // без этого он никогда не узнаёт, что элемент выбран (см. живой баг:
    // "Сначала выберите элемент" при уже выбранном в главном окне элементе).
    (result: SelectionResult) => {
      mainWindow?.webContents.send('inspector:selection', result)
      overlayController?.send('inspector:selection', result)
    },
    // Тоже в оба webContents — PickerFloatBar (активная подсветка кнопки,
    // Esc/повторный клик по кнопке для отмены) живёт в overlay-рендерере, не
    // в главном окне (см. комментарий у onSelect выше); без этого
    // `pick.active` там навсегда оставался бы false после первого события,
    // и повторный клик по кнопке пикера в тулбаре запускал бы pick заново
    // вместо остановки (живой баг).
    (state: PickState) => {
      mainWindow?.webContents.send('inspector:pick-state', state)
      overlayController?.send('inspector:pick-state', state)
    },
    // Queue-режим (мульти-импорт) — попап "Добавить/Отменить" живёт в
    // overlay-рендерере, та же причина double-send, что и выше.
    (item: QueueItemSummary) => {
      mainWindow?.webContents.send('inspector:queue-pending', item)
      overlayController?.send('inspector:queue-pending', item)
    },
    (items: QueueItemSummary[]) => {
      mainWindow?.webContents.send('inspector:queue-updated', items)
      overlayController?.send('inspector:queue-updated', items)
    },
    // Esc со уже выбранным элементом (см. inspector.ts clearSelection) — та
    // же причина double-send, что и у onSelect выше: hasSelection живёт
    // локальным state и в главном окне (InspectorPanel), и в overlay-
    // рендерере (PickerFloatBar/OverlayRoot).
    () => {
      mainWindow?.webContents.send('inspector:selection-cleared')
      overlayController?.send('inspector:selection-cleared', undefined)
    },
    () => browserController?.getActiveTabId() ?? null,
    (tabId) => browserController?.getWebContentsForTab(tabId) ?? null,
    () => browserController?.getViewportSize() ?? { width: 0, height: 0 }
    // getEffectiveTheme, getViewScreenBounds // 8-й/9-й аргумент для кастомного тултипа, см. inspector.ts
  )

  // Overlay монтируется ПОСЛЕ browser-пейна — addChildView упорядочен по
  // времени добавления, поздние дети рисуются НАД более ранними (см. overlay.ts).
  const devUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  overlayController = new OverlayController()
  overlayController.mount(mainWindow, devUrl)
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

function registerIpc(): void {
  ipcMain.handle('settings:get', async (): Promise<AppSettings> => {
    const saved = await readJson<Partial<AppSettings>>(settingsPath())
    return { ...DEFAULT_SETTINGS, ...(saved ?? {}) }
  })

  ipcMain.handle('settings:save', async (_e, settings: AppSettings): Promise<void> => {
    await writeJson(settingsPath(), settings)
  })

  ipcMain.handle('theme:sync-plugin', (_e, theme: ThemeSyncMessage['payload']): void => {
    latestPluginTheme = createMessage<ThemeSyncMessage>('theme-sync', theme)
    bridgeServer?.broadcast(latestPluginTheme)
  })

  ipcMain.handle('app:get-version', (): string => app.getVersion())

  ipcMain.handle('bridge:get-info', (): BridgeInfo => bridgeInfo)

  ipcMain.handle('browser:navigate', (_e, input: string): void => browserController?.navigate(input))
  ipcMain.handle('browser:back', (): void => browserController?.back())
  ipcMain.handle('browser:forward', (): void => browserController?.forward())
  ipcMain.handle('browser:reload', (): void => browserController?.reload())
  ipcMain.handle('browser:stop', (): void => browserController?.stop())
  ipcMain.handle('browser:set-bounds', (_e, bounds: ViewBounds): void => {
    browserController?.setBounds(bounds)
    browserViewportBounds = bounds
    repositionToolbarOverlay()
  })
  ipcMain.handle('browser:set-hidden', (_e, hidden: boolean): void => browserController?.setHidden(hidden))
  ipcMain.handle('overlay:set-suppressed', (_e, suppressed: boolean): void => {
    overlaySuppressed = suppressed
    repositionToolbarOverlay()
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

  // Тулбар теперь ВСЕГДА показан (не открывается/закрывается по запросу) —
  // единственное, что реально меняется динамически, это его высота (раскрыт
  // ли внутри него Apply to Selection popover, см. OverlayRoot.tsx).
  ipcMain.handle('overlay:report-size', (_e, size: OverlaySize): void => {
    toolbarOverlayWidth = size.width
    toolbarOverlayHeight = size.height
    repositionToolbarOverlay()
  })

  ipcMain.handle('inspector:start-pick', () => elementPicker?.start())
  ipcMain.handle('inspector:stop-pick', () => elementPicker?.stop())
  // Правая панель могла быть закрыта в момент клика пикером (пропустила
  // live-событие 'inspector:selection') — при открытии подхватывает уже
  // сделанный выбор через этот запрос вместо того, чтобы показывать пустое
  // состояние, пока пользователь не кликнет заново.
  ipcMain.handle('inspector:get-last-selection', (): SelectionResult | null => elementPicker?.getLastSelection() ?? null)

  // Queue-режим (мульти-импорт) — см. inspector.ts ElementPicker класс-докстринг.
  ipcMain.handle('inspector:set-queue-mode', (_e, active: boolean): void => elementPicker?.setQueueMode(active))
  ipcMain.handle('inspector:queue-confirm-add', (): void => elementPicker?.confirmQueueAdd())
  ipcMain.handle('inspector:queue-confirm-cancel', (): void => elementPicker?.confirmQueueCancel())
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
        const response = await bridgeServer.request(message)
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
        const response = await bridgeServer.request(message, FULL_PAGE_IMPORT_TIMEOUT_MS)
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
        const response = await bridgeServer.request(message)
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
          const response = await bridgeServer.request(message)
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
      const response = await bridgeServer.request(message)
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
      const response = await bridgeServer.request(message)
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
      const response = await bridgeServer.request(message)
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
