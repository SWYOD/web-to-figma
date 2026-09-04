/// <reference types="@figma/plugin-typings" />

/**
 * Реализация команд DesignAgent bridge (см. docs/architecture.md — "Design
 * Agent bridge") — портировано максимально дословно из реального dev-сборки
 * DesignAgent (`C:\Users\ilya\.claude\designagent-figma-dev\dist\code.js`,
 * извлечено из встроенного source map, `src/code.ts`) по прямому запросу
 * пользователя: он хочет ПОЛНЫЙ набор команд, не подмножество, чтобы AI
 * (через DesignAgent MCP-тулы) мог работать с Figma-канвасом ПАРАЛЛЕЛЬНО с
 * ручным импортом через Web To Figma — Figma физически не даёт держать два
 * плагина открытыми одновременно, поэтому канал DesignAgent поднимается
 * ВНУТРИ этого же плагина (см. `ui/designAgentClient.ts` — второе,
 * независимое WebSocket-соединение к тому же локальному брокеру на 3790,
 * параллельно обычному bridge к desktop-приложению Web To Figma).
 *
 * Портированы все 34 команды DesignAgent. Первый заход оставил `get_spec`/
 * `get_design_md`/`export_tokens` неготовыми — они опираются на отдельный
 * конвейер анализа/экстракции (extract.ts/intent.ts/analyze.ts/serialize.ts/
 * designdoc.ts/tokens.ts, ~76KB исходников), портированный тем же способом
 * (дословно из source map) во второй заход и вынесенный в
 * `designAgentSpec.ts`, чтобы не раздувать этот файл — см. импорты ниже.
 *
 * Логика внутри команд — оригинальная (не переизобретена по описанию), где
 * это разумно адаптирована под то, что у этого плагина уже нет собственного
 * состояния DesignAgent (аннотации/кэш анализа и т.п.) — но семантика
 * каждой Figma Plugin API операции сохранена как есть. Кэш анализа
 * (`AnalysisCache`/`selectionSignature` у оригинала) сознательно не
 * портирован — чистая перф-оптимизация для собственной авто-обновляющейся
 * панели DesignAgent, которой у этого плагина нет; здесь `get_spec`/
 * `get_design_md`/`export_tokens` просто всегда считают заново.
 */

import {
  analyzeNodeCoreAsync,
  exportTokens,
  generateDesignDoc,
  loadAnnotationCategories,
  type DesignDocFrame,
  type TokenFormat
} from './designAgentSpec'
import {
  bakeSmartConnectors,
  bulkCreateSmartConnectors,
  createSmartConnector,
  deleteSmartConnector,
  getSmartConnectorState,
  selectSmartConnector,
  swapSmartConnector,
  unbakeSmartConnectors,
  updateAllSmartConnectors,
  updateManySmartConnectors,
  updateSmartConnector
} from './smartConnectors'

const CANVAS_GUTTER = 80

// ---- Console capture (backs the console_logs bridge command) ----
interface LogEntry {
  ts: number
  level: string
  source: 'sandbox'
  text: string
}
const LOG_BUFFER_MAX = 1000
const logBuffer: LogEntry[] = []

function formatLogArg(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function pushLog(level: string, text: string): void {
  logBuffer.push({ ts: Date.now(), level, source: 'sandbox', text })
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift()
}

// Перехватываем console.* в кольцевой буфер — то же самое, что делает
// DesignAgent, чтобы console_logs мог что-то вернуть. Песочница Figma-плагина
// (QuickJS, не полноценный V8) не гарантированно имеет ВСЕ уровни console —
// пропускаем те, которых нет, вместо `.bind` на undefined (живая ошибка:
// "cannot read property 'bind' of undefined", ловил при первом же запуске).
;(['log', 'info', 'warn', 'error', 'debug'] as const).forEach((level) => {
  if (typeof console[level] !== 'function') return
  const original = console[level].bind(console)
  console[level] = (...args: unknown[]) => {
    pushLog(level, args.map(formatLogArg).join(' '))
    original(...args)
  }
})

let annotationCategoryId: string | undefined

function isSceneNode(node: BaseNode | null): node is SceneNode {
  return Boolean(node && node.type !== 'DOCUMENT' && node.type !== 'PAGE' && node.type !== 'SLICE')
}

function resolvePrimaryNode(selection: readonly SceneNode[]): SceneNode | null {
  if (selection.length > 0 && selection[0]) return selection[0]
  // Dev Mode: fall back to focusedNode when nothing is explicitly selected.
  const focused = (figma.currentPage as { focusedNode?: SceneNode | null }).focusedNode
  if (focused && 'visible' in focused) return focused
  return null
}

// В dynamic-page режиме getNodeByIdAsync на id инстанс-сублоя ("I…;…") может
// зависнуть — таймаут, чтобы не ждать общий 20с таймаут брокера молча.
const NODE_LOOKUP_TIMEOUT_MS = 5000
async function getNodeByIdGuarded(id: string): Promise<BaseNode | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const hint = id.startsWith('I')
        ? 'Instance sublayers can stall — export_asset handles them automatically, or use instantiate_component for a fresh top-level instance.'
        : 'The node may be on an unloaded page.'
      reject(new Error(`Node lookup for ${id} timed out after ${NODE_LOOKUP_TIMEOUT_MS / 1000}s. ${hint}`))
    }, NODE_LOOKUP_TIMEOUT_MS)
  })
  try {
    return await Promise.race([figma.getNodeByIdAsync(id), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

// Тяжёлые exportAsync (скриншоты/ассеты) выполняются по одному — параллельный
// burst может подвесить плагин.
let exportQueue: Promise<unknown> = Promise.resolve()
function enqueueExport<T>(job: () => Promise<T>): Promise<T> {
  const run = exportQueue.then(job, job)
  exportQueue = run.catch(() => {})
  return run
}

function hasAnnotationsMixin(node: SceneNode): node is SceneNode & AnnotationsMixin {
  return 'annotations' in node
}

function buildAnnotationText(message: { reason: string; suggestion: string }): string {
  return [`Issue: ${message.reason}`, `Action: ${message.suggestion}`].join('\n')
}

function isLayoutContainerNode(node: SceneNode): node is SceneNode &
  ChildrenMixin & {
    layoutMode: FrameNode['layoutMode']
    primaryAxisAlignItems: FrameNode['primaryAxisAlignItems']
    counterAxisAlignItems: FrameNode['counterAxisAlignItems']
    itemSpacing: number
    paddingTop: number
    paddingRight: number
    paddingBottom: number
    paddingLeft: number
    width: number
    height: number
  } {
  return 'children' in node && 'layoutMode' in node
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1] ?? 0
    const right = sorted[mid] ?? left
    return (left + right) / 2
  }
  return sorted[mid] ?? 0
}

function detectCounterAxisAlignment(
  parent: { width: number; height: number },
  children: readonly SceneNode[],
  axis: 'VERTICAL' | 'HORIZONTAL'
): FrameNode['counterAxisAlignItems'] {
  if (axis === 'VERTICAL') {
    const lefts = children.map((child) => child.x)
    const rights = children.map((child) => child.x + ('width' in child ? child.width : 0))
    const centers = children.map((child) => child.x + ('width' in child ? child.width / 2 : 0))
    const leftSpread = Math.max(...lefts) - Math.min(...lefts)
    const rightSpread = Math.max(...rights) - Math.min(...rights)
    const centerError = Math.max(...centers.map((value) => Math.abs(value - parent.width / 2)))
    if (leftSpread <= 4) return 'MIN'
    if (rightSpread <= 4) return 'MAX'
    if (centerError <= 4) return 'CENTER'
    return 'MIN'
  }
  const tops = children.map((child) => child.y)
  const bottoms = children.map((child) => child.y + ('height' in child ? child.height : 0))
  const centers = children.map((child) => child.y + ('height' in child ? child.height / 2 : 0))
  const topSpread = Math.max(...tops) - Math.min(...tops)
  const bottomSpread = Math.max(...bottoms) - Math.min(...bottoms)
  const centerError = Math.max(...centers.map((value) => Math.abs(value - parent.height / 2)))
  if (topSpread <= 4) return 'MIN'
  if (bottomSpread <= 4) return 'MAX'
  if (centerError <= 4) return 'CENTER'
  return 'MIN'
}

function detectStackAxis(children: readonly SceneNode[]): 'VERTICAL' | 'HORIZONTAL' | null {
  if (children.length < 2) return null
  const centerXs = children.map((child) => child.x + ('width' in child ? child.width / 2 : 0))
  const centerYs = children.map((child) => child.y + ('height' in child ? child.height / 2 : 0))
  const xSpread = Math.max(...centerXs) - Math.min(...centerXs)
  const ySpread = Math.max(...centerYs) - Math.min(...centerYs)
  const verticalLikely = xSpread <= 12 && ySpread > 12
  const horizontalLikely = ySpread <= 12 && xSpread > 12
  if (verticalLikely && !horizontalLikely) return 'VERTICAL'
  if (horizontalLikely && !verticalLikely) return 'HORIZONTAL'
  return null
}

function canSafelyConvertToAutoLayout(node: SceneNode): boolean {
  if (!isLayoutContainerNode(node)) return false
  if (node.children.length < 2) return false
  for (const child of node.children) {
    if (!child.visible) continue
    if ('rotation' in child && Math.abs(child.rotation) > 0.1) return false
    if (!('width' in child) || !('height' in child)) return false
  }
  return true
}

function applyAutoLayoutFix(node: SceneNode): { ok: boolean; message: string } {
  if (!canSafelyConvertToAutoLayout(node)) {
    return { ok: false, message: 'Auto Layout fix skipped: container is ambiguous or has unsupported children.' }
  }
  const container = node as SceneNode &
    ChildrenMixin & {
      layoutMode: FrameNode['layoutMode']
      primaryAxisAlignItems: FrameNode['primaryAxisAlignItems']
      counterAxisAlignItems: FrameNode['counterAxisAlignItems']
      itemSpacing: number
      paddingTop: number
      paddingRight: number
      paddingBottom: number
      paddingLeft: number
      width: number
      height: number
    }
  const visibleChildren = container.children.filter((child) => child.visible)
  const axis = detectStackAxis(visibleChildren)
  if (!axis) {
    return { ok: false, message: 'Auto Layout fix skipped: child alignment is unclear. Use Focus and apply it manually.' }
  }
  const sorted = [...visibleChildren].sort((a, b) => (axis === 'VERTICAL' ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y))
  const gaps: number[] = []
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index]
    const next = sorted[index + 1]
    if (!current || !next) continue
    const currentEnd = axis === 'VERTICAL' ? current.y + current.height : current.x + current.width
    const nextStart = axis === 'VERTICAL' ? next.y : next.x
    const gap = nextStart - currentEnd
    if (gap < -0.5) {
      return { ok: false, message: 'Auto Layout fix skipped: overlapping children detected. Use manual layout cleanup first.' }
    }
    gaps.push(Math.max(0, gap))
  }
  const minX = Math.min(...visibleChildren.map((child) => child.x))
  const minY = Math.min(...visibleChildren.map((child) => child.y))
  const maxRight = Math.max(...visibleChildren.map((child) => child.x + child.width))
  const maxBottom = Math.max(...visibleChildren.map((child) => child.y + child.height))
  container.layoutMode = axis
  container.primaryAxisAlignItems = 'MIN'
  container.counterAxisAlignItems = detectCounterAxisAlignment(container, visibleChildren, axis)
  container.itemSpacing = Math.max(0, Math.round(median(gaps)))
  container.paddingLeft = Math.max(0, Math.round(minX))
  container.paddingTop = Math.max(0, Math.round(minY))
  container.paddingRight = Math.max(0, Math.round(container.width - maxRight))
  container.paddingBottom = Math.max(0, Math.round(container.height - maxBottom))
  return { ok: true, message: 'Auto Layout applied with inferred spacing and padding.' }
}

