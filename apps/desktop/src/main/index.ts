import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join, dirname } from 'path'
import { promises as fs } from 'fs'
import { nanoid } from 'nanoid'
import { BridgeServer } from '@web-to-figma/bridge-protocol/server'
import { createMessage, type ErrorMessage, type ImportNodeMessage } from '@web-to-figma/bridge-protocol'
import { createConsoleLogger } from '@web-to-figma/shared'
import { BrowserController } from './browser'
import { ElementPicker } from './inspector'
import type { AppSettings, BridgeInfo, ImportResult, PickState, SelectionResult, ViewBounds } from '../shared/types'

// Явно, а не полагаясь на автоопределение по package.json (у scoped-имени
// "@web-to-figma/desktop" оно ненадёжно) — фиксирует путь app.getPath('userData')
// независимо от того, как запущен процесс (electron-vite dev / packaged build).
app.setName('web-to-figma')

const isDev = !app.isPackaged
const log = createConsoleLogger('main')

const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'system'
}

interface BridgeSecret {
  token: string
  port: number | null
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

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
    (state) => mainWindow?.webContents.send('browser:state', state),
    () => elementPicker?.stopIfActive()
  )
  browserController.mount()

  elementPicker = new ElementPicker(
    () => browserController?.getWebContents() ?? null,
    (result: SelectionResult) => mainWindow?.webContents.send('inspector:selection', result),
    (state: PickState) => mainWindow?.webContents.send('inspector:pick-state', state)
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
}

app.whenReady().then(async () => {
  registerIpc()
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
