import type { ConversionWarning } from '@web-to-figma/design-ast'
import type { ApplyStylesMessage, ThemeSyncMessage } from '@web-to-figma/bridge-protocol'

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
  /** Транслировать активную тему в Bridge Tools (theme-sync сообщение через
   *  bridgeServer) при каждой смене темы/режима — см. Shell в App.tsx. По
   *  умолчанию включено (сохраняет прежнее поведение, это был не-опциональный
   *  always-on пуш до появления тумблера). */
  themeSyncEnabled: boolean
  /** Как раскрываются панели по наведению на край в distraction-free режиме
   *  (см. App.tsx useEdgeReveal) — 'push' раздвигает browser-pane (см.
   *  App.tsx Workspace), 'float' рисует панель НАД ним в отдельном overlay-
   *  слое (см. main/overlay.ts, PanelOverlayRoot.tsx), тем же механизмом,
   *  что и generic popover overlay. По умолчанию 'push' — уже существовал
   *  до появления оверлей-архитектуры, 'float' добавлен по запросу
   *  пользователя как второй режим, не замена. */
  fullscreenMode: 'push' | 'float'
  /** Во время сбора референс-элементов (см. ReferenceItem) — false (дефолт)
   *  коммитит элемент сразу по "Добавить" с автоименем (tag#id/tag.class),
   *  переименование потом инлайн в карточке галереи; true открывает попап
   *  имя+описание сразу при добавлении (см. ReferenceNamePopoverContent.tsx).
   *  По запросу пользователя — оба варианта, дефолт быстрый, без печати. */
  referenceNamePromptOnAdd: boolean
  /** Пикер перед РЕАЛЬНЫМ импортом (Import as Frame/Component, полная
   *  страница) временно раскрывает CDP-viewport страницы до брейкпоинта
   *  ниже (см. main/inspector.ts withDesktopViewport) — чтобы адаптивная
   *  вёрстка резолвилась в этот вид независимо от реального размера окна
   *  встроенного браузера. По запросу пользователя — опционально:
   *  `forced: false` снимает документ как он выглядит СЕЙЧАС, в текущем
   *  реальном viewport, без override'а вообще; `width`/`height` — тот
   *  брейкпоинт, что форсится, когда `forced: true` (дефолт 1440×900 —
   *  прежнее хардкод-поведение, ничего не меняется, пока юзер не тронет
   *  настройку). */
  captureViewport: CaptureViewportSettings
  /** Миниатюра референс/queue-элемента (см. main/componentScanner.ts
   *  captureElementPreviewOffscreen, main/inspector.ts scheduleQueueThumbnail)
   *  по умолчанию обрезалась по границе viewport'а офскрин-окна — длинный
   *  блок (выше окна встроенного браузера) в миниатюру попадал не целиком.
   *  По запросу пользователя — опционально: true растягивает скрытое
   *  офскрин-окно под реальную высоту элемента ПЕРЕД снимком (окно всё
   *  равно невидимо пользователю, тут нечего "дёргать"), захватывая блок
   *  целиком; false — прежнее поведение, обрезка по видимой области. */
  captureFullBlockThumbnail: boolean
  /** "Поддержка свободного экрана" (по запросу пользователя) — НЕЗАВИСИМО от
   *  distractionFree (тот отдельно прячет верхний тулбар приложения и
   *  адресную строку/вкладки самого встроенного браузера — "контур
   *  полноэкранки браузеров", специально оставлен отдельным). Когда true:
   *  закрытая кнопкой в тулбаре боковая панель (leftOpen/rightOpen === false)
   *  не просто прячется, а становится hover-revealable — раскрывается по
   *  наведению на край, в виде 'push' или 'float' (см. fullscreenMode), тем
   *  же механизмом, что уже даёт distractionFree, но БЕЗ входа в
   *  полноэкранный режим целиком. Открытая кнопкой панель (=== true)
   *  показывается как обычно, без изменений. Дефолт false — сохраняет
   *  прежнее поведение (закрытая панель просто скрыта, без reveal). */
  sidePanelsHoverReveal: boolean
}

