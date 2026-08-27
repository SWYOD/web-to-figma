import {
  clamp,
  pointAtRoute,
  routeConnector,
  stableLaneOffsets,
  type ConnectorLineShape,
  type ConnectorSide,
  type RouteGeometry
} from './connectorCore'

export type SmartConnectorSide = ConnectorSide
export type SmartConnectorArrow = 'NONE' | 'ARROW_LINES' | 'ARROW_EQUILATERAL' | 'TRIANGLE_FILLED' | 'DIAMOND_FILLED' | 'CIRCLE_FILLED'
export type SmartConnectorLabelAlign = 'START' | 'CENTER' | 'END'
export type SmartConnectorLabelBackground = 'NONE' | 'PAGE' | 'CUSTOM'

/** Живой биндинг цветового поля на переменную/стиль Figma вместо статичного
 *  hex — по запросу пользователя после того, как первая версия пикера
 *  (Batch 2, Package E) только резолвила выбор в hex. `id` — id переменной
 *  или paint-стиля файла. См. CHANGE_REQUESTS.md. */
export interface SmartConnectorColorBinding {
  kind: 'VARIABLE' | 'STYLE'
  id: string
}

export interface SmartConnectorConfig {
  sideA: SmartConnectorSide
  sideB: SmartConnectorSide
  offsetA: number
  offsetB: number
  marginA: number
  marginB: number
  routingPadding: number
  laneGap: number
  lineShape: ConnectorLineShape
  cornerRadius: number
  strokeWeight: number
  strokeStyle: 'SOLID' | 'DASHED'
  dash: number
  gap: number
  arrowA: SmartConnectorArrow
  arrowB: SmartConnectorArrow
  color: string
  opacity: number
  colorBinding: SmartConnectorColorBinding | null
  linked: boolean
  labelText: string
  labelPosition: number
  labelAlign: SmartConnectorLabelAlign
  labelPaddingX: number
  labelPaddingY: number
  labelFontWeight: 'REGULAR' | 'MEDIUM' | 'SEMIBOLD' | 'BOLD'
  labelFontSize: number
  labelTextColor: string
  labelTextOpacity: number
  labelTextColorBinding: SmartConnectorColorBinding | null
  labelBorderColor: string
  labelBorderOpacity: number
  labelBorderColorBinding: SmartConnectorColorBinding | null
  labelBackground: SmartConnectorLabelBackground
  labelBackgroundColor: string
  labelBackgroundOpacity: number
  labelBorderWidth: number
  labelCornerRadius: number
}

interface SmartConnectorDataV2 {
  version: 2
  aId: string
  bId: string
  labelId?: string
  config: SmartConnectorConfig
}

interface SmartConnectorDataV1 {
  version: 1
  aId: string
  bId: string
  config: Partial<SmartConnectorConfig> & { margin?: number }
}

type SmartConnectorData = SmartConnectorDataV2

const NAMESPACE = 'swyod_smart_connectors'
const DATA_KEY = 'smart-connector'
const LABEL_DATA_KEY = 'smart-connector-label'
const CONTAINER_INDEX_KEY = 'smart-connector-containers'
const DEBOUNCE_MS = 250
const GEOMETRY_PROPERTIES = new Set<string>([
  'x', 'y', 'width', 'height', 'rotation', 'relativeTransform',
  'layoutMode', 'layoutPositioning', 'layoutGrow',
  'primaryAxisSizingMode', 'counterAxisSizingMode',
  'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing'
])

let knownOwnedIds = new Set<string>()
let watchedEndpointIds = new Set<string>()
let labelByConnectorId = new Map<string, string>()
/** Frames a connector/label has been reparented into (see `commonContainerFrame`
 *  below — connectors are page-level by default so they never become
 *  auto-layout/grid children, but a page-level sibling never appears in
 *  Figma's Prototype presentation, which only renders a frame's own
 *  subtree). Persisted on the page's own plugin data so `refreshOwnedIndex`/
 *  `connectorNodes` can shallow-scan exactly these frames' direct children
 *  in addition to the page — bounded by actual usage, NOT a recursive
 *  document scan (that previously made Figma unusably slow, see
 *  PROJECT_MEMORY.md — must never come back). */
let containerFrameIds = new Set<string>()

