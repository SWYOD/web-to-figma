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
  /** Import as Component: создавать рядом ещё и один Instance, а не только
   *  сам компонент — см. PickerFloatBar "Import as Component". */
  alsoCreateInstance: boolean
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

/** См. main/overlay.ts — плавающий тулбар (pick/import/apply-to-selection)
 *  постоянно стоит НАД встроенным браузером, заякоренный к его нижнему краю
 *  и по центру (см. main/index.ts `repositionToolbarOverlay`,
 *  `browserViewportBounds`) — ни высота, ни ширина сюда не входят как
 *  константы, обе заранее неизвестны (раскрыт ли Apply to Selection popover;
 *  насколько широка подпись статуса вроде "Кликните на элемент страницы") —
 *  overlay сам измеряет себя (`ResizeObserver` на `.overlay-toolbar-stack`,
 *  см. OverlayRoot.tsx) и шлёт оба размера через `overlay:report-size`.
 *  Раньше ширина была захардкожена (`TOOLBAR_OVERLAY_WIDTH=300`) — живой
 *  баг: контент шире 300px (та самая подпись статуса) обрезался/скроллился
 *  внутри фиксированных bounds WebContentsView. */
export interface OverlaySize {
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

/** Один элемент в очереди мульти-импорта (см. main/inspector.ts ElementPicker
 *  queue-режим) — то же самое, что карточка в левой панели: достаточно
 *  данных для показа (тег/классы/размер), не полный DesignDocument (тот
 *  живёт только в main-процессе до момента реального импорта). */
export interface QueueItemSummary {
  id: string
  element: ElementSummary
}

export interface QueueImportResult {
  ok: boolean
  imported: number
  failed: number
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
  /** Уменьшенная копия `data` для превью в сетке — генерируется В MAIN-ПРОЦЕССЕ
   *  через sharp (см. assetScanner.ts), не на клиенте: `data` сканер отдаёт БЕЗ
   *  уменьшения (до 8MB, чтобы "Отправить в Figma" получал оригинал), а рендерить
   *  исходные байты в 72px-тайле дорого при десятках/сотнях тайлов — раньше
   *  миниатюра декодировалась в рендерере через `new Image()`+canvas и заметно
   *  подвешивала UI-поток (живой баг). До иконок не относится (SVG дешёвы). */
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
  /** См. usePopoverVisibility.ts — тот же счётчик open-попапов, но для
   *  overlay-тулбара (второй WebContentsView НАД браузером, см.
   *  main/overlay.ts): тот всегда рисуется поверх ВСЕГО окна, включая
   *  HTML-модалки вроде AssetLightbox, поэтому просто спрятать браузер
   *  (browserSetHidden) недостаточно — полноэкранная модалка всё равно
   *  перекрывалась бы плавающим тулбаром сверху (живой баг). */
  overlaySetSuppressed: (suppressed: boolean) => Promise<void>

  /** Overlay-рендерер сам измеряет свой реальный контент (ResizeObserver, см.
   *  OverlayRoot.tsx) и шлёт сюда высоту — main пересчитывает bounds так,
   *  чтобы нижний край плавающего тулбара оставался прижат к низу браузера
   *  (см. main/index.ts `repositionToolbarOverlay`). */
  overlayReportSize: (size: OverlaySize) => Promise<void>
  /** Клик В САМУ страницу (другой webContents, см. main/index.ts) должен
   *  закрыть раскрытый Apply to Selection popover — тот теперь локальный
   *  React state внутри overlay-рендерера, обычный document click-outside
   *  его не видит. */
  onOverlayCollapsePopover: (cb: () => void) => () => void

  browserNewTab: (url?: string) => Promise<void>
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
  /** Тот же одиночный pick, что Import as Frame, но корневая нода становится
   *  Figma Component (см. designNode.ts renderDesignNode `as` параметр) —
   *  отдельная кнопка на тулбаре, по запросу пользователя. */
  inspectorImportAsComponent: (
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource,
    alsoCreateInstance: boolean
  ) => Promise<ImportResult>
  inspectorApplyStyles: (targets: ApplyStylesTargets) => Promise<ApplyStylesResult>

  /** Queue-режим (мульти-импорт по запросу пользователя) — см.
   *  main/inspector.ts ElementPicker класс-докстринг про весь флоу. */
  inspectorSetQueueMode: (active: boolean) => Promise<void>
  /** Клик пикером при активном queue-режиме — вместо onInspectorSelection,
   *  ждёт confirmQueueAdd/Cancel (попап "Добавить/Отменить" в тулбаре). */
  onInspectorQueuePending: (cb: (item: QueueItemSummary) => void) => () => void
  onInspectorQueueUpdated: (cb: (items: QueueItemSummary[]) => void) => () => void
  inspectorQueueGet: () => Promise<QueueItemSummary[]>
  inspectorQueueConfirmAdd: () => Promise<void>
  inspectorQueueConfirmCancel: () => Promise<void>
  inspectorQueueRemove: (id: string) => Promise<void>
  inspectorQueueClear: () => Promise<void>
  inspectorImportQueue: (
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource
  ) => Promise<QueueImportResult>

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