export interface CaptureViewportSettings {
  forced: boolean
  width: number
  height: number
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

/** Какой попап показать в generic popover overlay (см. main/overlay.ts,
 *  PopoverOverlayRoot.tsx) — 'kind' решает, какой React-компонент рендерить,
 *  'props' — его данные (должны быть сериализуемы, летят через IPC). Новый
 *  попап — новое значение kind + ветка в PopoverOverlayRoot, вся остальная
 *  проводка (open/close/reposition) переиспользуется как есть. */
export interface PopoverOpenParams {
  anchor: ViewBounds
  kind: 'add-to-project' | 'reference-name'
  props: unknown
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

/** Лёгкая проекция DOM-снапшота для компактного дерева в Inspector. */
export interface ElementTreeNode {
  key: string
  tag: string
  id: string | null
  classes: string[]
  text?: string
  children: ElementTreeNode[]
  /** CSS-путь для повторного поиска этого элемента на странице (тот же
   *  `sourceSelector`, что домSnapshot уже считает для полного скана
   *  страницы — см. DomSnapshotNode) — позволяет кликом по узлу дерева
   *  переключить текущее выделение на этот DOM-элемент (см.
   *  Api.inspectorSelectTreeNode). Отсутствует, если селектор не удалось
   *  посчитать — узел тогда просто не кликабелен. */
  sourceSelector?: string
}

export interface PickState {
  active: boolean
  error: string | null
}

export interface SelectionResult {
  element: ElementSummary
  tree: ElementTreeNode
  /** Непосредственный DOM-родитель выбранного элемента — только лёгкая
   *  подпись для контекста в дереве, без захвата всего соседнего поддерева. */
  treeParent: ElementTreeNode | null
  /** Диагностика conversion-engine (Phase 5) для этого же элемента — см. docs/conversion-rules.md. */
  diagnostics: ConversionWarning[]
}

export interface ImportResult {
  ok: boolean
  error?: string
  /** Сколько картинок не удалось скачать при импорте (по запросу
   *  пользователя — жёлтое предупреждение в тулбаре вместо тихой потери,
   *  см. main/domSnapshot.ts failedAssets). Undefined/0 — все картинки
   *  загрузились. */
  failedAssets?: number
}

export interface ImportProgressEvent {
  id: string
  state: 'running' | 'success' | 'error'
  phase: 'preparing' | 'sending' | 'complete'
  label: string
  detail?: string
  /** Нормализованное значение для верхнего progress bar. */
  progress: number
  current?: number
  total?: number
}

/** Один элемент в очереди мульти-импорта (см. main/inspector.ts ElementPicker
 *  queue-режим) — то же самое, что карточка в левой панели: достаточно
 *  данных для показа (тег/классы/размер), не полный DesignDocument (тот
 *  живёт только в main-процессе до момента реального импорта). */
export interface QueueItemSummary {
  id: string
  element: ElementSummary
  /** JPEG data: URL элемента в момент пика — качественный источник для
   *  полноэкранного просмотра, визуально уменьшаемый до миниатюры в карточке.
   *  Undefined — скриншот не удался (элемент нулевого размера и т.п.). */
  thumbnail?: string
}

export interface QueueImportResult {
  ok: boolean
  imported: number
  failed: number
  error?: string
}

/** Референс-элемент конкретного сайта (по запросу пользователя — референс
 *  теперь не просто закладка на весь сайт, а собранные пикером элементы с
 *  него), см. main/referenceItems.ts. Адресуется составным `siteKey`
 *  (`${projectId}::${url}`), а не отдельным id ProjectSite — `url` уже
 *  уникален внутри `project.sites` (дедуп в ProjectsStore.addSite) и уже
 *  единственный ключ во всех существующих projectsX-методах, заводить
 *  параллельный id ради этой фичи было бы лишней миграцией. `tabId`/
 *  `backendNodeId`/`sourceUrl` — координаты для повторного захвата
 *  DesignDocument при отправке в Figma, тот же смысл, что у QueueItem в
 *  main/inspector.ts (см. prepareQueueDocuments) — при закрытой исходной
 *  вкладке отправка деградирует так же, как inspector:queue-locate. */
export interface ReferenceItem {
  id: string
  siteKey: string
  /** null — референс без проекта (по запросу пользователя), см.
   *  main/standaloneReferenceSites.ts. */
  projectId: string | null
  siteUrl: string
  element: ElementSummary
  thumbnail?: string
  name: string
  description?: string
  createdAt: string
  /** undefined — ещё не отправлен в Figma. */
  sentToFigmaAt?: string
  tabId: string
  backendNodeId: number
  sourceUrl: string
}

/** Активная сессия сбора референс-элементов (см. main/index.ts
 *  reference:session-start/-end) — банер в OverlayRoot.tsx и условная
 *  вкладка BottomPanel читают это состояние, чтобы знать, что сейчас
 *  собирается и для какого сайта. `null` — сессии нет. */
export interface ReferenceSessionState {
  projectId: string | null
  siteUrl: string
  siteTitle: string
}

/** Референс-сайт без проекта (по запросу пользователя — "начать с сайта и
 *  только потом оформить его как референс") — тот же набор полей, что
 *  ProjectSite минус `kind` (тут всегда референс), см.
 *  main/standaloneReferenceSites.ts. */
export interface StandaloneReferenceSite {
  url: string
  title: string
  faviconUrl: string | null
  thumbnail?: string
  addedAt: string
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

/** Кандидат, найденный read-only распознаванием повторяющихся DOM-структур.
 * Сам по себе ничего не создаёт в Figma; selector используется только после
 * явного клика «Создать компонент» во вкладке «Компоненты». */
export interface ScannedComponent {
  id: string
  selector: string
  name: string
  tag: string
  classes: string[]
  instances: number
  width: number
  height: number
  confidence: number
  thumbnail?: string
  /** Координаты в документе на момент атомарного DOM-скана. В фоне позволяют
   *  снять динамический React-элемент, даже если он перемонтировался между
   *  последовательными captureScreenshot. */
  pageBox?: { x: number; y: number; width: number; height: number }
}

export interface ComponentScanResult {
  components: ScannedComponent[]
  truncated: boolean
}

export interface ComponentPreviewResult {
  ok: boolean
  thumbnail?: string
  error?: string
}

export interface ComponentPreviewReadyEvent {
  tabId: string
  pageUrl: string
  selector: string
  thumbnail: string
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
  /** Закреплён пользователем (см. main/recentSites.ts togglePin) — держит
   *  запись вверху "Без проекта" в сайдбаре и защищает от вытеснения по CAP. */
  pinned?: boolean
}

/** Один сайт внутри проекта (см. main/projects.ts) — 'site' обычная рабочая
 *  страница, 'reference' — референс, отдельная секция в сайдбаре/галерее
 *  Референсов, по запросу пользователя. thumbnail заполняется только для
 *  kind:'reference' (см. captureTabThumbnail в main/index.ts) — обычные
 *  сайты показывают favicon-плейсхолдер, скриншот не снимается на каждый визит. */
export interface ProjectSite {
  url: string
  title: string
  faviconUrl: string | null
  addedAt: string
  kind: 'site' | 'reference'
  thumbnail?: string
}

/** Проект в левом сайдбаре — объединяет сайты, как чаты в Claude Desktop
 *  (по запросу пользователя), см. main/projects.ts ProjectsStore. `icon` —
 *  имя иконки из курируемого набора lucide-react (см. CreateProjectModal.tsx
 *  PROJECT_ICONS), не произвольная строка — рендерится через маппинг
 *  имя→компонент, а не динамическим импортом. */
export interface Project {
  id: string
  name: string
  description?: string
  icon?: string
  /** Своя картинка вместо курируемой иконки (по запросу пользователя, см.
   *  CreateProjectModal.tsx) — взаимоисключающе с `icon` на уровне UI (выбор
   *  одного очищает другое), оба поля технически независимы в типе. */
  thumbnail?: string
  createdAt: string
  sites: ProjectSite[]
}

export interface CreateProjectInput {
  name: string
  description?: string
  icon?: string
}

export interface ProjectsSnapshot {
  projects: Project[]
}

export interface Api {
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<void>
  syncPluginTheme: (theme: ThemeSyncMessage['payload']) => Promise<void>
  /** Обратное направление — тема пришла в Bridge Tools от третьей стороны
   *  (Design Toolkit) и была переслана сюда, см. "полный синхрон" в
   *  PROJECT_MEMORY.md. Применяется как оверлей поверх собственной темы, не
   *  меняя settings.json themeId/themeMode. */
  onExternalThemeSync: (cb: (theme: ThemeSyncMessage['payload']) => void) => () => void
  getAppVersion: () => Promise<string>
  getBridgeInfo: () => Promise<BridgeInfo>
  onBridgeStatus: (cb: (status: BridgeStatusEvent) => void) => () => void