function loadContainerIndex(): void {
  try {
    const raw = figma.currentPage.getPluginData(CONTAINER_INDEX_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    containerFrameIds = new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    containerFrameIds = new Set()
  }
}

function persistContainerIndex(): void {
  figma.currentPage.setPluginData(CONTAINER_INDEX_KEY, JSON.stringify([...containerFrameIds]))
}

function registerContainer(frameId: string): void {
  if (containerFrameIds.has(frameId)) return
  containerFrameIds.add(frameId)
  persistContainerIndex()
}

/** Absolute→local translation offset for an UNROTATED/unskewed/unscaled
 *  frame only — returns null otherwise, and callers must then leave the
 *  connector page-level instead. Correctly placing axis-aligned routing
 *  geometry inside a rotated parent would require counter-rotating every
 *  vertex, not just translating the anchor point; not attempted here, it's
 *  a materially harder problem than the common (unrotated frame) case this
 *  fix targets. */
export function frameOffset(frame: FrameNode): { x: number; y: number } | null {
  const [[a, c, tx], [b, d, ty]] = frame.absoluteTransform
  const EPS = 0.001
  if (Math.abs(a - 1) > EPS || Math.abs(d - 1) > EPS || Math.abs(b) > EPS || Math.abs(c) > EPS) return null
  return { x: tx, y: ty }
}

/** Nearest common FRAME ancestor of two endpoint nodes, if one exists and
 *  is unrotated — used to reparent a new connector (and its label) into it
 *  so it shows up in Figma's Prototype presentation. Endpoints living in
 *  different top-level frames (or directly on the page) have no common
 *  frame; the connector then stays page-level exactly as before this fix. */
export function commonContainerFrame(a: SceneNode, b: SceneNode): FrameNode | null {
  const ancestors = (node: SceneNode): BaseNode[] => {
    const chain: BaseNode[] = []
    let current: BaseNode | null = node.parent
    while (current && current.type !== 'PAGE') {
      chain.push(current)
      current = current.parent
    }
    return chain
  }
  const bAncestors = new Set(ancestors(b))
  for (const node of ancestors(a)) {
    if (node.type === 'FRAME' && bAncestors.has(node) && frameOffset(node)) return node
  }
  return null
}
/** Last geometry actually written per connector — lets connector-to-connector
 *  chains re-route through the watcher (see installSmartConnectorWatcher)
 *  without a feedback loop: a connector's own re-render touches x/y/width/
 *  height, which are exactly the properties a *downstream* connector watches
 *  on it. Skipping the Figma write when the recomputed geometry is unchanged
 *  means no nodechange event fires for that redundant recompute, so a stable
 *  chain settles instead of cycling forever. */
const lastGeometryFingerprint = new Map<string, string>()

export const smartConnectorDefaults: SmartConnectorConfig = {
  sideA: 'AUTO', sideB: 'AUTO', offsetA: 0.5, offsetB: 0.5,
  marginA: 16, marginB: 16, routingPadding: 48, laneGap: 24,
  lineShape: 'ORTHOGONAL', cornerRadius: 8, strokeWeight: 2,
  strokeStyle: 'SOLID', dash: 8, gap: 6,
  arrowA: 'NONE', arrowB: 'ARROW_LINES', color: '#1F2937', opacity: 1, colorBinding: null,
  linked: true, labelText: '', labelPosition: 0.5, labelAlign: 'CENTER',
  labelPaddingX: 8, labelPaddingY: 6, labelFontWeight: 'MEDIUM', labelFontSize: 14,
  labelTextColor: '#111111', labelTextOpacity: 1, labelTextColorBinding: null,
  labelBorderColor: '#111111', labelBorderOpacity: 1, labelBorderColorBinding: null,
  labelBackground: 'PAGE', labelBackgroundColor: '#FFFFFF', labelBackgroundOpacity: 1,
  labelBorderWidth: 0, labelCornerRadius: 8
}

const colorPattern = /^#[0-9a-f]{6}$/i
const validSide = (value: unknown): value is SmartConnectorSide => ['AUTO', 'LEFT', 'RIGHT', 'TOP', 'BOTTOM'].includes(String(value))
const validShape = (value: unknown): value is ConnectorLineShape => ['ORTHOGONAL', 'CURVED', 'STRAIGHT'].includes(String(value))
const validArrow = (value: unknown): value is SmartConnectorArrow => ['NONE', 'ARROW_LINES', 'ARROW_EQUILATERAL', 'TRIANGLE_FILLED', 'DIAMOND_FILLED', 'CIRCLE_FILLED'].includes(String(value))

function isSceneNode(node: BaseNode | null | undefined): node is SceneNode {
  return !!node && node.type !== 'DOCUMENT' && node.type !== 'PAGE'
}

function isSmartConnector(node: BaseNode | null | undefined): node is VectorNode {
  return !!node && node.type === 'VECTOR' && node.getSharedPluginData(NAMESPACE, DATA_KEY) !== ''
}

function isSmartConnectorLabel(node: BaseNode | null | undefined): node is FrameNode {
  return !!node && node.type === 'FRAME' && node.getSharedPluginData(NAMESPACE, LABEL_DATA_KEY) !== ''
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && colorPattern.test(value) ? value.toUpperCase() : fallback
}

function normalizeBinding(value: unknown): SmartConnectorColorBinding | null {
  if (!value || typeof value !== 'object') return null
  const kind = (value as Record<string, unknown>).kind
  const id = (value as Record<string, unknown>).id
  if ((kind === 'VARIABLE' || kind === 'STYLE') && typeof id === 'string' && id) return { kind, id }
  return null
}

export function configFrom(input: Partial<SmartConnectorConfig> = {}): SmartConnectorConfig {
  const value: SmartConnectorConfig = { ...smartConnectorDefaults, ...input }
  value.sideA = validSide(value.sideA) ? value.sideA : smartConnectorDefaults.sideA
  value.sideB = validSide(value.sideB) ? value.sideB : smartConnectorDefaults.sideB
  value.offsetA = clamp(Number(value.offsetA), 0, 1)
  value.offsetB = clamp(Number(value.offsetB), 0, 1)
  value.marginA = clamp(Number(value.marginA), 0, 500)
  value.marginB = clamp(Number(value.marginB), 0, 500)
  value.routingPadding = clamp(Number(value.routingPadding), 0, 500)
  value.laneGap = clamp(Number(value.laneGap), 0, 200)
  value.lineShape = validShape(value.lineShape) ? value.lineShape : smartConnectorDefaults.lineShape
  value.cornerRadius = clamp(Number(value.cornerRadius), 0, 100)
  value.strokeWeight = clamp(Number(value.strokeWeight), 0.25, 32)
  value.strokeStyle = value.strokeStyle === 'DASHED' ? 'DASHED' : 'SOLID'
  value.dash = clamp(Number(value.dash), 1, 100)
  value.gap = clamp(Number(value.gap), 1, 100)
  value.arrowA = validArrow(value.arrowA) ? value.arrowA : smartConnectorDefaults.arrowA
  value.arrowB = validArrow(value.arrowB) ? value.arrowB : smartConnectorDefaults.arrowB
  value.color = color(value.color, smartConnectorDefaults.color)
  value.opacity = clamp(Number(value.opacity), 0, 1)
  value.colorBinding = normalizeBinding(value.colorBinding)
  value.linked = value.linked !== false
  value.labelText = String(value.labelText ?? '').slice(0, 500)
  value.labelPosition = clamp(Number(value.labelPosition), 0, 1)
  value.labelAlign = ['START', 'CENTER', 'END'].includes(value.labelAlign) ? value.labelAlign : 'CENTER'
  value.labelPaddingX = clamp(Number(value.labelPaddingX), 0, 100)
  value.labelPaddingY = clamp(Number(value.labelPaddingY), 0, 100)
  value.labelFontWeight = ['REGULAR', 'MEDIUM', 'SEMIBOLD', 'BOLD'].includes(value.labelFontWeight) ? value.labelFontWeight : 'MEDIUM'
  value.labelFontSize = clamp(Number(value.labelFontSize), 6, 200)
  value.labelTextColor = color(value.labelTextColor, smartConnectorDefaults.labelTextColor)
  value.labelTextOpacity = clamp(Number(value.labelTextOpacity), 0, 1)
  value.labelTextColorBinding = normalizeBinding(value.labelTextColorBinding)
  value.labelBorderColor = color(value.labelBorderColor, smartConnectorDefaults.labelBorderColor)
  value.labelBorderOpacity = clamp(Number(value.labelBorderOpacity), 0, 1)
  value.labelBorderColorBinding = normalizeBinding(value.labelBorderColorBinding)
  value.labelBackground = ['NONE', 'PAGE', 'CUSTOM'].includes(value.labelBackground) ? value.labelBackground : 'PAGE'
  value.labelBackgroundColor = color(value.labelBackgroundColor, smartConnectorDefaults.labelBackgroundColor)
  value.labelBackgroundOpacity = clamp(Number(value.labelBackgroundOpacity), 0, 1)
  value.labelBorderWidth = clamp(Number(value.labelBorderWidth), 0, 32)
  value.labelCornerRadius = clamp(Number(value.labelCornerRadius), 0, 100)
  return value
}

function parseData(node: VectorNode): SmartConnectorData | null {
  try {
    const raw = JSON.parse(node.getSharedPluginData(NAMESPACE, DATA_KEY)) as SmartConnectorDataV1 | SmartConnectorDataV2
    if (raw.version === 2) return { ...raw, config: configFrom(raw.config) }
    if (raw.version === 1) {
      const legacyMargin = Number(raw.config.margin ?? 16)
      return {
        version: 2,
        aId: raw.aId,
        bId: raw.bId,
        config: configFrom({ ...raw.config, marginA: legacyMargin, marginB: legacyMargin })
      }
    }
    return null
  } catch {
    return null
  }
}

function writeData(node: VectorNode, data: SmartConnectorData): void {
  node.setSharedPluginData(NAMESPACE, DATA_KEY, JSON.stringify(data))
}

function rgb(hex: string): RGB {
  return { r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 }
}

/** Плоский SolidPaint по hex, либо тот же paint с привязкой к переменной
 *  файла (`figma.variables.setBoundVariableForPaint` — тот же примитив, что
 *  уже использует `bind_fill_variable`/`bind_stroke_variable` в
 *  designAgentCommands.ts). `hex`/`opacity` в конфиге остаются как fallback-
 *  превью и на случай, если переменную потом удалят из файла. */
async function resolvePaint(hex: string, opacity: number, binding: SmartConnectorColorBinding | null | undefined): Promise<SolidPaint> {
  if (binding?.kind === 'VARIABLE') {
    const variable = await figma.variables.getVariableByIdAsync(binding.id)
    if (variable) {
      const bound = figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: rgb(hex) }, 'color', variable) as SolidPaint
      return { ...bound, opacity }
    }
  }
  return { type: 'SOLID', color: rgb(hex), opacity }
}

