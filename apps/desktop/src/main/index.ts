import { app, BrowserWindow, ipcMain, shell } from 'electron'
// import { nativeTheme, type Rectangle } from 'electron' // нужно, если включить getEffectiveTheme/getViewScreenBounds ниже
import { join, dirname } from 'path'
import { promises as fs } from 'fs'
import { nanoid } from 'nanoid'
import { BridgeServer } from '@web-to-figma/bridge-protocol/server'
import { createMessage, type ApplyStylesMessage, type ErrorMessage, type ImportNodeMessage, type ResponseMessage } from '@web-to-figma/bridge-protocol'
import { createConsoleLogger } from '@web-to-figma/shared'
import { BrowserController } from './browser'
import { ElementPicker } from './inspector'
import { RecentSitesStore } from './recentSites'
import type {
  AppSettings,
  ApplyStylesResult,
  ApplyStylesTargets,
  BridgeInfo,
  ImportResult,
  PickState,
  RecentSite,
  SelectionResult,
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
  customThemes: []
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
    (state) => {
      mainWindow?.webContents.send('browser:state', state)
      // title/favicon приходят отдельными событиями ПОСЛЕ did-navigate — каждый
      // патч state уточняет уже записанную визитом запись (см. RecentSitesStore).
      void recentSites.updateLatestMeta(state.url, { title: state.title, faviconUrl: state.faviconUrl })
    },
    (url) => {
      elementPicker?.stopIfActive()
      void recentSites.recordVisit(url)
    }
  )
  browserController.mount()

  elementPicker = new ElementPicker(
    () => browserController?.getWebContents() ?? null,
    (result: SelectionResult) => mainWindow?.webContents.send('inspector:selection', result),
    (state: PickState) => mainWindow?.webContents.send('inspector:pick-state', state)
    // getEffectiveTheme, getViewScreenBounds // 4-й/5-й аргумент для кастомного тултипа, см. inspector.ts
  )

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
  ipcMain.handle('browser:get-state', () => browserController?.getState())

  ipcMain.handle('inspector:start-pick', () => elementPicker?.start())
  ipcMain.handle('inspector:stop-pick', () => elementPicker?.stop())

  ipcMain.handle('recent-sites:get', (): RecentSite[] => recentSites.getAll())
  ipcMain.handle('recent-sites:remove', async (_e, url: string): Promise<void> => {
    await recentSites.remove(url)
  })

  ipcMain.handle('inspector:import-as-frame', async (): Promise<ImportResult> => {
    const document = elementPicker?.buildDocument(
      browserController?.getState().url ?? '',
      browserController?.getViewportSize() ?? { width: 0, height: 0 }
    )
    if (!document) return { ok: false, error: 'Сначала выберите элемент' }
    if (!bridgeServer || bridgeServer.connectionCount === 0) {
      return { ok: false, error: 'Figma plugin не подключён — см. Bridge в toolbar' }
    }

    const message = createMessage<ImportNodeMessage>('import-node', { document, as: 'frame' })
    try {
      const response = await bridgeServer.request(message)
      if (response.kind === 'error') return { ok: false, error: (response as ErrorMessage).payload.message }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

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
}

app.whenReady().then(async () => {
  registerIpc()
  await recentSites.load()
  await startBridge()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  bridgeServer?.stop()
  if (process.platform !== 'darwin') app.quit()
})