  /** Автодополнение строки поиска на вкладке "Референсы" (по запросу
   *  пользователя — "гугловское автодополнение"), см. main/index.ts
   *  search:suggest. Пустой массив — запрос пуст/сеть недоступна/таймаут. */
  searchSuggest: (query: string) => Promise<string[]>

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

  /** Generic popover overlay ('popover' слой, см. main/overlay.ts) — открывает
   *  попап заданного `kind` у указанного якоря (getBoundingClientRect() кнопки
   *  в вызывающем renderer'е), реально НАД встроенным браузером, без прятанья
   *  его через browserSetHidden. Первая реализация — 'add-to-project'. */
  overlayOpenPopover: (params: PopoverOpenParams) => Promise<void>
  overlayClosePopover: () => Promise<void>
  /** Popover-рендерер сам измеряет свой контент и шлёт сюда размер — тот же
   *  паттерн, что overlayReportSize у тулбара пикера, см. репозишининг в
   *  main/index.ts repositionPopoverOverlay. */
  overlayPopoverReportSize: (size: OverlaySize) => Promise<void>
  /** Попап закрылся НЕ по действию открывшей его кнопки (клик снаружи/в
   *  страницу браузера/Esc в самом попапе) — вызывающий компонент должен
   *  синхронизировать свой локальный "открыт ли" state. */
  onPopoverClosed: (cb: () => void) => () => void
  /** Слушает ТОЛЬКО popover-overlay-рендерер (PopoverOverlayRoot.tsx) — какой
   *  kind сейчас показывать и с какими props (см. main/index.ts
   *  overlay:popover-open). */
  onPopoverShow: (cb: (payload: { kind: string; props: unknown }) => void) => () => void
  /** Действие внутри попапа, которое должно обработать ГЛАВНОЕ окно, а не сам
   *  попап (напр. "Новый проект" открывает CreateProjectModal — тот большой
   *  центрированный модал, не поместился бы в маленький popover-слой) —
   *  зовётся ИЗ popover-overlay-рендерера, main просто ретранслирует главному
   *  окну через onPopoverAction. */
  popoverAction: (action: { type: string; payload?: unknown }) => Promise<void>
  onPopoverAction: (cb: (action: { type: string; payload?: unknown }) => void) => () => void