/** Применяет цвет STROKE-а узла: paint-стиль файла — через `strokeStyleId`
 *  (сам управляет своим Paint[], ручной .strokes после него нельзя ставить —
 *  отвяжет стиль), переменная/обычный hex — обычным присваиванием .strokes
 *  (которое само снимает любой ранее привязанный стиль). Откат на плоский
 *  paint, если стиль/переменную впоследствии удалили из файла. */
async function applyStrokeColor(
  node: MinimalStrokesMixin,
  hex: string,
  opacity: number,
  binding: SmartConnectorColorBinding | null | undefined
): Promise<void> {
  if (binding?.kind === 'STYLE') {
    try {
      await node.setStrokeStyleIdAsync(binding.id)
      return
    } catch {
      // Style was deleted from the file — fall through to a plain paint.
    }
  }
  node.strokes = [await resolvePaint(hex, opacity, binding)]
}

/** То же самое для FILL-а (текст лейбла). */
async function applyFillColor(
  node: MinimalFillsMixin,
  hex: string,
  opacity: number,
  binding: SmartConnectorColorBinding | null | undefined
): Promise<void> {
  if (binding?.kind === 'STYLE') {
    try {
      await node.setFillStyleIdAsync(binding.id)
      return
    } catch {
      // Style was deleted from the file — fall through to a plain paint.
    }
  }
  node.fills = [await resolvePaint(hex, opacity, binding)]
}

/** Page children plus the direct children of every known container frame
 *  (see `containerFrameIds` above) — bounded by actual connector usage, not
 *  a recursive scan of the whole document. */
async function connectorNodes(): Promise<VectorNode[]> {
  const results: VectorNode[] = [...figma.currentPage.children.filter(isSmartConnector)]
  for (const id of containerFrameIds) {
    const frame = await figma.getNodeByIdAsync(id)
    if (frame && frame.type === 'FRAME') results.push(...frame.children.filter(isSmartConnector))
  }
  return results
}