function applyAbsolutePositioningFix(node: SceneNode): { ok: boolean; message: string } {
  if (!('layoutPositioning' in node)) {
    return { ok: false, message: 'Absolute positioning fix skipped: node does not support layout positioning.' }
  }
  const parent = node.parent
  if (!parent || parent.type === 'PAGE' || parent.type === 'DOCUMENT' || parent.type === 'SLICE') {
    return { ok: false, message: 'Absolute positioning fix skipped: node is not inside an Auto Layout container.' }
  }
  if (!('layoutMode' in parent) || parent.layoutMode === 'NONE') {
    return { ok: false, message: 'Absolute positioning fix skipped: parent is not Auto Layout.' }
  }
  if (node.layoutPositioning !== 'ABSOLUTE') {
    return { ok: true, message: 'Node is already in Auto Layout flow.' }
  }
  node.layoutPositioning = 'AUTO'
  return { ok: true, message: 'Absolute positioning removed. Node now follows Auto Layout flow.' }
}

async function getOrCreateDesignAgentCategoryId(): Promise<string | undefined> {
  if (!figma.annotations) return undefined
  if (annotationCategoryId) return annotationCategoryId
  const categories = await figma.annotations.getAnnotationCategoriesAsync()
  const existing = categories.find((category) => category.label.toLowerCase() === 'designagent')
  if (existing) {
    annotationCategoryId = existing.id
    return annotationCategoryId
  }
  const created = await figma.annotations.addAnnotationCategoryAsync({ label: 'DesignAgent', color: 'orange' })
  annotationCategoryId = created.id
  return annotationCategoryId
}

