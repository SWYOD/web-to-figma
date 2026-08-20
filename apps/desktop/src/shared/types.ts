import type { ConversionWarning } from '@web-to-figma/design-ast'
import type { ApplyStylesMessage } from '@web-to-figma/bridge-protocol'

/** Дублирует ColorMatchSource из apps/figma-plugin/renderers/styleMatching.ts —
 *  main-процесс desktop не импортирует код Figma-плагина, только этот union. */
export type ColorMatchSource = 'style' | 'variable'

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
  /** Import as Frame: подбирать ближайший локальный style проекта вместо
   *  "голых" значений, раздельно для шрифтов (text style) и цветов (paint
   *  style) — см. apps/figma-plugin/renderers/styleMatching.ts. */
  useMatchedTextStyles: boolean
  useMatchedColorStyles: boolean
  /** Только когда useMatchedColorStyles включён — 'style' (Paint Style,
   *  легаси) или 'variable' (Figma Variable) как источник для подбора цвета. */
  colorMatchSource: ColorMatchSource
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

/** Одна вкладка встроенного браузера — см. main/browser.ts (по одному
 *  `WebContentsView` на вкладку, видна только активная). */
export interface TabState extends BrowserState {
  id: string
}

export interface TabsSnapshot {
  tabs: TabState[]
  activeTabId: string | null
}

export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
}

/** См. main/overlay.ts — попап, который должен визуально стоять НАД
 *  встроенным браузером, а не прятать/подвинуть его. `x`/`width` заданы
 *  вызывающей стороной (сама знает свою ширину — фиксированная, как раньше
 *  делал CSS `.popover { min-width }`), `anchorTop` — верх якоря; `height`
 *  сюда НЕ входит — реальная высота попапа заранее неизвестна (зависит от
 *  контента), overlay сам измеряет себя и шлёт `overlay:report-size`, main
 *  пересчитывает `y = anchorTop - GAP - height` так, чтобы НИЖНИЙ край попапа
 *  всегда был прижат к якорю независимо от высоты контента. Координаты — в
 *  системе окна (DIP), той же, что `getBoundingClientRect()` в renderer, см.
 *  BrowserViewport.tsx. */
export interface OverlayOpenPayload {
  kind: string
  x: number
  width: number
  anchorTop: number
}

export interface OverlaySize {
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

/** Один ассет, найденный при сканировании всей страницы (см. main/assetScanner.ts,
 *  AssetsPanel.tsx) — не то же самое, что `DesignAsset` из @web-to-figma/design-ast:
 *  тот заточен под транспорт в DesignDocument (256KB inline-лимит, дедуп в
 *  рамках одного импорта), этот — под просмотр в панели (всегда inline,
 *  живёт только в desktop, дедуп в рамках одного скана страницы). */
export interface ScannedAsset {
  id: string
  /** SVG почти всегда иконка/логотип, растр — почти всегда фото/иллюстрация
   *  (см. assetScanner.ts) — простой предсказуемый дефолт классификации. */
  kind: 'icon' | 'image'
  mimeType: string
  width?: number
  height?: number
  sourceUrl?: string
  /** Готовый data: URL — прямо в `<img src>`, не нужно отдельно декодировать. */
  data: string
  /** Уменьшенная копия `data` для превью в сетке (см. BrowserPane.makeThumbnail) —
   *  растровые ассеты сканер отдаёт БЕЗ уменьшения (до 8MB, чтобы "Отправить в
   *  Figma" получал оригинал), рендерить исходные байты в 72px-тайле дорого при
   *  десятках/сотнях тайлов (декод полноразмерного изображения ради миниатюры).
   *  Заполняется на клиенте после скана, до иконок не относится (SVG дешёвы). */
  thumbnail?: string
}

export interface AssetScanResult {
  assets: ScannedAsset[]
  /** true — на странице было больше MAX_ASSETS элементов, часть не попала в результат. */
  truncated: boolean
}

/** Статус автообновления (electron-updater, см. main/autoUpdater.ts) — та же
 *  модель, что в Skill-tree: скачивание автоматическое, установка только по
 *  явному клику пользователя (см. UpdateBadge.tsx). */
export interface UpdateStatus {
  state: 'checking' | 'available' | 'not-available' | 'downloaded' | 'error'
  version?: string
  message?: string
}

export interface UpdateReadyInfo {
  version: string
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

  /** См. main/overlay.ts — открывает попап в отдельном composited-слое НАД
   *  браузером, ничего не пряча и не подвигая. */
  overlayOpen: (payload: OverlayOpenPayload) => Promise<void>
  overlayClose: () => Promise<void>
  /** Overlay-рендерер сам измеряет свой реальный контент (ResizeObserver, см.
   *  OverlayRoot.tsx) и шлёт сюда высоту — main пересчитывает bounds так,
   *  чтобы нижний край попапа оставался прижат к якорю (см. OverlayOpenPayload). */
  overlayReportSize: (size: OverlaySize) => Promise<void>
  /** `content` — `{kind}` открытого попапа или `null`; шлётся ОБОИМ рендерерам
   *  (главному окну и overlay) на любое изменение — единственный источник
   *  правды про то, что сейчас открыто (см. index.ts `setOverlay`). */
  onOverlayContent: (cb: (kind: string | null) => void) => () => void

  browserNewTab: () => Promise<void>
  browserCloseTab: (id: string) => Promise<void>
  browserSwitchTab: (id: string) => Promise<void>
  browserGetTabs: () => Promise<TabsSnapshot>
  onTabsState: (cb: (snapshot: TabsSnapshot) => void) => () => void

  inspectorStartPick: () => Promise<void>
  inspectorStopPick: () => Promise<void>
  onInspectorPickState: (cb: (state: PickState) => void) => () => void
  onInspectorSelection: (cb: (result: SelectionResult) => void) => () => void
  /** Текущий/последний выбор — для гидратации панели, если она была закрыта
   *  в момент клика пикером (см. main/inspector.ts getLastSelection). */
  inspectorGetLastSelection: () => Promise<SelectionResult | null>
  inspectorImportAsFrame: (
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource
  ) => Promise<ImportResult>
  inspectorApplyStyles: (targets: ApplyStylesTargets) => Promise<ApplyStylesResult>

  recentSitesGet: () => Promise<RecentSite[]>
  recentSitesRemove: (url: string) => Promise<void>
  onRecentSitesUpdated: (cb: (list: RecentSite[]) => void) => () => void

  /** Сканирует ВСЮ текущую активную вкладку (не поддерево выбора через
   *  Inspector) на иконки/картинки — см. main/assetScanner.ts. */
  assetsScan: () => Promise<AssetScanResult>
  /** Копирует ассет в системный буфер — картинку как изображение
   *  (`clipboard.writeImage`), SVG как текст разметки (`clipboard.writeText`,
   *  копировать растровым изображением бессмысленно — это же исходный код). */
  assetsCopy: (asset: ScannedAsset) => Promise<ImportResult>
  /** Создаёт в Figma отдельную ноду из ассета (image-fill прямоугольник или
   *  vector) — не полноценный DesignNode-импорт, только сам ассет. */
  assetsSendToFigma: (asset: ScannedAsset) => Promise<ImportResult>

  checkForUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void
  onUpdateReady: (cb: (info: UpdateReadyInfo) => void) => () => void
}