function connectorPairKey(data: SmartConnectorData): string {
  return [data.aId, data.bId].sort().join('|')
}

function refreshOwnedIndex(): Promise<void> {
  knownOwnedIds = new Set<string>()
  watchedEndpointIds = new Set<string>()
  labelByConnectorId = new Map<string, string>()
  const scan = (children: readonly SceneNode[]): void => {
    for (const node of children) {
      if (isSmartConnector(node)) {
        knownOwnedIds.add(node.id)
        const data = parseData(node)
        if (data) {
          watchedEndpointIds.add(data.aId)
          watchedEndpointIds.add(data.bId)
          if (data.labelId) labelByConnectorId.set(node.id, data.labelId)
        }
      } else if (isSmartConnectorLabel(node)) {
        knownOwnedIds.add(node.id)
        try {
          const labelData = JSON.parse(node.getSharedPluginData(NAMESPACE, LABEL_DATA_KEY)) as { connectorId?: string }
          if (labelData.connectorId) labelByConnectorId.set(labelData.connectorId, node.id)
        } catch { /* Ignore malformed owned labels. */ }
      }
    }
  }
  scan(figma.currentPage.children)
  return (async () => {
    const stale: string[] = []
    for (const id of containerFrameIds) {
      const frame = await figma.getNodeByIdAsync(id)
      if (frame && frame.type === 'FRAME') scan(frame.children)
      else stale.push(id)
    }
    if (stale.length) {
      for (const id of stale) containerFrameIds.delete(id)
      persistContainerIndex()
    }
  })()
}

function laneAssignments(nodes: VectorNode[]): Map<string, number> {
  const groups = new Map<string, Array<{ node: VectorNode; data: SmartConnectorData }>>()
  for (const node of nodes) {
    const data = parseData(node)
    if (!data || data.config.sideA !== 'AUTO' || data.config.sideB !== 'AUTO') continue
    const key = connectorPairKey(data)
    const group = groups.get(key) ?? []
    group.push({ node, data })
    groups.set(key, group)
  }
  const result = new Map<string, number>()
  for (const group of groups.values()) {
    group.sort((left, right) => left.node.id.localeCompare(right.node.id, undefined, { numeric: true }))
    const gap = group.reduce((sum, item) => sum + item.data.config.laneGap, 0) / group.length
    const offsets = stableLaneOffsets(group.length, gap)
    group.forEach((item, index) => result.set(item.node.id, offsets[index]!))
  }
  return result
}

function networkFor(route: RouteGeometry, config: SmartConnectorConfig): { vertices: VectorVertex[]; segments: VectorSegment[]; minX: number; minY: number } {
  const bounds = [...route.points]
  if (route.curve) {
    bounds.push(
      { x: route.points[0]!.x + route.curve.tangentStart.x, y: route.points[0]!.y + route.curve.tangentStart.y },
      { x: route.points[1]!.x + route.curve.tangentEnd.x, y: route.points[1]!.y + route.curve.tangentEnd.y }
    )
  }
  const minX = Math.min(...bounds.map((point) => point.x))
  const minY = Math.min(...bounds.map((point) => point.y))
  const local = route.points.map((point) => ({ x: point.x - minX, y: point.y - minY }))
  const vertices: VectorVertex[] = local.map((point, index) => ({
    ...point,
    strokeCap: index === 0 ? config.arrowA : index === local.length - 1 ? config.arrowB : 'NONE',
    strokeJoin: 'ROUND',
    cornerRadius: !route.curve && index > 0 && index < local.length - 1 ? config.cornerRadius : 0
  }))
  const segments: VectorSegment[] = local.slice(1).map((_, index) => ({
    start: index,
    end: index + 1,
    ...(route.curve && index === 0 ? { tangentStart: route.curve.tangentStart, tangentEnd: route.curve.tangentEnd } : {})
  }))
  return { vertices, segments, minX, minY }
}

function pageBackground(): SolidPaint | null {
  const paint = figma.currentPage.backgrounds.find((item): item is SolidPaint => item.type === 'SOLID')
  return paint ?? null
}

const fontStyle: Record<SmartConnectorConfig['labelFontWeight'], string> = {
  REGULAR: 'Regular', MEDIUM: 'Medium', SEMIBOLD: 'Semi Bold', BOLD: 'Bold'
}

async function getOrCreateLabel(connector: VectorNode, data: SmartConnectorData): Promise<FrameNode> {
  const existing = data.labelId ? await figma.getNodeByIdAsync(data.labelId) : null
  if (isSmartConnectorLabel(existing)) {
    // Keep the label co-parented with its connector (see createOne's
    // reparenting into a common container frame) — an existing label
    // created before that container existed, or whose connector's
    // container changed, would otherwise sit in the wrong parent.
    if (connector.parent && existing.parent?.id !== connector.parent.id) connector.parent.appendChild(existing)
    return existing
  }
  const frame = figma.createFrame()
  frame.name = `Smart Connector Label · ${connector.name}`
  frame.layoutMode = 'HORIZONTAL'
  frame.primaryAxisSizingMode = 'AUTO'
  frame.counterAxisSizingMode = 'AUTO'
  frame.setSharedPluginData(NAMESPACE, LABEL_DATA_KEY, JSON.stringify({ version: 1, connectorId: connector.id }))
  if (connector.parent) connector.parent.appendChild(frame)
  data.labelId = frame.id
  knownOwnedIds.add(frame.id)
  labelByConnectorId.set(connector.id, frame.id)
  writeData(connector, data)
  return frame
}

async function removeLabel(data: SmartConnectorData): Promise<void> {
  if (!data.labelId) return
  const node = await figma.getNodeByIdAsync(data.labelId)
  if (isSmartConnectorLabel(node)) {
    knownOwnedIds.delete(node.id)
    node.remove()
  }
  delete data.labelId
}

