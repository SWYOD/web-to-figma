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
  type ResponseMessage
} from '@web-to-figma/bridge-protocol'
import { createConsoleLogger } from '@web-to-figma/shared'
import { BrowserController } from './browser'
import { ElementPicker } from './inspector'
import { RecentSitesStore } from './recentSites'
import { OverlayController } from './overlay'
import { scanPageAssets } from './assetScanner'
import { registerAutoUpdater, scheduleUpdateChecks } from './autoUpdater'
import type {
  AppSettings,
  ApplyStylesResult,
  ApplyStylesTargets,
  AssetScanResult,
  BridgeInfo,
  ColorMatchSource,
  ImportResult,
  OverlayOpenPayload,
  OverlaySize,
  PickState,
  RecentSite,
  ScannedAsset,
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
  colorMatchSource: 'style'
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
let bridgeInfo: BridgeInfo = { port: 0, pairingToken: '', connectionCount: 0 }
let browserController: BrowserController | null = null
let elementPicker: ElementPicker | null = null
let overlayController: OverlayController | null = null
/** Какой попап сейчас показан в overlay-слое (см. overlay.ts) — единственный
 *  источник правды, транслируется ОБОИМ рендерерам (главному окну — чтобы
 *  кнопка-якорь знала, что её попап открыт/закрыт, и самому overlay —
 *  какой контент рисовать), поэтому Escape/клик-снаружи/потеря фокуса
 *  браузером всегда закрывают попап согласованно в обоих местах. */
let overlayKind: string | null = null
/** x/width заданы вызывающей стороной один раз при открытии, anchorTop —
 *  верх кнопки-якоря; height пересчитывается на каждый `overlay:report-size`
 *  от overlay-рендерера (реальная высота контента заранее неизвестна) — см.
 *  applyOverlayBounds(). */
let overlayGeometry: { x: number; width: number; anchorTop: number } | null = null

const OVERLAY_GAP = 6
// Разумная стартовая оценка высоты — применяется СРАЗУ при открытии, пока
// overlay ещё не успел измерить и прислать реальную (см. applyOverlayBounds) —
// нижний край попапа считается от неё так же, как от реальной, поэтому даже
// эта оценка уже прижата к якорю корректно, просто верх box'а (невидим,
// прозрачный фон) может на кадр оказаться чуть выше/ниже настоящего.
const OVERLAY_INITIAL_HEIGHT_GUESS = 420

function applyOverlayBounds(height: number): void {
  if (!overlayGeometry) return
  const { x, width, anchorTop } = overlayGeometry
  overlayController?.setBounds({
    x,
    y: Math.round(anchorTop - OVERLAY_GAP - height),
    width,
    height: Math.max(1, Math.ceil(height))
  })
}

function setOverlay(kind: string | null, geometry?: { x: number; width: number; anchorTop: number }): void {
  overlayKind = kind
  overlayGeometry = kind ? (geometry ?? null) : null
  if (overlayGeometry) applyOverlayBounds(OVERLAY_INITIAL_HEIGHT_GUESS)
  else overlayController?.hide()
  mainWindow?.webContents.send('overlay:content', kind)
  overlayController?.send('overlay:content', kind)
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
    () => setOverlay(null)
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
    (state: PickState) => mainWindow?.webContents.send('inspector:pick-state', state)
    // getEffectiveTheme, getViewScreenBounds // 4-й/5-й аргумент для кастомного тултипа, см. inspector.ts
  )

  // Overlay монтируется ПОСЛЕ browser-пейна — addChildView упорядочен по
  // времени добавления, поздние дети рисуются НАД более ранними (см. overlay.ts).
  const devUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  overlayController = new OverlayController()
  overlayController.mount(mainWindow, devUrl)
  // Окно сдвинулось/изменило размер — bounds overlay'я считаны от старой
  // позиции анкера в renderer'е и больше не актуальны, закрываем, а не
  // показываем неправильно расположенный попап.
  mainWindow.on('resize', () => setOverlay(null))
  mainWindow.on('move', () => setOverlay(null))

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
      mainWindow?.webContents.send('bridge:status', { connectionCount: count })
    },
    onMessage: (message) => {
      // Ответы на запросы desktop (ImportNode и т.д.) перехватываются
      // BridgeServer.request() раньше этого колбэка — сюда попадают только
      // сообщения, ИНИЦИИРОВАННЫЕ плагином (напр. будущий GetSelectionMessage, Phase 10+).
      log.debug('bridge message received', { kind: message.kind })
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

  ipcMain.handle('app:get-version', (): string => app.getVersion())

  ipcMain.handle('bridge:get-info', (): BridgeInfo => bridgeInfo)

  ipcMain.handle('browser:navigate', (_e, input: string): void => browserController?.navigate(input))
  ipcMain.handle('browser:back', (): void => browserController?.back())
  ipcMain.handle('browser:forward', (): void => browserController?.forward())
  ipcMain.handle('browser:reload', (): void => browserController?.reload())
  ipcMain.handle('browser:stop', (): void => browserController?.stop())
  ipcMain.handle('browser:set-bounds', (_e, bounds: ViewBounds): void => browserController?.setBounds(bounds))
  ipcMain.handle('browser:set-hidden', (_e, hidden: boolean): void => browserController?.setHidden(hidden))

  // Пикер держит CDP debugger-сессию на КОНКРЕТНОМ webContents активной
  // вкладки (см. inspector.ts) — переключение/закрытие вкладки меняет,
  // какой webContents видим, поэтому сбрасываем активный pick-режим, чтобы
  // не остаться привязанными к уже невидимой вкладке.
  ipcMain.handle('browser:new-tab', (): void => {
    elementPicker?.stopIfActive()
    browserController?.newTab()
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

  ipcMain.handle('overlay:open', (_e, payload: OverlayOpenPayload): void => {
    setOverlay(payload.kind, { x: payload.x, width: payload.width, anchorTop: payload.anchorTop })
  })
  ipcMain.handle('overlay:close', (): void => setOverlay(null))
  ipcMain.handle('overlay:report-size', (_e, size: OverlaySize): void => applyOverlayBounds(size.height))

  ipcMain.handle('inspector:start-pick', () => elementPicker?.start())
  ipcMain.handle('inspector:stop-pick', () => elementPicker?.stop())
  // Правая панель могла быть закрыта в момент клика пикером (пропустила
  // live-событие 'inspector:selection') — при открытии подхватывает уже
  // сделанный выбор через этот запрос вместо того, чтобы показывать пустое
  // состояние, пока пользователь не кликнет заново.
  ipcMain.handle('inspector:get-last-selection', (): SelectionResult | null => elementPicker?.getLastSelection() ?? null)

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
      // См. inspector.ts CAPTURE_MIN_WIDTH — desktop-ширина применяется здесь,
      // один раз перед реальным импортом, а не на каждом клике пикера
      // (это раньше вызывало заметный "дёрг" видимой страницы на каждый клик).
      await elementPicker?.prepareForImport()
      const document = elementPicker?.buildDocument(
        browserController?.getState().url ?? '',
        browserController?.getViewportSize() ?? { width: 0, height: 0 }
      )
      if (!document) return { ok: false, error: 'Сначала выберите элемент' }
      if (!bridgeServer || bridgeServer.connectionCount === 0) {
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
        const response = await bridgeServer.request(message)
        if (response.kind === 'error') return { ok: false, error: (response as ErrorMessage).payload.message }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
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

    const message = createMessage<ApplyStylesMessage>('apply-styles', { document, targets })
    try {
      const response = await bridgeServer.request(message)
      if (response.kind === 'error') return { ok: false, error: (response as ErrorMessage).payload.message }
      const payload = (response as ResponseMessage).payload as { appliedTo?: number; skipped?: string[] }
      return { ok: true, appliedTo: payload.appliedTo, skipped: payload.skipped }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
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
    const message = createMessage<PlaceAssetMessage>('place-asset', {
      assetKind: asset.kind,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      data: asset.data
    })
    try {
      const response = await bridgeServer.request(message)
      if (response.kind === 'error') return { ok: false, error: (response as ErrorMessage).payload.message }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
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

app.on('window-all-closed', () => {
  bridgeServer?.stop()
  if (process.platform !== 'darwin') app.quit()
})

// Дублирует остановку bridge из window-all-closed — эта ветка не всегда
// срабатывает (напр. programmatic app.quit() без предварительного закрытия
// окна, или macOS Cmd+Q через меню), а держащийся порт мешает следующему
// запуску (см. docs/architecture.md — по этой причине port-fallback
// исчерпывался за долгую сессию). stop() безопасно вызывать повторно —
// внутри уже проверяет null.
app.on('before-quit', () => {
  bridgeServer?.stop()
})