async function createAnnotationForNode(message: { nodeId: string; reason: string; suggestion: string }): Promise<void> {
  if (!figma.annotations) {
    throw new Error('Annotations are not available in this file/context.')
  }
  const baseNode = await getNodeByIdGuarded(message.nodeId)
  if (!isSceneNode(baseNode)) {
    throw new Error('Could not add annotation: target node not found.')
  }
  if (!hasAnnotationsMixin(baseNode)) {
    throw new Error('Could not add annotation: this node does not support annotations.')
  }
  const categoryId = await getOrCreateDesignAgentCategoryId()
  const nextAnnotation: Annotation = { label: buildAnnotationText(message), ...(categoryId ? { categoryId } : {}) }
  baseNode.annotations = [...baseNode.annotations, nextAnnotation]
  figma.currentPage.selection = [baseNode]
  figma.viewport.scrollAndZoomIntoView([baseNode])
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function parseHexColor(input: unknown): { color: RGB; opacity: number } {
  const raw = String(input ?? '')
    .trim()
    .replace(/^#/, '')
  const hex = /^[0-9a-fA-F]{3}$/.test(raw)
    ? raw
        .split('')
        .map((c) => c + c)
        .join('')
    : raw
  if (!/^[0-9a-fA-F]{6}$/.test(hex) && !/^[0-9a-fA-F]{8}$/.test(hex)) {
    throw new Error(`Invalid color "${String(input)}". Use a hex value like #3366ff.`)
  }
  return {
    color: {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255
    },
    opacity: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
  }
}

function solidPaint(input: unknown): SolidPaint {
  const { color, opacity } = parseHexColor(input)
  return { type: 'SOLID', color, opacity }
}

function applyStroke(node: SceneNode, params: Record<string, unknown>): void {
  if (params.stroke == null || !('strokes' in node)) return
  ;(node as GeometryMixin).strokes = [solidPaint(params.stroke)]
  if (params.strokeWeight != null) {
    ;(node as MinimalStrokesMixin).strokeWeight = toNumber(params.strokeWeight, 1)
  }
  const align = String(params.strokeAlign ?? '')
  if (align === 'INSIDE' || align === 'OUTSIDE' || align === 'CENTER') {
    ;(node as MinimalStrokesMixin).strokeAlign = align
  }
}

function buildDropShadow(params: Record<string, unknown>): DropShadowEffect {
  const { color, opacity } = parseHexColor(params.color ?? '#00000040')
  return {
    type: 'DROP_SHADOW',
    color: { r: color.r, g: color.g, b: color.b, a: params.opacity != null ? toNumber(params.opacity, opacity) : opacity },
    offset: { x: toNumber(params.offsetX, 0), y: toNumber(params.offsetY, 4) },
    radius: toNumber(params.blur, 8),
    spread: toNumber(params.spread, 0),
    visible: true,
    blendMode: 'NORMAL'
  }
}

// Нативный Figma grid layout — gridAutoTracks по умолчанию 'NONE', так что
// прямая установка счётчиков безопасна.
function applyGridLayout(frame: FrameNode, params: Record<string, unknown>): void {
  frame.layoutMode = 'GRID'
  try {
    if (params.columns != null) frame.gridColumnCount = Math.max(1, Math.round(toNumber(params.columns, 1)))
    if (params.rows != null) frame.gridRowCount = Math.max(1, Math.round(toNumber(params.rows, 1)))
  } catch (error) {
    throw new Error(`Could not set grid track counts: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (params.columnGap != null) frame.gridColumnGap = toNumber(params.columnGap, 0)
  if (params.rowGap != null) frame.gridRowGap = toNumber(params.rowGap, 0)
}

async function resolveShader(shaderId: string): Promise<Shader> {
  if (!shaderId) {
    throw new Error('A shaderId is required. Call list_shaders to discover available shaders.')
  }
  const available = await figma.listAvailableShaders()
  const match = available.find((s) => s.id === shaderId)
  if (!match) {
    throw new Error(`Shader ${shaderId} not found. Call list_shaders for valid ids.`)
  }
  if (match.imported) return match
  try {
    return await figma.importShaderById(shaderId)
  } catch (error) {
    throw new Error(`Could not import shader ${shaderId}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function shaderProperties(input: unknown): { [defId: string]: ShaderPropertyValue } | undefined {
  if (!input || typeof input !== 'object') return undefined
  return input as { [defId: string]: ShaderPropertyValue }
}

async function resolveParentContainer(parentId: unknown): Promise<BaseNode & ChildrenMixin> {
  if (parentId) {
    const parent = await getNodeByIdGuarded(String(parentId))
    if (parent && 'appendChild' in parent) return parent as BaseNode & ChildrenMixin
    throw new Error(`Parent node ${String(parentId)} not found or cannot contain children.`)
  }
  return figma.currentPage
}

async function loadFontForNewText(node: TextNode): Promise<void> {
  const fontName = node.fontName
  if (fontName !== figma.mixed) {
    try {
      await figma.loadFontAsync(fontName)
      return
    } catch {
      // fall through to a fallback font below
    }
  }
  const fonts = await figma.listAvailableFontsAsync()
  const fallback = fonts[0]?.fontName ?? { family: 'Inter', style: 'Regular' }
  await figma.loadFontAsync(fallback)
  node.fontName = fallback
}

async function loadFontForExistingText(node: TextNode): Promise<void> {
  const current = node.fontName === figma.mixed && node.characters.length > 0 ? node.getRangeFontName(0, 1) : node.fontName
  const fontName = current === figma.mixed ? { family: 'Inter', style: 'Regular' } : current
  try {
    await figma.loadFontAsync(fontName)
    node.fontName = fontName
  } catch {
    const fonts = await figma.listAvailableFontsAsync()
    const fallback = fonts[0]?.fontName ?? { family: 'Inter', style: 'Regular' }
    await figma.loadFontAsync(fallback)
    node.fontName = fallback
  }
}

const WEIGHT_ALIASES: Record<string, string[]> = {
  '100': ['Thin', 'Hairline'],
  '200': ['ExtraLight', 'Extra Light', 'UltraLight'],
  '300': ['Light'],
  '400': ['Regular', 'Normal', 'Book'],
  '500': ['Medium'],
  '600': ['SemiBold', 'Semi Bold', 'DemiBold', 'Demi Bold'],
  '700': ['Bold'],
  '800': ['ExtraBold', 'Extra Bold', 'UltraBold'],
  '900': ['Black', 'Heavy']
}

async function resolveWeightFontName(node: TextNode, weight: unknown): Promise<FontName> {
  const base = node.fontName === figma.mixed ? (node.characters.length > 0 ? node.getRangeFontName(0, 1) : { family: 'Inter', style: 'Regular' }) : node.fontName
  const family = base === figma.mixed ? 'Inter' : base.family
  const raw = String(weight).trim()
  const candidates = /^\d+$/.test(raw) ? WEIGHT_ALIASES[raw] ?? ['Regular'] : [raw, ...(WEIGHT_ALIASES[raw] ?? [])]
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '')
  const fonts = await figma.listAvailableFontsAsync()
  const familyStyles = fonts.filter((f) => f.fontName.family === family).map((f) => f.fontName.style)
  let match: string | undefined
  for (const candidate of candidates) {
    match = familyStyles.find((style) => norm(style) === norm(candidate))
    if (match) break
  }
  if (!match) {
    throw new Error(`Font "${family}" has no "${raw}" weight. Available: ${familyStyles.join(', ') || 'none'}.`)
  }
  const fontName = { family, style: match }
  await figma.loadFontAsync(fontName)
  return fontName
}

async function applyTextWeight(node: TextNode, weight: unknown): Promise<void> {
  node.fontName = await resolveWeightFontName(node, weight)
}

function normalizeTextAlign(value: unknown): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' | null {
  const v = String(value ?? '').toUpperCase()
  return v === 'LEFT' || v === 'CENTER' || v === 'RIGHT' || v === 'JUSTIFIED' ? v : null
}

function normalizeTextVAlign(value: unknown): 'TOP' | 'CENTER' | 'BOTTOM' | null {
  const v = String(value ?? '').toUpperCase()
  return v === 'TOP' || v === 'CENTER' || v === 'BOTTOM' ? v : null
}

function normalizeScaleMode(value: unknown): 'FILL' | 'FIT' | 'CROP' | 'TILE' {
  const v = String(value ?? '').toUpperCase()
  return v === 'FIT' || v === 'CROP' || v === 'TILE' ? v : 'FILL'
}

function imagePaintFromBase64(base64: unknown, scaleMode: unknown): { paint: ImagePaint; image: Image } {
  const data = String(base64 ?? '')
  if (!data) throw new Error('No image data received.')
  const image = figma.createImage(figma.base64Decode(data))
  return { image, paint: { type: 'IMAGE', scaleMode: normalizeScaleMode(scaleMode), imageHash: image.hash } }
}

function selectAndReturn(node: SceneNode): { id: string; name: string; type: string } {
  figma.currentPage.selection = [node]
  figma.viewport.scrollAndZoomIntoView([node])
  return { id: node.id, name: node.name, type: node.type }
}

function nextCanvasPosition(excludeId?: string): { x: number; y: number } {
  let maxRight = -Infinity
  let minTop = Infinity
  for (const child of figma.currentPage.children) {
    if (child.id === excludeId || !('x' in child) || !('width' in child)) continue
    const node = child as SceneNode & LayoutMixin
    maxRight = Math.max(maxRight, node.x + node.width)
    minTop = Math.min(minTop, node.y)
  }
  if (maxRight === -Infinity) return { x: 0, y: 0 }
  return { x: Math.round(maxRight + CANVAS_GUTTER), y: Math.round(minTop) }
}

function placeOnPage(node: SceneNode & LayoutMixin, x: unknown, y: unknown): void {
  if (x == null && y == null) {
    const pos = nextCanvasPosition(node.id)
    node.x = pos.x
    node.y = pos.y
  } else {
    node.x = toNumber(x, 0)
    node.y = toNumber(y, 0)
  }
}

const MAX_DESIGN_MD_FRAMES = 12

const DESIGN_MD_EXPORTABLE_TYPES = new Set(['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP'])

function selectExportableNodes(selection: readonly SceneNode[]): SceneNode[] {
  const matching = selection.filter((node) => DESIGN_MD_EXPORTABLE_TYPES.has(node.type))
  if (matching.length > 0) return matching
  const primary = resolvePrimaryNode(selection)
  return primary ? [primary] : []
}

async function collectDesignMd(): Promise<{ markdown: string; frameCount: number }> {
  const selection = figma.currentPage.selection
  const nodes = selectExportableNodes(selection)
  if (nodes.length === 0) {
    throw new Error('Select at least one frame, section, or component first.')
  }
  const limited = nodes.slice(0, MAX_DESIGN_MD_FRAMES)
  const omittedFrameCount = nodes.length - limited.length
  const categories = await loadAnnotationCategories()

  const frames: DesignDocFrame[] = []
  for (const node of limited) {
    const core = await analyzeNodeCoreAsync(node, { annotationCategories: categories })
    frames.push({ core })
  }

  const markdown = generateDesignDoc(frames, { fileName: figma.root.name || 'Untitled', omittedFrameCount })
  return { markdown, frameCount: limited.length }
}

export async function runDesignAgentCommand(command: string, params: Record<string, unknown>): Promise<unknown> {
  switch (command) {
    case 'status': {
      const selection = figma.currentPage.selection
      const primary = selection[0]
      return {
        connected: true,
        fileName: figma.root.name || 'Untitled',
        page: figma.currentPage.name,
        selectionCount: selection.length,
        primary: primary ? { id: primary.id, name: primary.name, type: primary.type } : null
      }
    }
    case 'smart_connector_state':
      return getSmartConnectorState()
    case 'smart_connector_create':
      return createSmartConnector(params)
    case 'smart_connector_bulk_create':
      return bulkCreateSmartConnectors(params)
    case 'smart_connector_update':
      return updateSmartConnector(params)
    case 'smart_connector_update_many':
      return updateManySmartConnectors(params)
    case 'smart_connector_swap':
      return swapSmartConnector(params)
    case 'smart_connector_update_all':
      return updateAllSmartConnectors()
    case 'smart_connector_bake':
      return bakeSmartConnectors(
        Array.isArray(params.connectorIds) ? params.connectorIds.filter((id): id is string => typeof id === 'string') : undefined
      )
    case 'smart_connector_unbake':
      return unbakeSmartConnectors(
        Array.isArray(params.connectorIds) ? params.connectorIds.filter((id): id is string => typeof id === 'string') : undefined
      )
    case 'smart_connector_select':
      return selectSmartConnector(params)
    case 'smart_connector_delete':
      return deleteSmartConnector(params)
    case 'get_spec': {
      const primary = resolvePrimaryNode(figma.currentPage.selection)
      if (!primary) throw new Error('Nothing selected in Figma. Select a frame, component, or section first.')
      const core = await analyzeNodeCoreAsync(primary)
      return { selectedNode: core.selectedNode, intent: core.intent, uiSpec: core.uiSpec }
    }
    case 'get_design_md':
      return collectDesignMd()
    case 'export_tokens': {
      const allowed: TokenFormat[] = ['css', 'tailwind', 'sass', 'dtcg']
      const requested = String(params.format ?? 'css').toLowerCase()
      const format = (allowed as string[]).includes(requested) ? (requested as TokenFormat) : 'css'
      const primary = resolvePrimaryNode(figma.currentPage.selection)
      if (!primary) throw new Error('Nothing selected in Figma. Select a frame, component, or section first.')
      const core = await analyzeNodeCoreAsync(primary)
      const vars = core.uiSpec.tokenization.resolvedVariables ?? []
      return { format, count: vars.length, content: exportTokens(vars, format) }
    }
    case 'list_page_nodes': {
      const nodes = figma.currentPage.children.map((child) => ({
        id: child.id,
        name: child.name,
        type: child.type,
        x: 'x' in child ? Math.round((child as SceneNode & LayoutMixin).x) : 0,
        y: 'y' in child ? Math.round((child as SceneNode & LayoutMixin).y) : 0,
        width: 'width' in child ? Math.round((child as SceneNode & LayoutMixin).width) : 0,
        height: 'height' in child ? Math.round((child as SceneNode & LayoutMixin).height) : 0
      }))
      return { page: figma.currentPage.name, count: nodes.length, nodes }
    }
    case 'list_children': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!node) throw new Error('list_children: node not found.')
      if (!('children' in node)) throw new Error('list_children requires the id of a node with children.')
      const container = node as SceneNode & ChildrenMixin & Partial<LayoutMixin>
      let mainComponentId: string | null = null
      let mainComponentParentId: string | null = null
      let mainComponentParentName: string | null = null
      if (container.type === 'INSTANCE') {
        const main = await (container as InstanceNode).getMainComponentAsync()
        if (main) {
          mainComponentId = main.id
          const parent = main.parent
          if (parent && parent.type === 'COMPONENT_SET') {
            mainComponentParentId = parent.id
            mainComponentParentName = parent.name
          }
        }
      }
      const children = (container.children as SceneNode[]).map((child) => ({
        id: child.id,
        name: child.name,
        type: child.type,
        visible: child.visible,
        x: 'x' in child ? (child as SceneNode & LayoutMixin).x : undefined,
        y: 'y' in child ? (child as SceneNode & LayoutMixin).y : undefined,
        width: 'width' in child ? (child as SceneNode & LayoutMixin).width : undefined,
        height: 'height' in child ? (child as SceneNode & LayoutMixin).height : undefined
      }))
      return {
        id: container.id,
        name: container.name,
        type: container.type,
        x: 'x' in container ? container.x : undefined,
        y: 'y' in container ? container.y : undefined,
        width: 'width' in container ? container.width : undefined,
        height: 'height' in container ? container.height : undefined,
        mainComponentId,
        mainComponentParentId,
        mainComponentParentName,
        children
      }
    }
    case 'list_variables_and_styles': {
      const toHex = (rgba: RGBA): string => {
        const toByte = (channel: number) =>
          Math.round(Math.max(0, Math.min(1, channel)) * 255)
            .toString(16)
            .padStart(2, '0')
        return `#${toByte(rgba.r)}${toByte(rgba.g)}${toByte(rgba.b)}`
      }

      const collections = await figma.variables.getLocalVariableCollectionsAsync()
      const colorVariables: Array<{
        id: string
        name: string
        collection: string
        hex?: string
        opacity?: number
        valuesByMode: Array<{ modeId: string; modeName: string; hex: string; opacity: number }>
      }> = []
      const floatVariables: Array<{
        id: string
        name: string
        collection: string
        value?: number
        scopes: readonly VariableScope[]
        valuesByMode: Array<{ modeId: string; modeName: string; value: number }>
      }> = []
      for (const collection of collections) {
        const firstModeId = collection.modes[0]?.modeId
        for (const id of collection.variableIds) {
          const variable = await figma.variables.getVariableByIdAsync(id)
          if (!variable) continue
          if (variable.resolvedType === 'FLOAT') {
            const valuesByMode = collection.modes
              .map((mode) => {
                const raw = variable.valuesByMode[mode.modeId]
                return typeof raw === 'number' ? { modeId: mode.modeId, modeName: mode.name, value: raw } : null
              })
              .filter((entry): entry is { modeId: string; modeName: string; value: number } => entry !== null)
            const first = firstModeId ? variable.valuesByMode[firstModeId] : undefined
            floatVariables.push({
              id: variable.id,
              name: variable.name,
              collection: collection.name,
              value: typeof first === 'number' ? first : undefined,
              scopes: variable.scopes,
              valuesByMode
            })
            continue
          }
          if (variable.resolvedType !== 'COLOR') continue
          const valuesByMode = collection.modes
            .map((mode) => {
              const raw = variable.valuesByMode[mode.modeId]
              if (!raw || typeof raw !== 'object' || !('r' in raw)) return null
              const rgba = raw as RGBA
              return { modeId: mode.modeId, modeName: mode.name, hex: toHex(rgba), opacity: rgba.a }
            })
            .filter(
              (entry): entry is { modeId: string; modeName: string; hex: string; opacity: number } => entry !== null
            )
          const first = valuesByMode.find((entry) => entry.modeId === firstModeId) ?? valuesByMode[0]
          colorVariables.push({
            id: variable.id,
            name: variable.name,
            collection: collection.name,
            hex: first?.hex,
            opacity: first?.opacity,
            valuesByMode
          })
        }
      }

      const localPaintStyles = await figma.getLocalPaintStylesAsync()
      const paintStyles = localPaintStyles.map((style) => {
        const paint = style.paints[0]
        if (paint?.type === 'SOLID') {
          return { id: style.id, name: style.name, type: 'SOLID' as const, hex: toHex({ ...paint.color, a: 1 }), opacity: paint.opacity ?? 1 }
        }
        if (paint && (paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL' || paint.type === 'GRADIENT_ANGULAR' || paint.type === 'GRADIENT_DIAMOND')) {
          return { id: style.id, name: style.name, type: 'GRADIENT' as const }
        }
        if (paint?.type === 'IMAGE') return { id: style.id, name: style.name, type: 'IMAGE' as const }
        return { id: style.id, name: style.name, type: 'OTHER' as const }
      })

      const localTextStyles = await figma.getLocalTextStylesAsync()
      const textStyles = localTextStyles.map((style) => ({
        id: style.id,
        name: style.name,
        fontFamily: style.fontName.family,
        fontStyle: style.fontName.style,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight
      }))
      return { colorVariables, floatVariables, paintStyles, textStyles }
    }
    case 'upsert_float_variables': {
      const collectionName = String(params.collectionName ?? '').trim()
      if (!collectionName) throw new Error('collectionName is required.')
      if (!Array.isArray(params.variables) || params.variables.length === 0) {
        throw new Error('variables must be a non-empty array.')
      }

      const collections = await figma.variables.getLocalVariableCollectionsAsync()
      const collection =
        collections.find((item) => item.name === collectionName) ??
        figma.variables.createVariableCollection(collectionName)
      if (collection.modes.length !== 1 || !collection.modes[0]) {
        throw new Error(
          `Collection "${collectionName}" must contain exactly one mode; found ${collection.modes.length}.`
        )
      }

      const modeId = collection.modes[0].modeId
      const existing = new Map<string, Variable>()
      for (const id of collection.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(id)
        if (variable) existing.set(variable.name, variable)
      }

      const createdVariableIds: string[] = []
      const updatedVariableIds: string[] = []
      const requestNames = new Set<string>()
      for (const item of params.variables as Array<Record<string, unknown>>) {
        const name = String(item.name ?? '').trim()
        const value = Number(item.value)
        if (!name || !Number.isFinite(value)) {
          throw new Error('Each variable requires a non-empty name and finite numeric value.')
        }
        if (requestNames.has(name)) throw new Error(`Duplicate variable name in request: ${name}`)
        requestNames.add(name)

        let variable = existing.get(name)
        if (variable && variable.resolvedType !== 'FLOAT') {
          throw new Error(`Existing variable "${name}" is not FLOAT.`)
        }
        if (!variable) {
          variable = figma.variables.createVariable(name, collection, 'FLOAT')
          createdVariableIds.push(variable.id)
        } else {
          updatedVariableIds.push(variable.id)
        }
        variable.scopes = ['WIDTH_HEIGHT']
        variable.description =
          typeof item.description === 'string' ? item.description : 'Text block min-height token.'
        variable.setValueForMode(modeId, value)
      }

      return {
        collectionId: collection.id,
        collectionName: collection.name,
        modeId,
        createdVariableIds,
        updatedVariableIds,
        count: createdVariableIds.length + updatedVariableIds.length
      }
    }
    case 'upsert_color_variables': {
      const collectionName = String(params.collectionName ?? '').trim()
      if (!collectionName) throw new Error('collectionName is required.')
      if (!Array.isArray(params.variables) || params.variables.length === 0) {
        throw new Error('variables must be a non-empty array.')
      }

      const collections = await figma.variables.getLocalVariableCollectionsAsync()
      const collection =
        collections.find((item) => item.name === collectionName) ??
        figma.variables.createVariableCollection(collectionName)
      if (collection.modes.length !== 1 || !collection.modes[0]) {
        throw new Error(
          `Collection "${collectionName}" must contain exactly one mode; found ${collection.modes.length}.`
        )
      }

      const modeId = collection.modes[0].modeId
      const existing = new Map<string, Variable>()
      for (const id of collection.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(id)
        if (variable) existing.set(variable.name, variable)
      }

      const createdVariableIds: string[] = []
      const updatedVariableIds: string[] = []
      const requestNames = new Set<string>()
      for (const item of params.variables as Array<Record<string, unknown>>) {
        const name = String(item.name ?? '').trim()
        if (!name) throw new Error('Each variable requires a non-empty name.')
        if (requestNames.has(name)) throw new Error(`Duplicate variable name in request: ${name}`)
        requestNames.add(name)
        const { color, opacity } = parseHexColor(item.hex)
        const alpha = item.opacity != null ? toNumber(item.opacity, opacity) : opacity

        let variable = existing.get(name)
        if (variable && variable.resolvedType !== 'COLOR') {
          throw new Error(`Existing variable "${name}" is not COLOR.`)
        }
        if (!variable) {
          variable = figma.variables.createVariable(name, collection, 'COLOR')
          createdVariableIds.push(variable.id)
        } else {
          updatedVariableIds.push(variable.id)
        }
        if (typeof item.description === 'string') variable.description = item.description
        variable.setValueForMode(modeId, { ...color, a: alpha })
      }

      return {
        collectionId: collection.id,
        collectionName: collection.name,
        modeId,
        createdVariableIds,
        updatedVariableIds,
        count: createdVariableIds.length + updatedVariableIds.length
      }
    }
    case 'focus': {
      const nodeId = String(params.nodeId ?? '')
      const node = await getNodeByIdGuarded(nodeId)
      if (!isSceneNode(node)) throw new Error(`Node not found: ${nodeId}`)
      figma.currentPage.selection = [node]
      figma.viewport.scrollAndZoomIntoView([node])
      return { focused: { id: node.id, name: node.name } }
    }
    case 'select': {
      const ids = Array.isArray(params.nodeIds) ? params.nodeIds.map(String) : params.nodeId ? [String(params.nodeId)] : []
      const nodes: SceneNode[] = []
      for (const id of ids) {
        const node = await getNodeByIdGuarded(id)
        if (isSceneNode(node)) nodes.push(node)
      }
      if (nodes.length === 0) throw new Error('No valid nodes to select.')
      figma.currentPage.selection = nodes
      figma.viewport.scrollAndZoomIntoView(nodes)
      return { selected: nodes.map((node) => ({ id: node.id, name: node.name })) }
    }
    case 'annotate': {
      const nodeId = String(params.nodeId ?? '')
      const label = String(params.label ?? params.reason ?? '')
      if (!nodeId || !label) throw new Error('annotate requires "nodeId" and "label".')
      const node = await getNodeByIdGuarded(nodeId)
      if (!isSceneNode(node)) throw new Error(`Node not found: ${nodeId}`)
      await createAnnotationForNode({ nodeId, reason: label, suggestion: String(params.suggestion ?? '') })
      return { annotated: { id: node.id, name: node.name }, label }
    }
    case 'apply_fix': {
      const nodeId = String(params.nodeId ?? '')
      const fix = String(params.fix ?? '')
      const node = await getNodeByIdGuarded(nodeId)
      if (!isSceneNode(node)) throw new Error(`Node not found: ${nodeId}`)
      let result: { ok: boolean; message: string }
      if (fix === 'auto-layout') {
        result = applyAutoLayoutFix(node)
      } else if (fix === 'absolute-positioning') {
        result = applyAbsolutePositioningFix(node)
      } else {
        throw new Error(`Unknown fix "${fix}". Use "auto-layout" or "absolute-positioning".`)
      }
      if (result.ok) {
        figma.currentPage.selection = [node]
        figma.viewport.scrollAndZoomIntoView([node])
      }
      return { ok: result.ok, message: result.message }
    }
    case 'create_frame': {
      const parent = await resolveParentContainer(params.parentId)
      const frame = figma.createFrame()
      if (params.name) frame.name = String(params.name)
      frame.resize(toNumber(params.width, 100), toNumber(params.height, 100))
      const layoutMode = String(params.layoutMode ?? '')
      if (layoutMode === 'HORIZONTAL' || layoutMode === 'VERTICAL') {
        frame.layoutMode = layoutMode
        if (params.itemSpacing != null) frame.itemSpacing = toNumber(params.itemSpacing, 0)
        if (params.padding != null) {
          const pad = toNumber(params.padding, 0)
          frame.paddingTop = pad
          frame.paddingRight = pad
          frame.paddingBottom = pad
          frame.paddingLeft = pad
        }
      } else if (layoutMode === 'GRID') {
        applyGridLayout(frame, params)
      }
      if (params.fill != null) frame.fills = [solidPaint(params.fill)]
      if (params.cornerRadius != null) frame.cornerRadius = toNumber(params.cornerRadius, 0)
      applyStroke(frame, params)
      parent.appendChild(frame)
      if (parent.type === 'PAGE') placeOnPage(frame, params.x, params.y)
      return selectAndReturn(frame)
    }
    case 'create_section': {
      const parent = await resolveParentContainer(params.parentId)
      const section = figma.createSection()
      if (params.name) section.name = String(params.name)
      section.resizeWithoutConstraints(
        Math.max(1, toNumber(params.width, 1000)),
        Math.max(1, toNumber(params.height, 600))
      )
      if (params.fill != null) section.fills = [solidPaint(params.fill)]
      parent.appendChild(section)
      if (parent.type === 'PAGE' && params.x == null && params.y == null) {
        const pos = nextCanvasPosition(section.id)
        section.x = pos.x
        section.y = pos.y
      } else {
        if (params.x != null) section.x = toNumber(params.x, section.x)
        if (params.y != null) section.y = toNumber(params.y, section.y)
      }
      return selectAndReturn(section)
    }
    case 'create_rectangle':
    case 'create_ellipse': {
      const parent = await resolveParentContainer(params.parentId)
      const node = command === 'create_ellipse' ? figma.createEllipse() : figma.createRectangle()
      if (params.name) node.name = String(params.name)
      node.resize(toNumber(params.width, 100), toNumber(params.height, 100))
      if (params.fill != null) node.fills = [solidPaint(params.fill)]
      if (command === 'create_rectangle' && params.cornerRadius != null) {
        ;(node as RectangleNode).cornerRadius = toNumber(params.cornerRadius, 0)
      }
      applyStroke(node, params)
      parent.appendChild(node)
      if (parent.type === 'PAGE') placeOnPage(node, params.x, params.y)
      return selectAndReturn(node)
    }
    case 'create_text': {
      const parent = await resolveParentContainer(params.parentId)
      const text = figma.createText()
      parent.appendChild(text)
      await loadFontForNewText(text)
      text.characters = String(params.characters ?? '')
      if (params.weight != null) {
        try {
          await applyTextWeight(text, params.weight)
        } catch {
          // keep the default font if the requested weight isn't available
        }
      }
      if (params.fontSize != null) text.fontSize = toNumber(params.fontSize, 16)
      if (params.color != null) text.fills = [solidPaint(params.color)]
      const createAlign = normalizeTextAlign(params.align)
      if (createAlign) text.textAlignHorizontal = createAlign
      if (params.name) text.name = String(params.name)
      if (parent.type === 'PAGE') placeOnPage(text, params.x, params.y)
      return selectAndReturn(text)
    }
    case 'set_text': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!node || node.type !== 'TEXT') throw new Error('set_text requires the id of a text node.')
      await loadFontForExistingText(node)
      node.characters = String(params.characters ?? '')
      return { id: node.id, name: node.name }
    }
    case 'set_fill': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('fills' in node)) throw new Error('set_fill requires a node that supports fills.')
      ;(node as GeometryMixin).fills = [solidPaint(params.color)]
      return { id: node.id, name: node.name }
    }
    case 'set_corner_radius': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('cornerRadius' in node)) {
        throw new Error('set_corner_radius requires a node with corners (frame, rectangle, component).')
      }
      const corner = node as SceneNode & {
        cornerRadius: number | symbol
        topLeftRadius?: number
        topRightRadius?: number
        bottomLeftRadius?: number
        bottomRightRadius?: number
      }
      const perCorner = params.topLeft != null || params.topRight != null || params.bottomLeft != null || params.bottomRight != null
      if (perCorner) {
        if (!('topLeftRadius' in corner)) throw new Error('This node does not support per-corner radius.')
        if (params.topLeft != null) corner.topLeftRadius = toNumber(params.topLeft, 0)
        if (params.topRight != null) corner.topRightRadius = toNumber(params.topRight, 0)
        if (params.bottomLeft != null) corner.bottomLeftRadius = toNumber(params.bottomLeft, 0)
        if (params.bottomRight != null) corner.bottomRightRadius = toNumber(params.bottomRight, 0)
      } else {
        corner.cornerRadius = toNumber(params.radius, 0)
      }
      return { id: node.id, name: node.name }
    }
    case 'set_stroke': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('strokes' in node)) throw new Error('set_stroke requires a node that supports strokes.')
      applyStroke(node, { stroke: params.color, strokeWeight: params.weight, strokeAlign: params.align })
      return { id: node.id, name: node.name }
    }
    case 'bind_fill_variable': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('fills' in node)) throw new Error('bind_fill_variable requires a node that supports fills.')
      const variableId = String(params.variableId ?? '')
      const variable = await figma.variables.getVariableByIdAsync(variableId)
      if (!variable) throw new Error(`bind_fill_variable: variable ${variableId} not found.`)
      const geo = node as GeometryMixin
      const existing = geo.fills
      const basePaint: SolidPaint =
        Array.isArray(existing) && existing[0] && existing[0].type === 'SOLID' ? (existing[0] as SolidPaint) : { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }
      geo.fills = [figma.variables.setBoundVariableForPaint(basePaint, 'color', variable)]
      return { id: node.id, name: node.name }
    }
    case 'bind_stroke_variable': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('strokes' in node)) throw new Error('bind_stroke_variable requires a node that supports strokes.')
      const variableId = String(params.variableId ?? '')
      const variable = await figma.variables.getVariableByIdAsync(variableId)
      if (!variable) throw new Error(`bind_stroke_variable: variable ${variableId} not found.`)
      const geo = node as GeometryMixin
      const existing = geo.strokes
      const basePaint: SolidPaint =
        Array.isArray(existing) && existing[0] && existing[0].type === 'SOLID' ? (existing[0] as SolidPaint) : { type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }
      geo.strokes = [figma.variables.setBoundVariableForPaint(basePaint, 'color', variable)]
      return { id: node.id, name: node.name }
    }
    case 'create_paint_style': {
      const name = String(params.name ?? '').trim()
      if (!name) throw new Error('create_paint_style requires a name.')
      const base = solidPaint(params.hex ?? params.color)
      const paint: SolidPaint = params.opacity != null ? { ...base, opacity: toNumber(params.opacity, 1) } : base
      const style = figma.createPaintStyle()
      style.name = name
      style.paints = [paint]
      return { id: style.id, name: style.name }
    }
    case 'set_shadow': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('effects' in node)) throw new Error('set_shadow requires a node that supports effects.')
      ;(node as BlendMixin).effects = [buildDropShadow(params)]
      return { id: node.id, name: node.name }
    }
    case 'set_text_style': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!node || node.type !== 'TEXT') throw new Error('set_text_style requires the id of a text node.')
      if (params.weight != null) {
        await applyTextWeight(node, params.weight)
      } else if (params.fontSize != null) {
        await loadFontForExistingText(node)
      }
      if (params.fontSize != null) node.fontSize = toNumber(params.fontSize, 16)
      if (params.color != null) node.fills = [solidPaint(params.color)]
      const alignH = normalizeTextAlign(params.align)
      if (alignH) node.textAlignHorizontal = alignH
      const alignV = normalizeTextVAlign(params.valign)
      if (alignV) node.textAlignVertical = alignV
      return { id: node.id, name: node.name }
    }
    case 'apply_text_style': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!node || node.type !== 'TEXT') throw new Error('apply_text_style requires the id of a text node.')
      const styleId = String(params.styleId ?? '')
      if (!styleId) throw new Error('apply_text_style requires a styleId (see list_variables_and_styles).')
      await node.setTextStyleIdAsync(styleId)
      return { id: node.id, name: node.name }
    }
    case 'create_text_style': {
      const name = String(params.name ?? '').trim()
      if (!name) throw new Error('create_text_style requires a name.')
      const family = String(params.fontFamily ?? '').trim()
      const styleName = String(params.fontStyle ?? 'Regular').trim()
      if (!family) throw new Error('create_text_style requires a fontFamily.')
      const fontName: FontName = { family, style: styleName }
      await figma.loadFontAsync(fontName)

      const style = figma.createTextStyle()
      style.name = name
      style.fontName = fontName
      if (params.fontSize != null) style.fontSize = toNumber(params.fontSize, style.fontSize)
      if (params.lineHeight != null) {
        style.lineHeight = { unit: 'PIXELS', value: toNumber(params.lineHeight, style.fontSize) }
      }
      if (params.letterSpacing != null) {
        style.letterSpacing = { unit: 'PIXELS', value: toNumber(params.letterSpacing, 0) }
      }
      if (params.fontSizeVariableId) {
        const variable = await figma.variables.getVariableByIdAsync(String(params.fontSizeVariableId))
        if (!variable) throw new Error(`create_text_style: variable ${String(params.fontSizeVariableId)} not found.`)
        style.setBoundVariable('fontSize', variable)
      }
      return { id: style.id, name: style.name }
    }
    case 'set_image': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('fills' in node)) throw new Error('set_image requires a node that supports fills.')
      const { paint } = imagePaintFromBase64(params.imageBase64, params.scaleMode)
      ;(node as GeometryMixin).fills = [paint]
      return { id: node.id, name: node.name }
    }
    case 'set_instance_property': {
      const rawNode = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!rawNode) throw new Error('set_instance_property: node not found.')
      let instance: InstanceNode | null = null
      let cursor: BaseNode | null = rawNode as BaseNode
      while (cursor) {
        if ((cursor as SceneNode).type === 'INSTANCE') {
          instance = cursor as InstanceNode
          break
        }
        cursor = (cursor as SceneNode).parent ?? null
      }
      if (!instance) throw new Error('set_instance_property requires a node that is (or is nested inside) a component INSTANCE.')
      const requested = params.properties
      if (!requested || typeof requested !== 'object' || Array.isArray(requested)) {
        throw new Error('set_instance_property requires a "properties" object of { propertyName: value }.')
      }
      const defs = instance.componentProperties
      const fullKeyByBaseName: Record<string, string> = {}
      for (const fullKey of Object.keys(defs)) {
        const baseName = fullKey.split('#')[0] ?? fullKey
        fullKeyByBaseName[baseName] = fullKey
      }
      const toSet: Record<string, string | boolean> = {}
      const unknownKeys: string[] = []
      for (const [name, value] of Object.entries(requested as Record<string, unknown>)) {
        const fullKey = defs[name] ? name : fullKeyByBaseName[name]
        if (!fullKey) {
          unknownKeys.push(name)
          continue
        }
        toSet[fullKey] = value as string | boolean
      }
      if (unknownKeys.length > 0) {
        const available = Object.keys(defs)
          .map((k) => k.split('#')[0])
          .join(', ')
        throw new Error(`set_instance_property: unknown propert${unknownKeys.length > 1 ? 'ies' : 'y'} ${unknownKeys.join(', ')} on "${instance.name}". Available: ${available || '(none exposed)'}`)
      }
      instance.setProperties(toSet)
      return { id: instance.id, name: instance.name, properties: instance.componentProperties }
    }
    case 'place_image': {
      const parent = await resolveParentContainer(params.parentId)
      const { paint, image } = imagePaintFromBase64(params.imageBase64, params.scaleMode)
      const size = await image.getSizeAsync()
      const rect = figma.createRectangle()
      if (params.name) rect.name = String(params.name)
      const width = params.width != null ? toNumber(params.width, size.width) : size.width
      const height = params.height != null ? toNumber(params.height, size.height) : size.height
      rect.resize(Math.max(1, width), Math.max(1, height))
      rect.fills = [paint]
      parent.appendChild(rect)
      if (parent.type === 'PAGE') placeOnPage(rect, params.x, params.y)
      return { ...selectAndReturn(rect), width, height }
    }
    case 'move': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('x' in node)) throw new Error('move requires a node with a position.')
      const layout = node as SceneNode & LayoutMixin
      if (params.x != null) layout.x = toNumber(params.x, layout.x)
      if (params.y != null) layout.y = toNumber(params.y, layout.y)
      return { ...selectAndReturn(node), x: layout.x, y: layout.y }
    }
    case 'resize': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('resize' in node)) throw new Error('resize is not supported for this node.')
      const layout = node as SceneNode & LayoutMixin
      const width = toNumber(params.width, layout.width)
      const height = toNumber(params.height, layout.height)
      layout.resize(Math.max(1, width), Math.max(1, height))
      return { ...selectAndReturn(node), width: layout.width, height: layout.height }
    }
    case 'reparent': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node)) throw new Error('reparent requires a valid node.')
      const parent = await resolveParentContainer(params.parentId)
      if (params.index != null) {
        parent.insertChild(toNumber(params.index, 0), node)
      } else {
        parent.appendChild(node)
      }
      if ('x' in node) {
        const layout = node as SceneNode & LayoutMixin
        if (params.x != null) layout.x = toNumber(params.x, layout.x)
        if (params.y != null) layout.y = toNumber(params.y, layout.y)
      }
      return { ...selectAndReturn(node), parent: parent.id }
    }
    case 'delete': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node)) throw new Error('delete requires a valid node.')
      const info = { id: node.id, name: node.name }
      node.remove()
      return { deleted: info }
    }
    case 'clone': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('clone' in node)) throw new Error('clone is not supported for this node.')
      const copy = (node as SceneNode & { clone(): SceneNode }).clone()
      if (params.parentId != null) {
        const parent = await resolveParentContainer(params.parentId)
        parent.appendChild(copy)
      }
      if ('x' in copy) {
        const layout = copy as SceneNode & LayoutMixin
        if (params.x != null) layout.x = toNumber(params.x, layout.x)
        if (params.y != null) layout.y = toNumber(params.y, layout.y)
      }
      return selectAndReturn(copy)
    }
    case 'group': {
      const ids = Array.isArray(params.nodeIds) ? params.nodeIds.map(String) : []
      const nodes: SceneNode[] = []
      for (const id of ids) {
        const found = await getNodeByIdGuarded(id)
        if (isSceneNode(found)) nodes.push(found)
      }
      if (nodes.length < 1) throw new Error('group requires at least one valid node.')
      const firstNode = nodes[0]
      const parent = (firstNode && firstNode.parent) || figma.currentPage
      const group = figma.group(nodes, parent as BaseNode & ChildrenMixin)
      if (params.name) group.name = String(params.name)
      return selectAndReturn(group)
    }
    case 'ungroup': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node)) throw new Error('ungroup requires a valid node.')
      if (node.type !== 'GROUP') throw new Error('ungroup requires a group node.')
      const children = figma.ungroup(node)
      return { ungrouped: children.map((child) => ({ id: child.id, name: child.name })) }
    }
    case 'set_opacity': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('opacity' in node)) throw new Error('set_opacity is not supported for this node.')
      ;(node as SceneNode & MinimalBlendMixin).opacity = Math.max(0, Math.min(1, toNumber(params.opacity, 1)))
      return { id: node.id, name: node.name }
    }
    case 'rename': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!node || !('name' in node)) throw new Error('rename requires a node with a name.')
      ;(node as BaseNode & { name: string }).name = String(params.name ?? '')
      return { id: (node as SceneNode).id, name: (node as SceneNode).name }
    }
    case 'set_rotation': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('rotation' in node)) throw new Error('set_rotation is not supported for this node.')
      ;(node as SceneNode & LayoutMixin).rotation = toNumber(params.rotation, 0)
      return { id: node.id, name: node.name }
    }
    case 'instantiate_component': {
      let component: ComponentNode | null = null
      if (params.componentKey) {
        component = await figma.importComponentByKeyAsync(String(params.componentKey))
      } else if (params.componentId) {
        const found = await getNodeByIdGuarded(String(params.componentId))
        if (found && found.type === 'COMPONENT') {
          component = found
        } else if (found && found.type === 'COMPONENT_SET') {
          component = found.defaultVariant
        } else {
          throw new Error('componentId must reference a COMPONENT or COMPONENT_SET.')
        }
      } else {
        throw new Error('instantiate_component requires componentId or componentKey.')
      }
      if (!component) throw new Error('Component not found.')
      const instance = component.createInstance()
      const parent = await resolveParentContainer(params.parentId)
      parent.appendChild(instance)
      if (parent.type === 'PAGE') placeOnPage(instance, params.x, params.y)
      return selectAndReturn(instance)
    }
    case 'set_grid': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node) || !('layoutMode' in node)) throw new Error('set_grid requires a frame, component, or instance node.')
      applyGridLayout(node as FrameNode, params)
      return { id: node.id, name: node.name }
    }
    case 'list_shaders': {
      const shaders = await figma.listAvailableShaders()
      return { shaders: shaders.map((s) => ({ id: s.id, name: s.name, type: s.type, imported: s.imported })) }
    }
    case 'set_shader': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node)) throw new Error('set_shader requires a scene node.')
      const shader = await resolveShader(String(params.shaderId ?? ''))
      const properties = shaderProperties(params.properties)
      const target = String(params.target ?? (shader.type === 'effect' ? 'effect' : 'fill'))
      if (target === 'effect') {
        if (!('effects' in node)) throw new Error('This node does not support effects.')
        const effect: ShaderEffect = { type: 'SHADER', visible: true, id: shader.id, properties }
        ;(node as BlendMixin).effects = [effect]
      } else if (target === 'stroke') {
        if (!('strokes' in node)) throw new Error('This node does not support strokes.')
        const paint: ShaderPaint = { type: 'SHADER', id: shader.id, properties }
        ;(node as GeometryMixin).strokes = [paint]
      } else {
        if (!('fills' in node)) throw new Error('This node does not support fills.')
        const paint: ShaderPaint = { type: 'SHADER', id: shader.id, properties }
        ;(node as GeometryMixin).fills = [paint]
      }
      return { id: node.id, name: node.name, shaderId: shader.id, target }
    }
    case 'list_animation_styles': {
      const styles = figma.motion.figmaAnimationStyles()
      return { styles: styles.map((s) => ({ styleId: s.styleId, name: s.name, description: s.description ?? null })) }
    }
    case 'apply_animation': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node)) throw new Error('apply_animation requires a scene node.')
      const styleId = String(params.styleId ?? '')
      if (!styleId) throw new Error('apply_animation requires a styleId. Call list_animation_styles.')
      const config: { duration?: number; timelineOffset?: number; props?: Record<string, unknown> } = {}
      if (params.duration != null) config.duration = toNumber(params.duration, 0.3)
      if (params.timelineOffset != null) config.timelineOffset = toNumber(params.timelineOffset, 0)
      if (params.props && typeof params.props === 'object') config.props = params.props as Record<string, unknown>
      const appliedId = node.applyAnimationStyle(styleId, config as AnimationStyleConfiguration)
      return { id: node.id, name: node.name, appliedId }
    }
    case 'remove_animation': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node)) throw new Error('remove_animation requires a scene node.')
      const appliedId = String(params.appliedId ?? '')
      if (!appliedId) throw new Error('remove_animation requires the appliedId returned by apply_animation.')
      node.removeAnimationStyle(appliedId)
      return { id: node.id, name: node.name, removed: appliedId }
    }
    case 'get_animations': {
      const node = await getNodeByIdGuarded(String(params.nodeId ?? ''))
      if (!isSceneNode(node)) throw new Error('get_animations requires a scene node.')
      return {
        animations: node.animationStyles.map((a) => ({ id: a.id, styleId: a.styleId, name: a.name, duration: a.duration ?? null, props: a.props ?? null }))
      }
    }
    case 'batch': {
      const ops = Array.isArray(params.operations) ? params.operations : []
      const results: Array<{ ok: boolean; command: string; result?: unknown; error?: string }> = []
      for (const entry of ops) {
        const op = (entry ?? {}) as { command?: unknown; params?: unknown }
        const subCommand = String(op.command ?? '')
        const subParams = op.params && typeof op.params === 'object' ? (op.params as Record<string, unknown>) : {}
        if (subCommand === 'batch') {
          results.push({ ok: false, command: subCommand, error: 'Nested batch is not allowed.' })
          continue
        }
        try {
          results.push({ ok: true, command: subCommand, result: await runDesignAgentCommand(subCommand, subParams) })
        } catch (error) {
          results.push({ ok: false, command: subCommand, error: error instanceof Error ? error.message : String(error) })
        }
      }
      return { count: results.length, results }
    }
    case 'take_screenshot':
      return enqueueExport(() => takeScreenshot(params))
    case 'export_asset':
      return enqueueExport(() => exportAssets(params))
    case 'console_logs':
      return readConsoleLogs(params)
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