  /** Float-режим distraction-free (см. AppSettings.fullscreenMode) — плавающая
   *  панель ('panel-left'/'panel-right' слои, см. main/index.ts createHoverGate)
   *  открыта, пока хотя бы один из ДВУХ независимых источников наведения
   *  (тонкая полоска в главном окне и сама панель в overlay-слое, см.
   *  PanelOverlayRoot.tsx) её держит — каждый шлёт сюда entering true/false
   *  на свой mouseenter/mouseleave. */
  overlayPanelHover: (params: { side: 'left' | 'right' | 'top' | 'references-left' | 'references-right'; entering: boolean }) => Promise<void>

  browserNewTab: (url?: string) => Promise<void>
  browserCloseTab: (id: string) => Promise<void>
  browserSwitchTab: (id: string) => Promise<void>
  browserGetTabs: () => Promise<TabsSnapshot>
  onTabsState: (cb: (snapshot: TabsSnapshot) => void) => () => void

  /** Второй, независимый встроенный браузер (по запросу пользователя — сбор
   *  референс-элементов встраивается ПРЯМО на страницу референс-сайта, без
   *  перехода на вкладку "Браузер") — тот же набор методов, что browserX
   *  выше, один в один по форме, просто указывает на отдельный
   *  BrowserController (см. main/index.ts referenceBrowserController). */
  referenceBrowserNavigate: (input: string) => Promise<void>
  referenceBrowserBack: () => Promise<void>
  referenceBrowserForward: () => Promise<void>
  referenceBrowserReload: () => Promise<void>
  referenceBrowserStop: () => Promise<void>
  referenceBrowserSetBounds: (bounds: ViewBounds) => Promise<void>
  referenceBrowserSetHidden: (hidden: boolean) => Promise<void>
  referenceBrowserNewTab: (url?: string) => Promise<void>
  referenceBrowserCloseTab: (id: string) => Promise<void>
  referenceBrowserSwitchTab: (id: string) => Promise<void>
  referenceBrowserGetTabs: () => Promise<TabsSnapshot>
  onReferenceBrowserTabs: (cb: (snapshot: TabsSnapshot) => void) => () => void