async function renderLabel(connector: VectorNode, data: SmartConnectorData, route: RouteGeometry): Promise<void> {
  const config = data.config
  if (!config.labelText.trim()) {
    await removeLabel(data)
    writeData(connector, data)
    return
  }
  const frame = await getOrCreateLabel(connector, data)
  // Figma shows a node's own `name` as a hover tooltip on canvas — the
  // technical default ("Smart Connector Label · Smart Connector · A → B")
  // read as an unwanted internal detail exposed to anyone hovering the
  // label. Rename to the label's own visible text instead, kept in sync
  // on every render (not just at creation) so editing the label text also
  // updates what the canvas tooltip shows.
  frame.name = config.labelText.trim().slice(0, 80)
  let text = frame.children.find((node): node is TextNode => node.type === 'TEXT')
  if (!text) {
    text = figma.createText()
    frame.appendChild(text)
  }
  let font: FontName = { family: 'Inter', style: fontStyle[config.labelFontWeight] }
  try { await figma.loadFontAsync(font) } catch {
    font = { family: 'Inter', style: 'Regular' }
    await figma.loadFontAsync(font)
  }
  text.fontName = font
  text.fontSize = config.labelFontSize
  text.characters = config.labelText
  text.textAutoResize = 'WIDTH_AND_HEIGHT'
  await applyFillColor(text, config.labelTextColor, config.labelTextOpacity, config.labelTextColorBinding)
  frame.paddingLeft = frame.paddingRight = config.labelPaddingX
  frame.paddingTop = frame.paddingBottom = config.labelPaddingY
  frame.cornerRadius = config.labelCornerRadius
  if (config.labelBackground === 'NONE') frame.fills = []
  else if (config.labelBackground === 'PAGE') {
    const background = pageBackground()
    frame.fills = background ? [{ ...background, opacity: config.labelBackgroundOpacity }] : [{ type: 'SOLID', color: rgb('#FFFFFF'), opacity: config.labelBackgroundOpacity }]
  } else frame.fills = [{ type: 'SOLID', color: rgb(config.labelBackgroundColor), opacity: config.labelBackgroundOpacity }]
  if (config.labelBorderWidth > 0) await applyStrokeColor(frame, config.labelBorderColor, config.labelBorderOpacity, config.labelBorderColorBinding)
  else frame.strokes = []
  frame.strokeWeight = config.labelBorderWidth
  const anchor = pointAtRoute(route, config.labelPosition)
  const absX = config.labelAlign === 'START' ? anchor.x : config.labelAlign === 'END' ? anchor.x - frame.width : anchor.x - frame.width / 2
  const absY = anchor.y - frame.height / 2
  // `route`/`anchor` are in absolute page coordinates; frame.x/y are
  // relative to whatever parent it's actually in (page, or a common
  // container frame — see createOne/commonContainerFrame).
  const offset = frame.parent && frame.parent.type === 'FRAME' ? (frameOffset(frame.parent) ?? { x: 0, y: 0 }) : { x: 0, y: 0 }
  frame.x = absX - offset.x
  frame.y = absY - offset.y
}

async function render(connector: VectorNode, data: SmartConnectorData, lanePx = 0): Promise<'ok' | 'broken'> {
  const [a, b] = await Promise.all([figma.getNodeByIdAsync(data.aId), figma.getNodeByIdAsync(data.bId)])
  if (!isSceneNode(a) || !isSceneNode(b) || !a.absoluteBoundingBox || !b.absoluteBoundingBox) return 'broken'

  const route = routeConnector(a.absoluteBoundingBox, b.absoluteBoundingBox, data.config, lanePx)
  const network = networkFor(route, data.config)
  const fingerprint = JSON.stringify([network.minX, network.minY, network.vertices, network.segments])
  if (lastGeometryFingerprint.get(connector.id) !== fingerprint) {
    await connector.setVectorNetworkAsync({ vertices: network.vertices, segments: network.segments, regions: [] })
    // network.minX/minY are absolute page coordinates (routeConnector works
    // from absoluteBoundingBox); connector.x/y are relative to its actual
    // parent, which may now be a common container frame, not the page.
    const parentOffset = connector.parent && connector.parent.type === 'FRAME' ? (frameOffset(connector.parent) ?? { x: 0, y: 0 }) : { x: 0, y: 0 }
    connector.x = network.minX - parentOffset.x
    connector.y = network.minY - parentOffset.y
    lastGeometryFingerprint.set(connector.id, fingerprint)
  }
  connector.fills = []
  await applyStrokeColor(connector, data.config.color, data.config.opacity, data.config.colorBinding)
  connector.strokeWeight = data.config.strokeWeight
  connector.strokeJoin = 'ROUND'
  connector.dashPattern = data.config.strokeStyle === 'DASHED' ? [data.config.dash, data.config.gap] : []
  writeData(connector, data)
  await renderLabel(connector, data, route)
  return 'ok'
}

async function connectorForSelection(node: SceneNode | undefined): Promise<VectorNode | null> {
  if (!node) return null
  if (isSmartConnector(node)) return node
  if (!isSmartConnectorLabel(node)) return null
  try {
    const labelData = JSON.parse(node.getSharedPluginData(NAMESPACE, LABEL_DATA_KEY)) as { connectorId?: string }
    const connector = labelData.connectorId ? await figma.getNodeByIdAsync(labelData.connectorId) : null
    return isSmartConnector(connector) ? connector : null
  } catch { return null }
}