// ---- Export/screenshot support (take_screenshot, export_asset) ----

const ASSET_VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE'])

interface ExportedAsset {
  nodeId: string
  name: string
  format: 'svg' | 'png'
  base64: string
  width: number
  height: number
}

async function exportAssets(params: Record<string, unknown>): Promise<{ assets: ExportedAsset[]; errors: Array<{ nodeId: string; error: string }> }> {
  const nodeIds = Array.isArray(params.nodeIds) ? params.nodeIds.filter((v): v is string => typeof v === 'string') : []
  if (nodeIds.length === 0) throw new Error('Pass nodeIds: the Figma node ids to export.')
  const requestedFormat = params.format === 'svg' || params.format === 'png' ? params.format : 'auto'
  const scale = Math.max(0.5, Math.min(4, toNumber(params.scale, 2)))
  const HARD_MAX = 4 * 1024 * 1024

  const assets: ExportedAsset[] = []
  const errors: Array<{ nodeId: string; error: string }> = []
  for (const nodeId of nodeIds) {
    let temp: SceneNode | null = null
    try {
      let node: BaseNode | null = await getNodeByIdGuarded(nodeId).catch(() => null)
      if ((!node || !('exportAsync' in node)) && nodeId.startsWith('I')) {
        temp = await materializeSublayer(nodeId)
        node = temp
      }
      if (!node) throw new Error(`No node with id ${nodeId}.`)
      if (!('exportAsync' in node)) throw new Error(`Node ${nodeId} (${node.type}) is not exportable.`)
      const scene = node as SceneNode
      const format: 'svg' | 'png' = requestedFormat === 'auto' ? (ASSET_VECTOR_TYPES.has(scene.type) ? 'svg' : 'png') : requestedFormat
      let bytes = format === 'svg' ? await scene.exportAsync({ format: 'SVG' }) : await scene.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } })
      if (format === 'png' && bytes.byteLength > HARD_MAX && scale > 1) {
        bytes = await scene.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } })
      }
      if (bytes.byteLength > HARD_MAX) {
        throw new Error(`Export is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; over the 4 MB per-asset cap. Lower the scale.`)
      }
      const pixelScale = format === 'png' ? scale : 1
      assets.push({
        nodeId,
        name: scene.name,
        format,
        base64: figma.base64Encode(bytes),
        width: 'width' in scene ? Math.round(scene.width * pixelScale) : 0,
        height: 'height' in scene ? Math.round(scene.height * pixelScale) : 0
      })
    } catch (error) {
      errors.push({ nodeId, error: error instanceof Error ? error.message : String(error) })
    } finally {
      try {
        temp?.remove()
      } catch {
        // temp may already be gone; never let cleanup mask the export result
      }
    }
  }
  return { assets, errors }
}