  /** Глобальный статус долгих операций подготовки/импорта в Figma. */
  onImportProgress: (cb: (event: ImportProgressEvent) => void) => () => void
  /** Кнопка "Отменить" на плашке прогресса — см. main/index.ts withCancel. */
  importCancel: (id: string) => Promise<void>

  inspectorStartPick: () => Promise<void>
  inspectorStopPick: () => Promise<void>
  onInspectorPickState: (cb: (state: PickState) => void) => () => void
  onInspectorSelection: (cb: (result: SelectionResult) => void) => () => void
  /** Текущий/последний выбор — для гидратации панели, если она была закрыта
   *  в момент клика пикером (см. main/inspector.ts getLastSelection). */
  inspectorGetLastSelection: () => Promise<SelectionResult | null>
  /** Esc с уже выбранным элементом — снимает постоянную подсветку на странице
   *  и весь связанный state (см. main/inspector.ts clearSelection). */
  inspectorClearSelection: () => Promise<void>
  onInspectorSelectionCleared: (cb: () => void) => () => void
  /** Клик по узлу в Element tree — переключает текущее выделение на этот DOM-
   *  элемент по его `sourceSelector` (см. main/inspector.ts
   *  selectBySourceSelector). Возвращает false, если селектор не находит
   *  узел (страница успела перезагрузиться/измениться). */
  inspectorSelectTreeNode: (sourceSelector: string) => Promise<boolean>
  inspectorImportAsFrame: (
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource
  ) => Promise<ImportResult>
  /** "Импортировать страницу целиком" — без предварительного клика пикером,
   *  сам находит `<body>` активной вкладки (см. main/inspector.ts
   *  selectFullPage). Отдельный инструмент на тулбаре, по запросу пользователя. */
  inspectorImportFullPage: (
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
  /** Клик по карточке в левой панели "для проверки" — переключает на нужную
   *  вкладку (если пик был сделан не на текущей) и подсвечивает исходный
   *  элемент на странице (см. main/inspector.ts highlightBackendNode). */
  inspectorQueueLocate: (id: string) => Promise<ImportResult>
  inspectorImportQueue: (
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource
  ) => Promise<QueueImportResult>

  recentSitesGet: () => Promise<RecentSite[]>
  recentSitesRemove: (url: string) => Promise<void>
  recentSitesTogglePin: (url: string) => Promise<void>
  onRecentSitesUpdated: (cb: (list: RecentSite[]) => void) => () => void

  projectsGet: () => Promise<ProjectsSnapshot>
  onProjectsUpdated: (cb: (snapshot: ProjectsSnapshot) => void) => () => void
  projectsCreate: (input: CreateProjectInput) => Promise<Project>
  projectsRename: (id: string, name: string) => Promise<void>
  /** Редактирование проекта (по запросу пользователя — попап "..." на карточке,
   *  тот же CreateProjectModal.tsx в mode:'edit') — иконка и своя картинка
   *  взаимоисключающие, `undefined` у обоих полей = не менять, `null` = очистить. */
  projectsUpdate: (id: string, patch: { name?: string; description?: string; icon?: string | null; thumbnail?: string | null }) => Promise<void>
  /** Диалог выбора файла картинки для проекта (см. main/index.ts
   *  projects:pick-thumbnail, resizeToThumbnail) — null, если пользователь
   *  отменил диалог. */
  projectsPickThumbnail: () => Promise<string | null>
  projectsDelete: (id: string) => Promise<void>
  projectsReorder: (orderedIds: string[]) => Promise<void>
  projectsAddSite: (
    projectId: string,
    site: { url: string; title: string; faviconUrl: string | null },
    kind: 'site' | 'reference'
  ) => Promise<void>
  projectsRemoveSite: (projectId: string, url: string) => Promise<void>
  projectsMoveSiteKind: (projectId: string, url: string, toKind: 'site' | 'reference') => Promise<void>
  projectsMoveSiteToProject: (fromProjectId: string, toProjectId: string, url: string) => Promise<void>
  projectsReorderSites: (projectId: string, kind: 'site' | 'reference', orderedUrls: string[]) => Promise<void>

  /** "Найти сайт" из строки поиска на стартовом экране (по запросу
   *  пользователя — гугл-запрос НЕ должен становиться standalone-
   *  референсом) — просто показывает встроенный браузер по адресу, без
   *  пикера и без записи в standaloneReferenceSitesStore. См. main/index.ts
   *  reference:browse-start. */
  referenceBrowseStart: (url: string) => Promise<void>
  /** Виден ли ПРЯМО СЕЙЧАС встроенный референс-браузер, а не основной — см.
   *  main/index.ts referenceBrowserVisible докстринг. Нужно
   *  BrowserTopBarOverlayContent.tsx (float-режим 'panel-top' слой), чтобы
   *  знать, каким из двух браузеров управлять. */
  referenceGetBrowserVisible: () => Promise<boolean>
  onReferenceBrowserVisible: (cb: (visible: boolean) => void) => () => void
  /** Плавающая левая панель "Референсов" (см. PanelOverlayRoot.tsx
   *  side:'references-left') живёт в ДРУГОМ рендерере — эти два вызова
   *  просто ретранслируют клик по сайту главному окну, ReferencesView.tsx
   *  подписан на пару ниже и применяет их у себя (selectSite/onOpenSite). */
  referencesOverlaySelectSite: (projectId: string | null, url: string) => Promise<void>
  onReferencesOverlaySelectSite: (cb: (projectId: string | null, url: string) => void) => () => void
  referencesOverlayOpenSite: (url: string) => Promise<void>
  onReferencesOverlayOpenSite: (cb: (url: string) => void) => () => void
  /** Активная вкладка верхнего уровня (см. main/index.ts activeTopView
   *  докстринг) — App.tsx Shell зовёт при каждой смене вкладки, нужно
   *  ТОЛЬКО leftPanelGate в main, чтобы знать, какой overlay-слой открывать
   *  при наведении на левый край в float-режиме ('left' или
   *  'references-left'). */
  appSetActiveView: (view: 'browser' | 'references') => Promise<void>
  /** Сессия сбора референс-элементов конкретного сайта (по запросу
   *  пользователя, см. ReferenceItem/ReferenceSessionState) — переиспользует
   *  тот же браузер и queue-режим пикера, что и обычный Import Queue, просто
   *  подтверждённые элементы уходят в отдельный стор вместо общей очереди.
   *  См. main/index.ts reference:session-start/-end. */
  referenceSessionStart: (projectId: string | null, siteUrl: string) => Promise<void>
  referenceSessionEnd: () => Promise<void>
  onReferenceSessionState: (cb: (state: ReferenceSessionState | null) => void) => () => void
  /** Начальное значение сессии для 'panel-references-right' overlay-
   *  рендерера при монтировании (тот монтируется лениво по первому
   *  наведению — см. main/index.ts showPanelOverlay — сессия сбора к этому
   *  моменту вполне может уже быть активна). Живые изменения дальше идут
   *  через onReferenceSessionState выше (тот же канал слушают оба). */
  referenceGetSessionState: () => Promise<ReferenceSessionState | null>
  referenceItemsGet: (siteKey: string) => Promise<ReferenceItem[]>
  onReferenceItemsUpdated: (cb: (items: ReferenceItem[]) => void) => () => void
  referenceItemsUpdateMeta: (id: string, patch: { name?: string; description?: string }) => Promise<void>
  referenceItemsRemove: (id: string) => Promise<void>
  /** Попап имени (настройка referenceNamePromptOnAdd) вызывает это вместо
   *  автокоммита — коммитит pending queue-item (см.
   *  ElementPicker.confirmQueueAdd) с введёнными name/description. */
  referenceItemsCreateFromPending: (name: string, description?: string) => Promise<void>
  referenceItemsSend: (
    id: string,
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource
  ) => Promise<ImportResult>
  referenceItemsSendAll: (
    siteKey: string,
    useMatchedTextStyles: boolean,
    useMatchedColorStyles: boolean,
    colorMatchSource: ColorMatchSource
  ) => Promise<QueueImportResult>

  /** Референс-сайты без проекта (по запросу пользователя — "старт с сайта,
   *  оформить как референс потом"), см. main/standaloneReferenceSites.ts. */
  standaloneReferencesGet: () => Promise<StandaloneReferenceSite[]>
  onStandaloneReferencesUpdated: (cb: (sites: StandaloneReferenceSite[]) => void) => () => void
  standaloneReferencesRemove: (url: string) => Promise<void>
  /** Переносит сайт (и все его ReferenceItem) из "без проекта" в проект —
   *  тот же приём, что projectsMoveSiteToProject использует для смены
   *  проекта у обычного ProjectSite. */
  standaloneReferencesAttachToProject: (url: string, projectId: string) => Promise<void>

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
  componentsScan: () => Promise<ComponentScanResult>
  /** Снимает превью только по явному клику пользователя. Фоновый скан
   *  намеренно не делает CDP screenshots, чтобы не дёргать compositor сайта. */
  componentsPreview: (component: ScannedComponent) => Promise<ComponentPreviewResult>
  /** Миниатюры приходят по одной из скрытого offscreen renderer, не задерживая
   *  первичный список распознанных компонентов. */
  onComponentPreviewReady: (cb: (event: ComponentPreviewReadyEvent) => void) => () => void
  componentsImport: (component: ScannedComponent) => Promise<ImportResult>

  checkForUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void
  onUpdateReady: (cb: (info: UpdateReadyInfo) => void) => () => void
}