async function details(node: VectorNode): Promise<Record<string, unknown> | null> {
  const data = parseData(node)
  if (!data) return null
  const [a, b] = await Promise.all([figma.getNodeByIdAsync(data.aId), figma.getNodeByIdAsync(data.bId)])
  return {
    id: node.id,
    name: node.name,
    aName: a?.name ?? 'Missing layer',
    bName: b?.name ?? 'Missing layer',
    broken: !isSceneNode(a) || !isSceneNode(b),
    baked: node.parent?.type === 'FRAME',
    config: data.config
  }
}

function selectedTargets(): SceneNode[] {
  // Connectors ARE valid targets (connector-to-connector attachment, by user
  // request — see PROJECT_MEMORY.md) — only their own label frames aren't
  // meaningful endpoints. A connector's `absoluteBoundingBox` is a thin rect
  // along its own path, so a normal side+offset port still lands on/near it.
  return figma.currentPage.selection.filter((node) => !isSmartConnectorLabel(node))
}

export async function getSmartConnectorState(): Promise<Record<string, unknown>> {
  const selection = figma.currentPage.selection
  const selectedNode = selection.length === 1 ? await connectorForSelection(selection[0]) : null
  const selectedConnector = selectedNode ? await details(selectedNode) : null

  // Multi-select: several connectors (or their labels) selected together on
  // the Figma canvas. Resolved the same way as the single-select case above,
  // then de-duplicated (a connector and its own label can both be in
  // `selection` and would otherwise resolve to the same node twice).
  let selectedConnectors: Array<Record<string, unknown>> = []
  if (selection.length > 1) {
    const resolved = await Promise.all(selection.map(connectorForSelection))
    const unique = [...new Map(resolved.filter((n): n is VectorNode => n !== null).map((n) => [n.id, n])).values()]
    if (unique.length > 1) selectedConnectors = (await Promise.all(unique.map(details))).filter((d): d is Record<string, unknown> => d !== null)
  }

  const targets = selectedTargets()
  return {
    connected: true,
    targetNames: targets.map((node) => node.name),
    canCreate: targets.length === 2,
    canBulkCreate: targets.length >= 3,
    selectedConnector,
    selectedConnectors,
    connectors: (await Promise.all((await connectorNodes()).map(details))).filter(Boolean)
  }
}

async function endpointsFromParams(params: Record<string, unknown>): Promise<SceneNode[]> {
  const requested = [params.aId, params.bId].filter((id): id is string => typeof id === 'string')
  if (requested.length !== 2) return selectedTargets()
  const result: SceneNode[] = []
  for (const id of requested) {
    const node = await figma.getNodeByIdAsync(id)
    if (isSceneNode(node)) result.push(node)
  }
  return result
}

async function createOne(a: SceneNode, b: SceneNode, configInput: Partial<SmartConnectorConfig>): Promise<VectorNode> {
  const connector = figma.createVector()
  const data: SmartConnectorData = { version: 2, aId: a.id, bId: b.id, config: configFrom(configInput) }
  connector.name = `Smart Connector · ${a.name} → ${b.name}`
  writeData(connector, data)
  try {
    connector.setRelaunchData({ edit: 'Edit smart connector' })
  } catch {
    // Relaunch buttons need a manifest "id" (see apps/figma-plugin/manifest.json).
    // Not essential to connector creation — don't let a manifest regression
    // break drawing connectors again.
  }
  // Deliberately NOT reparented into a container frame here — a first
  // attempt at doing this automatically (both at creation and on every
  // render) visibly broke things live: appendChild-ing into an auto-layout
  // or grid frame hands the connector's position to that layout engine
  // instead of our own routing, since we never checked layoutMode before
  // moving it in. Reparenting is now an explicit, user-triggered action —
  // see bakeSmartConnectors() below ("Bake" in the UI) — which handles
  // auto-layout/grid frames correctly (layoutPositioning = 'ABSOLUTE').
  knownOwnedIds.add(connector.id)
  watchedEndpointIds.add(a.id)
  watchedEndpointIds.add(b.id)
  return connector
}

export async function createSmartConnector(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const endpoints = await endpointsFromParams(params)
  if (endpoints.length !== 2) throw new Error('Select exactly two non-connector layers in Figma.')
  const connector = await createOne(endpoints[0]!, endpoints[1]!, (params.config ?? {}) as Partial<SmartConnectorConfig>)
  await updateAllSmartConnectors(true)
  figma.currentPage.selection = [connector]
  return (await details(connector)) ?? {}
}

function readingOrder(nodes: SceneNode[]): SceneNode[] {
  return [...nodes].sort((left, right) => {
    const a = left.absoluteBoundingBox
    const b = right.absoluteBoundingBox
    if (!a || !b) return left.id.localeCompare(right.id, undefined, { numeric: true })
    const rowTolerance = Math.max(24, Math.min(a.height, b.height) * 0.4)
    if (Math.abs(a.y - b.y) > rowTolerance) return a.y - b.y
    return a.x - b.x
  })
}

function arrangeInGrid(nodes: SceneNode[], gapX: number, gapY: number, padding: number): void {
  const movable = readingOrder(nodes).filter((node) => node.parent === figma.currentPage && node.absoluteBoundingBox)
  if (movable.length < 2) return
  const columns = Math.ceil(Math.sqrt(movable.length))
  const boxes = movable.map((node) => node.absoluteBoundingBox!)
  const startX = Math.min(...boxes.map((box) => box.x)) + padding
  const startY = Math.min(...boxes.map((box) => box.y)) + padding
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(...boxes.filter((_, index) => index % columns === column).map((box) => box.width), 0))
  const rows = Math.ceil(movable.length / columns)
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...boxes.slice(row * columns, (row + 1) * columns).map((box) => box.height), 0))
  const xPositions = columnWidths.map((_, column) => startX + columnWidths.slice(0, column).reduce((sum, width) => sum + width + gapX, 0))
  const yPositions = rowHeights.map((_, row) => startY + rowHeights.slice(0, row).reduce((sum, height) => sum + height + gapY, 0))
  movable.forEach((node, index) => {
    node.x = xPositions[index % columns]!
    node.y = yPositions[Math.floor(index / columns)]!
  })
}