async function materializeSublayer(nodeId: string): Promise<SceneNode> {
  const segments = nodeId.slice(1).split(';')
  const rootId = segments[0] ?? ''
  const suffix = segments.slice(1).join(';')
  const root = rootId ? await getNodeByIdGuarded(rootId).catch(() => null) : null
  if (!root || root.type !== 'INSTANCE') {
    throw new Error(`Could not resolve instance sublayer ${nodeId}. Use instantiate_component with the component key, then export_asset on that instance.`)
  }
  const copy = root.clone()
  figma.currentPage.appendChild(copy)
  if (!suffix) return copy
  try {
    const inner = await getNodeByIdGuarded(`I${copy.id};${suffix}`).catch(() => null)
    if (inner && isSceneNode(inner) && 'exportAsync' in inner) {
      const detached = inner.clone()
      figma.currentPage.appendChild(detached)
      copy.remove()
      return detached
    }
  } catch {
    // sublayer isolation failed — fall through to whole-instance export
  }
  return copy
}

async function takeScreenshot(params: Record<string, unknown>): Promise<{ base64: string; mimeType: string; name: string; nodeId: string; width: number; height: number }> {
  const nodeId = typeof params.nodeId === 'string' ? params.nodeId : ''
  let target: BaseNode | null = null
  if (nodeId) {
    target = await getNodeByIdGuarded(nodeId)
    if (!target) throw new Error(`No node with id ${nodeId}.`)
  } else if (figma.currentPage.selection.length > 0) {
    target = figma.currentPage.selection[0] ?? null
  } else {
    target = figma.currentPage
  }
  if (!target || !('exportAsync' in target)) throw new Error('Nothing to screenshot. Select a node or pass a nodeId.')
  const exportable = target as BaseNode & { exportAsync: SceneNode['exportAsync'] }

  const requested = toNumber(params.scale, 2)
  let scale = Math.max(0.5, Math.min(4, requested))
  const HARD_MAX = 4 * 1024 * 1024

  let bytes = await exportable.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } })
  if (bytes.byteLength > 1.5 * 1024 * 1024 && scale > 1) {
    scale = 1
    bytes = await exportable.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } })
  }
  if (bytes.byteLength > HARD_MAX) {
    throw new Error(`Screenshot is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; too large to send. Capture a smaller node via nodeId.`)
  }
  const width = 'width' in target ? Math.round((target as { width: number }).width * scale) : 0
  const height = 'height' in target ? Math.round((target as { height: number }).height * scale) : 0
  return { base64: figma.base64Encode(bytes), mimeType: 'image/png', name: target.name, nodeId: target.id, width, height }
}

function readConsoleLogs(params: Record<string, unknown>): { entries: LogEntry[]; total: number } {
  const level = typeof params.level === 'string' ? params.level : ''
  const limit = Math.max(1, Math.min(LOG_BUFFER_MAX, toNumber(params.limit, 200)))
  const filtered = level ? logBuffer.filter((e) => e.level === level) : logBuffer.slice()
  const entries = filtered.slice(-limit)
  const total = filtered.length
  if (params.clear === true) logBuffer.length = 0
  return { entries, total }
}
