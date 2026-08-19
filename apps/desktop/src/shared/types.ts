/** Дублирует ThemeMode из @web-to-figma/ui намеренно: main-процесс не должен
 *  тянуть React/JSX-пакет только ради одного union-типа (см. tsconfig.node.json,
 *  которому не нужны jsx/DOM lib). */
export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppSettings {
  themeMode: ThemeMode
}

export interface BridgeInfo {
  port: number
  /** Код спаривания — показывается в UI, вставляется один раз в Figma Plugin. */
  pairingToken: string
  connectionCount: number
}

export interface BridgeStatusEvent {
  connectionCount: number
}

export interface BrowserState {
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  faviconUrl: string | null
  /** Текст последней неудачной загрузки главного фрейма (null — нет ошибки/уже перекрыта успешной загрузкой). */
  loadError: string | null
}

export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Api {
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<void>
  getAppVersion: () => Promise<string>
  getBridgeInfo: () => Promise<BridgeInfo>
  onBridgeStatus: (cb: (status: BridgeStatusEvent) => void) => () => void

  browserNavigate: (input: string) => Promise<void>
  browserBack: () => Promise<void>
  browserForward: () => Promise<void>
  browserReload: () => Promise<void>
  browserStop: () => Promise<void>
  browserSetBounds: (bounds: ViewBounds) => Promise<void>
  browserGetState: () => Promise<BrowserState>
  onBrowserState: (cb: (state: BrowserState) => void) => () => void
}