export async function bulkCreateSmartConnectors(params: Record<string, unknown>): Promise<{ created: number; arranged: number }> {
  const targets = selectedTargets()
  if (targets.length < 3) throw new Error('Select at least three non-connector layers in Figma.')
  const arrangeEnabled = params.arrangeEnabled !== false
  const drawEnabled = params.drawEnabled !== false
  const ordered = readingOrder(targets)
  if (arrangeEnabled) arrangeInGrid(ordered, clamp(Number(params.frameGapX ?? 200), 0, 2000), clamp(Number(params.frameGapY ?? 200), 0, 2000), clamp(Number(params.sectionPadding ?? 40), 0, 1000))
  const created: VectorNode[] = []
  if (drawEnabled) {
    for (let index = 0; index < ordered.length - 1; index += 1) {
      created.push(await createOne(ordered[index]!, ordered[index + 1]!, (params.config ?? {}) as Partial<SmartConnectorConfig>))
    }
    await updateAllSmartConnectors(true)
    figma.currentPage.selection = created
  }
  return { created: created.length, arranged: arrangeEnabled ? ordered.length : 0 }
}

export async function updateSmartConnector(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const node = await figma.getNodeByIdAsync(String(params.connectorId ?? ''))
  if (!isSmartConnector(node)) throw new Error('Smart connector not found.')
  const data = parseData(node)
  if (!data) throw new Error('Invalid smart connector data.')
  data.config = configFrom({ ...data.config, ...((params.config ?? {}) as Partial<SmartConnectorConfig>) })
  writeData(node, data)
  await updateAllSmartConnectors(true)
  return (await details(node)) ?? {}
}

/** Массовое редактирование: несколько выделенных на канвасе коннекторов
 *  правятся ОДНИМ patch'ем (не полной заменой config) — так изменение,
 *  скажем, только цвета не стирает у каждого коннектора его собственные
 *  side/offset/routing. См. CHANGE_REQUESTS.md — запрошено пользователем
 *  после того, как обнаружил, что мульти-выделение вообще не поддерживалось
 *  (getSmartConnectorState отдавал selectedConnector только для selection
 *  длиной 1, а сам apply всегда бил по одному connectorId). */
export async function updateManySmartConnectors(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ids = Array.isArray(params.connectorIds)
    ? params.connectorIds.filter((id): id is string => typeof id === 'string')
    : []
  if (!ids.length) throw new Error('connectorIds must be a non-empty array.')
  const patch = (params.patch ?? {}) as Partial<SmartConnectorConfig>
  let updated = 0
  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id)
    if (!isSmartConnector(node)) continue
    const data = parseData(node)
    if (!data) continue
    data.config = configFrom({ ...data.config, ...patch })
    writeData(node, data)
    updated += 1
  }
  await updateAllSmartConnectors(true)
  return { updated }
}

export async function swapSmartConnector(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const node = await figma.getNodeByIdAsync(String(params.connectorId ?? ''))
  if (!isSmartConnector(node)) throw new Error('Smart connector not found.')
  const data = parseData(node)
  if (!data) throw new Error('Invalid smart connector data.')
  ;[data.aId, data.bId] = [data.bId, data.aId]
  ;[data.config.sideA, data.config.sideB] = [data.config.sideB, data.config.sideA]
  ;[data.config.offsetA, data.config.offsetB] = [data.config.offsetB, data.config.offsetA]
  ;[data.config.marginA, data.config.marginB] = [data.config.marginB, data.config.marginA]
  // arrowA/arrowB deliberately NOT swapped: side/offset/margin describe a
  // physical port on whichever node now occupies that slot, so they must
  // travel with the aId/bId swap above. Arrow style is a property of the
  // SLOT itself (by default arrowB carries the arrowhead, i.e. "the target
  // end has the arrow") — swapping it together with aId/bId would keep the
  // arrowhead pinned to the same physical node, cancelling the swap out
  // visually. Leaving it alone is what actually reverses the arrow on canvas.
  const [a, b] = await Promise.all([figma.getNodeByIdAsync(data.aId), figma.getNodeByIdAsync(data.bId)])
  node.name = `Smart Connector · ${a?.name ?? 'Missing'} → ${b?.name ?? 'Missing'}`
  writeData(node, data)
  await updateAllSmartConnectors(true)
  return (await details(node)) ?? {}
}

export async function updateAllSmartConnectors(force = true): Promise<{ updated: number; broken: number }> {
  const nodes = await connectorNodes()
  const lanes = laneAssignments(nodes)
  let updated = 0
  let broken = 0
  for (const node of nodes) {
    const data = parseData(node)
    if (!data) { broken += 1; continue }
    if (!force && !data.config.linked) continue
    if (await render(node, data, lanes.get(node.id) ?? 0) === 'ok') updated += 1
    else broken += 1
  }
  return { updated, broken }
}

/** Explicit, user-triggered "Bake" action ("режим запекания") — moves every
 *  connector (and its label) that has a common frame ancestor for its two
 *  endpoints from the page into that frame, so it shows up in Figma's
 *  Prototype presentation and in frame image/PDF/SVG export (both only
 *  ever render a frame's own subtree — see CHANGE_REQUESTS.md). Deliberately
 *  NOT automatic (see the comment in createOne()) — an auto-layout or grid
 *  container frame would otherwise hijack the connector's position via its
 *  own layout engine the instant it becomes a child. Handles that case
 *  correctly instead: after reparenting, sets `layoutPositioning =
 *  'ABSOLUTE'` on the connector/label when the container's `layoutMode`
 *  isn't `'NONE'`, which is exactly Figma's own "remove from auto layout
 *  flow, use manual position" per-child override — the container's layout
 *  is left completely alone, nothing else in it moves. Connectors whose
 *  endpoints have no common frame ancestor (different top-level frames, or
 *  directly on the page) are left exactly where they are — there's no
 *  frame to bake them into. Idempotent: already-baked connectors are
 *  skipped (checked by parent id) so running it again is always safe. */
