import type { ConversionWarning } from '@web-to-figma/design-ast'
import type { ApplyStylesMessage } from '@web-to-figma/bridge-protocol'

/** Дублирует ThemeMode из @web-to-figma/ui намеренно: main-процесс не должен
 *  тянуть React/JSX-пакет только ради одного union-типа (см. tsconfig.node.json,
 *  которому не нужны jsx/DOM lib). */
export type ThemeMode = 'light' | 'dark' | 'system'

/** Дублирует ThemeVars/ThemeVariant/ThemeDef из @web-to-figma/ui теми же
 *  причинами, что и ThemeMode выше — main-процесс только читает/пишет их как
 *  данные (settings:get/settings:save), никогда не применяет как CSS, поэтому
 *  не нужно тянуть пакет с DOM-зависимым apply.ts. Структурно идентичны
 *  packages/ui/src/theme/tokens.ts — TS считает их взаимозаменяемыми. */
export interface ThemeVars {
  bg: string
  'bg-panel': string
  'bg-canvas': string
  surface: string
  'surface-2': string
  hover: string
  border: string
  'border-strong': string
  text: string
  'text-dim': string
  'text-faint': string
  accent: string
  'accent-soft': string
  'accent-text': string
  danger: string
  warning: string
  info: string
  success: string
  shadow: string
}

export interface ThemeVariant {
  vars: ThemeVars
}

export interface ThemeDef {
  id: string
  name: string
  dark: boolean
  vars: ThemeVars
  builtin?: boolean
  altVariant?: ThemeVariant
}

export interface AppSettings {
  themeMode: ThemeMode
  /** id активной темы — встроенной (см. @web-to-figma/ui BUILTIN_THEMES) или из customThemes. */
  themeId: string
  /** Темы, созданные пользователем в редакторе темы (см. ThemeEditorModal). */
  customThemes: ThemeDef[]
  /** Import as Frame: подбирать ближайший локальный text/paint style проекта
   *  вместо "голых" значений — см. apps/figma-plugin/renderers/styleMatching.ts. */
  useMatchedStyles: boolean
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

export interface ElementLayout {
  display: string
  position: string
  /** Уже свёрнуто в CSS shorthand-подобную строку ("0", "0 16", "8 12 8 12"). */
  padding: string
  flexDirection: string | null
  justifyContent: string | null
  alignItems: string | null
  gap: string | null
}

export interface ElementTypography {
  fontFamily: string
  fontSize: string
  fontWeight: string
  lineHeight: string
  letterSpacing: string
  textAlign: string
  color: string
}

export interface ElementAppearance {
  backgroundColor: string
  /** null — border отсутствует (border-style: none / width 0). */
  border: string | null
  /** Свёрнуто аналогично padding; null — радиус нулевой. */
  borderRadius: string | null
  /** Сырое значение computed box-shadow; "none" — тени нет. */
  boxShadow: string
}

export interface ElementSummary {
  tag: string
  id: string | null
  classes: string[]
  width: number
  height: number
  layout: ElementLayout
  typography: ElementTypography
  appearance: ElementAppearance
}

export interface PickState {
  active: boolean
  error: string | null
}

export interface SelectionResult {
  element: ElementSummary
  /** Диагностика conversion-engine (Phase 5) для этого же элемента — см. docs/conversion-rules.md. */
  diagnostics: ConversionWarning[]
}

export interface ImportResult {
  ok: boolean
  error?: string
}

/** bridge-protocol — обычный изоморфный пакет (не React/DOM-ориентированный,
 *  в отличие от @web-to-figma/ui), main уже импортирует его типы напрямую
 *  (см. index.ts) — здесь не дублируем форму, а берём как есть. */
export type ApplyStylesTargets = ApplyStylesMessage['payload']['targets']

export interface ApplyStylesResult {
  ok: boolean
  appliedTo?: number
  skipped?: string[]
  error?: string
}

/** Одна запись истории посещений встроенного браузера (см. main/recentSites.ts). */
export interface RecentSite {
  url: string
  title: string
  faviconUrl: string | null
  /** ISO timestamp последнего перехода на этот URL (для сортировки most-recent-first). */
  visitedAt: string
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
  /** Прячет нативный WebContentsView (нулевые bounds) на время, пока открыт
   *  popover/модалка, которая визуально заходит в browser area — см.
   *  usePopoverVisibility и main/browser.ts класс-docstring. */
  browserSetHidden: (hidden: boolean) => Promise<void>
  browserGetState: () => Promise<BrowserState>
  onBrowserState: (cb: (state: BrowserState) => void) => () => void

  inspectorStartPick: () => Promise<void>
  inspectorStopPick: () => Promise<void>
  onInspectorPickState: (cb: (state: PickState) => void) => () => void
  onInspectorSelection: (cb: (result: SelectionResult) => void) => () => void
  inspectorImportAsFrame: (useMatchedStyles: boolean) => Promise<ImportResult>
  inspectorApplyStyles: (targets: ApplyStylesTargets) => Promise<ApplyStylesResult>

  recentSitesGet: () => Promise<RecentSite[]>
  recentSitesRemove: (url: string) => Promise<void>
  onRecentSitesUpdated: (cb: (list: RecentSite[]) => void) => () => void
}