export async function bakeSmartConnectors(): Promise<{ baked: number; skipped: number }> {
  const nodes = await connectorNodes()
  let baked = 0
  let skipped = 0
  for (const node of nodes) {
    const data = parseData(node)
    if (!data) { skipped += 1; continue }
    const [a, b] = await Promise.all([figma.getNodeByIdAsync(data.aId), figma.getNodeByIdAsync(data.bId)])
    if (!isSceneNode(a) || !isSceneNode(b)) { skipped += 1; continue }
    const container = commonContainerFrame(a, b)
    if (!container) { skipped += 1; continue }
    try {
      if (node.parent?.id !== container.id) container.appendChild(node)
      if (container.layoutMode !== 'NONE') node.layoutPositioning = 'ABSOLUTE'
      if (data.labelId) {
        const label = await figma.getNodeByIdAsync(data.labelId)
        if (isSmartConnectorLabel(label)) {
          if (label.parent?.id !== container.id) container.appendChild(label)
          if (container.layoutMode !== 'NONE') label.layoutPositioning = 'ABSOLUTE'
        }
      }
      registerContainer(container.id)
      baked += 1
    } catch {
      skipped += 1
    }
  }
  await updateAllSmartConnectors(true)
  return { baked, skipped }
}

/** Reverses bakeSmartConnectors() — moves every currently-baked connector
 *  (and its label) back onto the page. Whatever stale x/y a node is left
 *  with immediately after `appendChild` doesn't matter: the
 *  `updateAllSmartConnectors(true)` call right after re-renders every
 *  connector from scratch, and `render()`'s offset math resolves to
 *  {x:0,y:0} for a page-level parent, so the final position is correct —
 *  nothing actually shows the in-between state. */
export async function unbakeSmartConnectors(): Promise<{ unbaked: number }> {
  const nodes = await connectorNodes()
  let unbaked = 0
  for (const node of nodes) {
    if (!node.parent || node.parent.type !== 'FRAME') continue
    try {
      figma.currentPage.appendChild(node)
      const data = parseData(node)
      if (data?.labelId) {
        const label = await figma.getNodeByIdAsync(data.labelId)
        if (isSmartConnectorLabel(label)) figma.currentPage.appendChild(label)
      }
      unbaked += 1
    } catch {
      // Best-effort.
    }
  }
  await updateAllSmartConnectors(true)
  return { unbaked }
}

export async function selectSmartConnector(params: Record<string, unknown>): Promise<void> {
  const node = await figma.getNodeByIdAsync(String(params.connectorId ?? ''))
  if (!isSmartConnector(node)) throw new Error('Smart connector not found.')
  figma.currentPage.selection = [node]
  figma.viewport.scrollAndZoomIntoView([node])
}

export async function deleteSmartConnector(params: Record<string, unknown>): Promise<void> {
  const node = await figma.getNodeByIdAsync(String(params.connectorId ?? ''))
  if (!isSmartConnector(node)) throw new Error('Smart connector not found.')
  const data = parseData(node)
  if (data) await removeLabel(data)
  knownOwnedIds.delete(node.id)
  labelByConnectorId.delete(node.id)
  lastGeometryFingerprint.delete(node.id)
  node.remove()
  await updateAllSmartConnectors(true)
}

let installed = false
export function installSmartConnectorWatcher(onUpdated?: () => void): void {
  if (installed) return
  installed = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let watchedPage: PageNode | null = null

  const cleanupDeletedConnector = (connectorId: string): void => {
    const labelId = labelByConnectorId.get(connectorId)
    labelByConnectorId.delete(connectorId)
    if (!labelId) return
    void figma.getNodeByIdAsync(labelId).then((node) => {
      if (isSmartConnectorLabel(node)) node.remove()
    })
  }

  const onNodeChange = (event: NodeChangeEvent): void => {
    const relevant = event.nodeChanges.some((change) => {
      const id = change.node.id
      if (knownOwnedIds.has(id) && change.type === 'DELETE') {
        knownOwnedIds.delete(id)
        if (labelByConnectorId.has(id)) cleanupDeletedConnector(id)
      }
      // Deliberately NOT an early return for owned nodes: a connector can
      // itself be another connector's endpoint (connector-to-connector), so
      // its own geometry changes must still count when it's also watched —
      // see lastGeometryFingerprint above for why this can't loop forever.
      if (!watchedEndpointIds.has(id)) return false
      if (change.type === 'DELETE') return true
      return change.type === 'PROPERTY_CHANGE' && change.properties.some((property) => GEOMETRY_PROPERTIES.has(property))
    })
    if (!relevant) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void refreshOwnedIndex().then(() => updateAllSmartConnectors(false)).then(() => onUpdated?.())
    }, DEBOUNCE_MS)
  }

  const watchCurrentPage = (): void => {
    if (watchedPage) watchedPage.off('nodechange', onNodeChange)
    watchedPage = figma.currentPage
    watchedPage.on('nodechange', onNodeChange)
    loadContainerIndex()
    void refreshOwnedIndex()
  }

  watchCurrentPage()
  figma.on('currentpagechange', () => {
    watchCurrentPage()
    void updateAllSmartConnectors(false).then(() => onUpdated?.())
  })
  void updateAllSmartConnectors(false).then(() => onUpdated?.())
}
