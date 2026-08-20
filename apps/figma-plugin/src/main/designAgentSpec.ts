/// <reference types="@figma/plugin-typings" />

/**
 * Phase 2 моста DesignAgent (см. designAgentCommands.ts, docs/architecture.md)
 * — `get_spec`/`get_design_md`/`export_tokens`, отложенные при первом заходе:
 * опираются на отдельный конвейер анализа/экстракции DesignAgent
 * (extract.ts/intent.ts/analyze.ts/serialize.ts/tokens.ts/designdoc.ts,
 * ~76KB исходников), тоже портированный максимально дословно из реального
 * dev-build DesignAgent (тот же source map, что и для designAgentCommands.ts).
 *
 * Типы (`UiSpec`/`UiNodeSpec`/`ResolvedVariable`/...) в оригинале лежат в
 * отдельном `types.ts`, который НЕ попал в source map (только type-only
 * импорты, стёрты компилятором до бандла) — восстановлены здесь СТРУКТУРНО
 * по фактическому использованию в портированном коде, не гадание "с нуля":
 * каждое поле видно из того, как его строят/читают ниже.
 *
 * НЕ портировано из analyze.ts: `analyzeNode`/`composeAnalysisPayload`/
 * `Mode`/`AnalysisPayload` — обслуживают собственную авто-анализирующую
 * панель DesignAgent (реакция на selectionchange), которой у этого плагина
 * нет и не будет; нужны только `analyzeNodeCore`/`analyzeNodeCoreAsync`.
 */

// ── Types (реконструированы по использованию, см. докстринг выше) ──────

export type Intent = 'component' | 'screen' | 'section'

export interface TokenHints {
  styleRefs: number
  variableRefs: number
  rawValueHints: number
}

export interface LayoutSummary {
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID'
  primaryAxisAlignItems?: string
  counterAxisAlignItems?: string
  itemSpacing?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  gridRowCount?: number
  gridColumnCount?: number
  gridRowGap?: number
  gridColumnGap?: number
  layoutPositioning?: string
  constraints?: { horizontal: string; vertical: string }
}

export interface ShaderSummary {
  surface: 'fill' | 'stroke' | 'effect'
  shaderId: string
}

export interface VisualSummary {
  fills: 'unknown' | 'mixed' | 'none' | 'solid' | 'gradient' | 'image'
  strokes: 'unknown' | 'mixed' | 'none' | 'solid'
  cornerRadius: number | 'mixed' | 'undefined'
  effects: 'none' | 'mixed' | 'shadow' | 'blur'
  shaders?: ShaderSummary[]
  fillColors?: string[]
  strokeColor?: string
}

export interface AnimationSummary {
  name: string
  styleId: string
  duration?: number
}

export interface TextSummary {
  characters: string
  lineHeight?: string
  letterSpacing?: string
  textCase: string
  fontFamily?: string
  fontStyle?: string
  fontSize?: number
}

export interface AnnotationEntry {
  label: string
  category?: string
  properties?: Record<string, string>
}

export interface InstanceSummary {
  componentProperties?: Record<string, string | number | boolean>
  mainComponentName?: string
  mainComponentKey?: string
}

export interface UiNodeSpec {
  id: string
  name: string
  type: string
  tokenHints: TokenHints
  children: UiNodeSpec[]
  width?: number
  height?: number
  layout?: LayoutSummary
  visual?: VisualSummary
  text?: TextSummary
  instance?: InstanceSummary
  animations?: AnimationSummary[]
  annotations?: AnnotationEntry[]
  devStatus?: 'READY_FOR_DEV' | 'COMPLETED' | 'NONE'
  css?: Record<string, string>
}

export interface UiSpecStats {
  totalNodes: number
  frames: number
  instances: number
  textNodes: number
  autoLayoutFrames: number
  absoluteNodes: number
}

export interface ResolvedVariable {
  id: string
  name: string
  collection: string
  resolvedType: string
  modes: Record<string, string>
}

export interface UiSpec {
  version: string
  root: UiNodeSpec
  stats: UiSpecStats
  tokenization: {
    styleRefs: number
    variableRefs: number
    rawValueCandidates: number
    coverage: number
    resolvedVariables?: ResolvedVariable[]
  }
}

export interface SelectedNodeInfo {
  id: string
  name: string
  type: string
  link?: string
  width?: number
  height?: number
}

export interface AnalysisCore {
  selectedNode: SelectedNodeInfo
  intent: Intent
  uiSpec: UiSpec
}

// ── intent.ts ────────────────────────────────────────────────────────

const SCREEN_NAME_HINT = /(screen|page|login|home|settings|dashboard|profile|checkout|onboarding)/i

function isInComponentSetContext(node: SceneNode): boolean {
  let cursor: BaseNode | null = node
  while (cursor) {
    if (cursor.type === 'COMPONENT' || cursor.type === 'COMPONENT_SET') return true
    cursor = cursor.parent
  }
  return false
}

function isScreenLikeNode(node: SceneNode): boolean {
  if (node.type !== 'FRAME') return false
  const width = typeof node.width === 'number' ? node.width : 0
  const height = typeof node.height === 'number' ? node.height : 0
  const topLevelParent = node.parent?.type === 'PAGE' || node.parent?.type === 'SECTION'
  const commonScreenSize = width >= 320 && height >= 568
  const largeSurface = width * height >= 180000
  const nameHint = SCREEN_NAME_HINT.test(node.name)
  return (topLevelParent && (commonScreenSize || largeSurface)) || nameHint
}

function classifyIntent(node: SceneNode): Intent {
  if (node.type === 'INSTANCE' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' || isInComponentSetContext(node)) {
    return 'component'
  }
  if (isScreenLikeNode(node)) return 'screen'
  return 'section'
}

// ── extract.ts ───────────────────────────────────────────────────────

interface MutableStats extends UiSpecStats {
  styleRefs: number
  variableRefs: number
  rawValueCandidates: number
}

const GHOST_NAME_PATTERN = /\b(ghost|hidden)\b/i

function isMixed<T>(value: T | PluginAPI['mixed']): value is PluginAPI['mixed'] {
  return value === figma.mixed
}

function summarizeFills(fills: ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined): VisualSummary['fills'] {
  if (!fills) return 'unknown'
  if (isMixed(fills)) return 'mixed'
  const visible = fills.filter((paint) => paint.visible !== false)
  if (visible.length === 0) return 'none'
  const paintTypes = new Set(visible.map((paint) => paint.type))
  if (paintTypes.size === 1 && paintTypes.has('SOLID')) return 'solid'
  if ([...paintTypes].every((type) => type.includes('GRADIENT'))) return 'gradient'
  if (paintTypes.has('IMAGE')) return 'image'
  return 'mixed'
}

function summarizeStrokes(strokes: ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined): VisualSummary['strokes'] {
  if (!strokes) return 'unknown'
  if (isMixed(strokes)) return 'mixed'
  const visible = strokes.filter((paint) => paint.visible !== false)
  if (visible.length === 0) return 'none'
  const paintTypes = new Set(visible.map((paint) => paint.type))
  if (paintTypes.size === 1 && paintTypes.has('SOLID')) return 'solid'
  return 'mixed'
}

function solidHex(color: RGB | RGBA): string {
  const toHex = (value: number): string => Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, '0')
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
}

function paintHexes(paints: ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined): string[] {
  if (!paints || isMixed(paints)) return []
  const out: string[] = []
  for (const paint of paints) {
    if (paint.visible === false) continue
    if (paint.type === 'SOLID') {
      if ((paint.opacity ?? 1) === 0) continue
      out.push(solidHex(paint.color))
    } else if (paint.type.startsWith('GRADIENT')) {
      for (const stop of (paint as GradientPaint).gradientStops) {
        if (stop.color.a === 0) continue
        out.push(solidHex(stop.color))
      }
    }
  }
  return out
}

function summarizeEffects(effects: ReadonlyArray<Effect> | PluginAPI['mixed'] | undefined): VisualSummary['effects'] {
  if (!effects) return 'none'
  if (isMixed(effects)) return 'mixed'
  const visible = effects.filter((effect) => effect.visible !== false)
  if (visible.length === 0) return 'none'
  const effectTypes = new Set(visible.map((effect) => effect.type))
  const shadowOnly = [...effectTypes].every((type) => type === 'DROP_SHADOW' || type === 'INNER_SHADOW')
  if (shadowOnly) return 'shadow'
  const blurOnly = [...effectTypes].every((type) => type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR')
  if (blurOnly) return 'blur'
  return 'mixed'
}

function summarizeCornerRadius(node: SceneNode): VisualSummary['cornerRadius'] {
  if ('cornerRadius' in node) {
    if (typeof node.cornerRadius === 'number') return node.cornerRadius
    if (isMixed(node.cornerRadius)) return 'mixed'
  }
  if ('topLeftRadius' in node && 'topRightRadius' in node && 'bottomLeftRadius' in node && 'bottomRightRadius' in node) {
    const values = [node.topLeftRadius, node.topRightRadius, node.bottomLeftRadius, node.bottomRightRadius]
    const [first = 0] = values
    const allEqual = values.every((value) => value === first)
    return allEqual ? first : 'mixed'
  }
  return 'undefined'
}

function extractLayout(node: SceneNode): LayoutSummary | undefined {
  const layout: LayoutSummary = {}
  let hasAny = false
  if ('layoutMode' in node) {
    layout.layoutMode = node.layoutMode
    layout.primaryAxisAlignItems = node.primaryAxisAlignItems
    layout.counterAxisAlignItems = node.counterAxisAlignItems
    layout.itemSpacing = node.itemSpacing
    layout.paddingTop = node.paddingTop
    layout.paddingRight = node.paddingRight
    layout.paddingBottom = node.paddingBottom
    layout.paddingLeft = node.paddingLeft
    hasAny = true
    if (node.layoutMode === 'GRID' && 'gridRowCount' in node) {
      layout.gridRowCount = node.gridRowCount
      layout.gridColumnCount = node.gridColumnCount
      layout.gridRowGap = node.gridRowGap
      layout.gridColumnGap = node.gridColumnGap
    }
  }
  if ('layoutPositioning' in node) {
    layout.layoutPositioning = node.layoutPositioning
    hasAny = true
  }
  if ('constraints' in node) {
    layout.constraints = { horizontal: node.constraints.horizontal, vertical: node.constraints.vertical }
    hasAny = true
  }
  return hasAny ? layout : undefined
}

function lineHeightToString(lineHeight: TextNode['lineHeight']): string | undefined {
  if (isMixed(lineHeight)) return 'MIXED'
  if (lineHeight.unit === 'AUTO') return 'AUTO'
  const suffix = lineHeight.unit === 'PIXELS' ? 'px' : '%'
  return `${lineHeight.value}${suffix}`
}

function letterSpacingToString(letterSpacing: TextNode['letterSpacing']): string | undefined {
  if (isMixed(letterSpacing)) return 'MIXED'
  const suffix = letterSpacing.unit === 'PIXELS' ? 'px' : '%'
  return `${letterSpacing.value}${suffix}`
}

function extractTextSummary(node: SceneNode): TextSummary | undefined {
  if (node.type !== 'TEXT') return undefined
  const summary: TextSummary = {
    characters: node.characters,
    lineHeight: lineHeightToString(node.lineHeight),
    letterSpacing: letterSpacingToString(node.letterSpacing),
    textCase: isMixed(node.textCase) ? 'MIXED' : node.textCase
  }
  if (!isMixed(node.fontName)) {
    summary.fontFamily = node.fontName.family
    summary.fontStyle = node.fontName.style
  }
  if (typeof node.fontSize === 'number') summary.fontSize = node.fontSize
  return summary
}

function extractInstanceSummary(node: SceneNode): InstanceSummary | undefined {
  if (node.type !== 'INSTANCE') return undefined
  const props: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(node.componentProperties ?? {})) {
    if (value.type === 'INSTANCE_SWAP') continue
    const cleanKey = key.split('#')[0] ?? key
    props[cleanKey] = value.value as string | number | boolean
  }
  return { componentProperties: Object.keys(props).length > 0 ? props : undefined }
}

function countVariableBindings(value: unknown): number {
  if (value == null) return 0
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + countVariableBindings(item), 0)
  if (typeof value !== 'object') return 0
  const maybeBinding = value as { id?: unknown }
  let count = 0
  if (typeof maybeBinding.id === 'string' && maybeBinding.id.length > 0) count += 1
  for (const nested of Object.values(value as Record<string, unknown>)) count += countVariableBindings(nested)
  return count
}

function getNodeStyleRefCount(node: SceneNode): number {
  let refs = 0
  if ('fillStyleId' in node && typeof node.fillStyleId === 'string' && node.fillStyleId.length > 0) refs += 1
  if ('strokeStyleId' in node && typeof node.strokeStyleId === 'string' && node.strokeStyleId.length > 0) refs += 1
  if ('effectStyleId' in node && typeof node.effectStyleId === 'string' && node.effectStyleId.length > 0) refs += 1
  if ('textStyleId' in node && typeof node.textStyleId === 'string' && node.textStyleId.length > 0) refs += 1
  return refs
}

function getNodeVariableRefCount(node: SceneNode): number {
  let refs = 0
  if ('boundVariables' in node) refs += countVariableBindings(node.boundVariables)
  const paintCollections: Array<ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined> = []
  if ('fills' in node) paintCollections.push(node.fills)
  if ('strokes' in node) paintCollections.push(node.strokes)
  for (const collection of paintCollections) {
    if (!collection || isMixed(collection)) continue
    for (const paint of collection) refs += countVariableBindings((paint as Paint & { boundVariables?: unknown }).boundVariables)
  }
  return refs
}

function countRawValueHints(node: SceneNode): number {
  let raw = 0
  const hasFillStyle = 'fillStyleId' in node && typeof node.fillStyleId === 'string'
  if ('fills' in node && !hasFillStyle && !isMixed(node.fills)) {
    for (const paint of node.fills) {
      const paintHasVariable = countVariableBindings((paint as Paint & { boundVariables?: unknown }).boundVariables) > 0
      if (paint.visible !== false && paint.type === 'SOLID' && !paintHasVariable) raw += 1
    }
  }
  const hasStrokeStyle = 'strokeStyleId' in node && typeof node.strokeStyleId === 'string'
  if ('strokes' in node && !hasStrokeStyle && !isMixed(node.strokes)) {
    for (const paint of node.strokes) {
      const paintHasVariable = countVariableBindings((paint as Paint & { boundVariables?: unknown }).boundVariables) > 0
      if (paint.visible !== false && paint.type === 'SOLID' && !paintHasVariable) raw += 1
    }
  }
  if (node.type === 'TEXT' && !(typeof node.textStyleId === 'string' && node.textStyleId.length > 0) && countVariableBindings(node.boundVariables) === 0) {
    raw += 1
  }
  return raw
}

function shouldIgnoreForTokenScoring(node: SceneNode): boolean {
  return !node.visible || GHOST_NAME_PATTERN.test(node.name)
}

function summarizeShaders(node: SceneNode): ShaderSummary[] | undefined {
  const shaders: ShaderSummary[] = []
  const scanPaints = (paints: unknown, surface: 'fill' | 'stroke'): void => {
    if (!Array.isArray(paints)) return
    for (const paint of paints as ReadonlyArray<Paint>) {
      if (paint.type === 'SHADER') shaders.push({ surface, shaderId: paint.id })
    }
  }
  if ('fills' in node && !isMixed(node.fills)) scanPaints(node.fills, 'fill')
  if ('strokes' in node && !isMixed(node.strokes)) scanPaints(node.strokes, 'stroke')
  if ('effects' in node && !isMixed(node.effects)) {
    for (const effect of node.effects) {
      if (effect.type === 'SHADER') shaders.push({ surface: 'effect', shaderId: effect.id })
    }
  }
  return shaders.length > 0 ? shaders : undefined
}

function summarizeAnimations(node: SceneNode): AnimationSummary[] | undefined {
  if (!('animationStyles' in node)) return undefined
  try {
    const applied = node.animationStyles
    if (!applied || applied.length === 0) return undefined
    return applied.map((a) => ({ name: a.name, styleId: a.styleId, duration: a.duration }))
  } catch {
    return undefined
  }
}

function extractVisualSummary(node: SceneNode): VisualSummary | undefined {
  if (!('fills' in node || 'strokes' in node || 'effects' in node || 'cornerRadius' in node)) return undefined
  const summary: VisualSummary = {
    fills: 'fills' in node ? summarizeFills(node.fills) : 'unknown',
    strokes: 'strokes' in node ? summarizeStrokes(node.strokes) : 'unknown',
    cornerRadius: summarizeCornerRadius(node),
    effects: 'effects' in node ? summarizeEffects(node.effects) : 'none'
  }
  const shaders = summarizeShaders(node)
  if (shaders) summary.shaders = shaders
  if ('fills' in node) {
    const hexes = paintHexes(node.fills)
    if (hexes.length > 0) summary.fillColors = hexes
  }
  if ('strokes' in node) {
    const strokeHexes = paintHexes(node.strokes)
    if (strokeHexes.length > 0) summary.strokeColor = strokeHexes[0]
  }
  return summary
}

function updateGlobalStats(node: SceneNode, stats: MutableStats, tokenHints: TokenHints): void {
  stats.totalNodes += 1
  if (node.type === 'FRAME') stats.frames += 1
  if (node.type === 'INSTANCE') stats.instances += 1
  if (node.type === 'TEXT') stats.textNodes += 1
  if ('layoutMode' in node && node.layoutMode !== 'NONE') stats.autoLayoutFrames += 1
  if ('layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE') stats.absoluteNodes += 1
  stats.styleRefs += tokenHints.styleRefs
  stats.variableRefs += tokenHints.variableRefs
  stats.rawValueCandidates += tokenHints.rawValueHints
}

const VECTOR_LEAF_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'LINE'])

function extractNode(node: SceneNode, stats: MutableStats): UiNodeSpec {
  const tokenHints: TokenHints = shouldIgnoreForTokenScoring(node)
    ? { styleRefs: 0, variableRefs: 0, rawValueHints: 0 }
    : { styleRefs: getNodeStyleRefCount(node), variableRefs: getNodeVariableRefCount(node), rawValueHints: countRawValueHints(node) }
  updateGlobalStats(node, stats, tokenHints)
  const spec: UiNodeSpec = { id: node.id, name: node.name, type: node.type, tokenHints, children: [] }
  if ('width' in node) spec.width = node.width
  if ('height' in node) spec.height = node.height
  const layout = extractLayout(node)
  if (layout) spec.layout = layout
  const visual = extractVisualSummary(node)
  if (visual) spec.visual = visual
  const text = extractTextSummary(node)
  if (text) spec.text = text
  const instance = extractInstanceSummary(node)
  if (instance) spec.instance = instance
  const animations = summarizeAnimations(node)
  if (animations) spec.animations = animations
  if ('children' in node && !VECTOR_LEAF_TYPES.has(node.type)) {
    spec.children = node.children.filter((child) => child.visible !== false).map((child) => extractNode(child, stats))
  }
  return spec
}

function collectVariableIds(value: unknown, out: Set<string>): void {
  if (value == null) return
  if (Array.isArray(value)) {
    for (const item of value) collectVariableIds(item, out)
    return
  }
  if (typeof value !== 'object') return
  const maybeBinding = value as { id?: unknown; type?: unknown }
  if (typeof maybeBinding.id === 'string' && maybeBinding.id.length > 0 && maybeBinding.type === 'VARIABLE_ALIAS') {
    out.add(maybeBinding.id)
    return
  }
  if (typeof maybeBinding.id === 'string' && maybeBinding.id.startsWith('VariableID:')) {
    out.add(maybeBinding.id)
    return
  }
  for (const nested of Object.values(value as Record<string, unknown>)) collectVariableIds(nested, out)
}

function collectVariableIdsFromNode(node: SceneNode, out: Set<string>): void {
  if ('boundVariables' in node) collectVariableIds(node.boundVariables, out)
  const paintCollections: Array<ReadonlyArray<Paint> | PluginAPI['mixed'] | undefined> = []
  if ('fills' in node) paintCollections.push(node.fills)
  if ('strokes' in node) paintCollections.push(node.strokes)
  for (const collection of paintCollections) {
    if (!collection || isMixed(collection)) continue
    for (const paint of collection) collectVariableIds((paint as Paint & { boundVariables?: unknown }).boundVariables, out)
  }
}

function rgbToHex(color: RGB | RGBA): string {
  const toHex = (value: number): string => Math.max(0, Math.min(255, Math.round(value * 255))).toString(16).padStart(2, '0')
  const hex = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
  if ('a' in color && color.a !== 1) return `${hex} (alpha ${Number(color.a.toFixed(2))})`
  return hex
}

function formatVariableValue(value: VariableValue, resolvedType: string): string {
  if (value == null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number') return resolvedType === 'FLOAT' ? String(Math.round(value * 1000) / 1000) : String(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'object' && 'r' in value && 'g' in value && 'b' in value) return rgbToHex(value as RGBA)
  if (typeof value === 'object' && 'type' in value && (value as { type: string }).type === 'VARIABLE_ALIAS') {
    return `→ alias(${(value as { id: string }).id})`
  }
  return JSON.stringify(value)
}

function isVariableAlias(value: unknown): value is { type: 'VARIABLE_ALIAS'; id: string } {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'VARIABLE_ALIAS' && typeof (value as { id?: unknown }).id === 'string'
}

function pickAliasedModeId(collection: VariableCollection | null, preferredModeName: string): string | undefined {
  if (!collection) return undefined
  const lower = preferredModeName.toLowerCase()
  const byName = collection.modes.find((mode) => mode.name.toLowerCase() === lower)
  if (byName) return byName.modeId
  return collection.defaultModeId ?? collection.modes[0]?.modeId
}

const MAX_ALIAS_DEPTH = 8

async function resolveVariablesForNode(root: SceneNode, maxNodes = 400): Promise<ResolvedVariable[]> {
  const ids = new Set<string>()
  const queue: SceneNode[] = [root]
  let visited = 0
  while (queue.length > 0 && visited < maxNodes) {
    const node = queue.shift()
    if (!node) continue
    visited += 1
    collectVariableIdsFromNode(node, ids)
    if ('children' in node) {
      for (const child of node.children) queue.push(child)
    }
  }
  if (ids.size === 0) return []

  const variableCache = new Map<string, Variable | null>()
  async function loadVariable(id: string): Promise<Variable | null> {
    if (variableCache.has(id)) return variableCache.get(id) ?? null
    const variable = await figma.variables.getVariableByIdAsync(id).catch(() => null)
    variableCache.set(id, variable)
    return variable
  }

  const collectionsCache = new Map<string, VariableCollection | null>()
  async function getCollection(id: string): Promise<VariableCollection | null> {
    if (collectionsCache.has(id)) return collectionsCache.get(id) ?? null
    const collection = await figma.variables.getVariableCollectionByIdAsync(id).catch(() => null)
    collectionsCache.set(id, collection)
    return collection
  }

  async function resolveAliasChain(
    value: VariableValue,
    preferredModeName: string,
    visitedAliases: Set<string>,
    depth: number
  ): Promise<{ terminal: VariableValue | null; resolvedType: string | null }> {
    if (depth > MAX_ALIAS_DEPTH) return { terminal: null, resolvedType: null }
    if (!isVariableAlias(value)) return { terminal: value, resolvedType: null }
    if (visitedAliases.has(value.id)) return { terminal: null, resolvedType: null }
    visitedAliases.add(value.id)
    const aliased = await loadVariable(value.id)
    if (!aliased) return { terminal: null, resolvedType: null }
    const aliasedCollection = await getCollection(aliased.variableCollectionId)
    const modeId = pickAliasedModeId(aliasedCollection, preferredModeName)
    if (!modeId) return { terminal: null, resolvedType: aliased.resolvedType }
    const nextValue = aliased.valuesByMode[modeId]
    if (nextValue === undefined) return { terminal: null, resolvedType: aliased.resolvedType }
    const downstream = await resolveAliasChain(nextValue, preferredModeName, visitedAliases, depth + 1)
    return { terminal: downstream.terminal, resolvedType: downstream.resolvedType ?? aliased.resolvedType }
  }

  const seeds = await Promise.all(Array.from(ids).map(loadVariable))
  const resolved: ResolvedVariable[] = []
  for (const variable of seeds) {
    if (!variable) continue
    const collection = await getCollection(variable.variableCollectionId)
    const modeNames = new Map<string, string>()
    if (collection) {
      for (const mode of collection.modes) modeNames.set(mode.modeId, mode.name)
    }
    const modes: Record<string, string> = {}
    for (const [modeId, rawValue] of Object.entries(variable.valuesByMode)) {
      const modeName = modeNames.get(modeId) ?? modeId
      if (isVariableAlias(rawValue)) {
        const { terminal, resolvedType } = await resolveAliasChain(rawValue as VariableValue, modeName, new Set<string>(), 0)
        modes[modeName] = terminal !== null ? formatVariableValue(terminal, resolvedType ?? variable.resolvedType) : 'unresolved'
      } else {
        modes[modeName] = formatVariableValue(rawValue as VariableValue, variable.resolvedType)
      }
    }
    resolved.push({ id: variable.id, name: variable.name, collection: collection?.name ?? 'unknown', resolvedType: variable.resolvedType, modes })
  }
  resolved.sort((a, b) => a.name.localeCompare(b.name))
  return resolved
}

export type AnnotationCategoryLookup = Map<string, string>

export async function loadAnnotationCategories(): Promise<AnnotationCategoryLookup> {
  const lookup: AnnotationCategoryLookup = new Map()
  if (!figma.annotations) return lookup
  try {
    const categories = await figma.annotations.getAnnotationCategoriesAsync()
    for (const category of categories) lookup.set(category.id, category.label)
  } catch {
    // Annotations API may not be available; ignore.
  }
  return lookup
}

function extractAnnotationsForNode(node: SceneNode, categories: AnnotationCategoryLookup): AnnotationEntry[] | undefined {
  if (!('annotations' in node)) return undefined
  const list = (node as SceneNode & AnnotationsMixin).annotations
  if (!list || list.length === 0) return undefined
  const entries: AnnotationEntry[] = []
  for (const annotation of list) {
    const label = (annotation.label ?? '').trim()
    if (!label) continue
    const entry: AnnotationEntry = { label }
    if (annotation.categoryId) {
      const categoryName = categories.get(annotation.categoryId)
      if (categoryName) entry.category = categoryName
    }
    if (annotation.properties && annotation.properties.length > 0) {
      const props: Record<string, string> = {}
      for (const prop of annotation.properties) props[prop.type] = String((prop as { value?: unknown }).value ?? '')
      if (Object.keys(props).length > 0) entry.properties = props
    }
    entries.push(entry)
  }
  return entries.length > 0 ? entries : undefined
}

function getNodeDevStatus(node: SceneNode): UiNodeSpec['devStatus'] {
  if (!('devStatus' in node)) return undefined
  const status = (node as SceneNode & { devStatus?: { type?: string } | null }).devStatus
  if (!status || !status.type) return undefined
  if (status.type === 'READY_FOR_DEV' || status.type === 'COMPLETED' || status.type === 'NONE') return status.type
  return undefined
}

const CSS_KEYS_OF_INTEREST = new Set([
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'gap', 'row-gap', 'column-gap', 'display', 'flex-direction', 'align-items', 'justify-content',
  'background', 'background-color', 'background-image', 'border', 'border-radius', 'box-shadow',
  'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'letter-spacing', 'text-align', 'text-transform'
])

function compactCss(css: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(css)) {
    if (CSS_KEYS_OF_INTEREST.has(key) && value && value !== 'none' && value !== '0px') out[key] = value
  }
  return out
}

export interface EnrichOptions {
  attachCssTo?: 'all' | 'leaves-and-text'
  categories?: AnnotationCategoryLookup
  maxNodesForCss?: number
}

export async function enrichUiSpec(spec: UiSpec, root: SceneNode, options: EnrichOptions = {}): Promise<UiSpec> {
  const categories = options.categories ?? (await loadAnnotationCategories())
  const maxNodesForCss = options.maxNodesForCss ?? 120
  let cssBudget = maxNodesForCss

  async function walk(specNode: UiNodeSpec, sceneNode: SceneNode): Promise<void> {
    const annotations = extractAnnotationsForNode(sceneNode, categories)
    if (annotations) specNode.annotations = annotations

    const devStatus = getNodeDevStatus(sceneNode)
    if (devStatus) specNode.devStatus = devStatus

    if (sceneNode.type === 'INSTANCE' && specNode.instance) {
      try {
        const main = await sceneNode.getMainComponentAsync()
        if (main) {
          const parent = main.parent
          const displayName = parent && parent.type === 'COMPONENT_SET' ? parent.name : main.name
          specNode.instance.mainComponentName = displayName
          specNode.instance.mainComponentKey = main.key
        }
      } catch {
        // main component may be inaccessible (deleted, library not loaded); skip
      }
    }

    if (cssBudget > 0 && 'getCSSAsync' in sceneNode) {
      const sceneChildren = 'children' in sceneNode ? sceneNode.children : undefined
      const shouldAttach =
        options.attachCssTo === 'all' ||
        !sceneChildren ||
        sceneChildren.length === 0 ||
        sceneNode.type === 'TEXT' ||
        sceneNode.type === 'INSTANCE' ||
        sceneNode.type === 'FRAME' ||
        sceneNode.type === 'COMPONENT' ||
        sceneNode.type === 'COMPONENT_SET'
      if (shouldAttach) {
        cssBudget -= 1
        try {
          // Real, stable Figma Plugin API (Dev Mode's own CSS panel uses it) —
          // just missing from @figma/plugin-typings@1.134.0, hence the cast.
          // `'getCSSAsync' in sceneNode` above only narrows at runtime, not
          // the TS union type.
          const css = await (sceneNode as unknown as { getCSSAsync(): Promise<Record<string, string>> }).getCSSAsync()
          const compact = compactCss(css)
          if (Object.keys(compact).length > 0) specNode.css = compact
        } catch {
          // ignore per-node failures
        }
      }
    }

    if ('children' in sceneNode) {
      const byId = new Map(sceneNode.children.map((child) => [child.id, child]))
      for (const childSpec of specNode.children) {
        const childScene = byId.get(childSpec.id)
        if (childScene) await walk(childSpec, childScene)
      }
    }
  }

  await walk(spec.root, root)

  try {
    const resolvedVariables = await resolveVariablesForNode(root)
    if (resolvedVariables.length > 0) spec.tokenization.resolvedVariables = resolvedVariables
  } catch {
    // Variables API may be unavailable in some files; skip silently.
  }

  return spec
}

export function extractUiSpec(root: SceneNode): UiSpec {
  const stats: MutableStats = {
    totalNodes: 0, frames: 0, instances: 0, textNodes: 0, autoLayoutFrames: 0, absoluteNodes: 0,
    styleRefs: 0, variableRefs: 0, rawValueCandidates: 0
  }
  const rootSpec = extractNode(root, stats)
  const tokenRefs = stats.styleRefs + stats.variableRefs
  const totalTokenSignals = tokenRefs + stats.rawValueCandidates
  const coverage = totalTokenSignals > 0 ? tokenRefs / totalTokenSignals : 0.5
  return {
    version: '1.1.0',
    root: rootSpec,
    stats: {
      totalNodes: stats.totalNodes, frames: stats.frames, instances: stats.instances,
      textNodes: stats.textNodes, autoLayoutFrames: stats.autoLayoutFrames, absoluteNodes: stats.absoluteNodes
    },
    tokenization: {
      styleRefs: stats.styleRefs, variableRefs: stats.variableRefs,
      rawValueCandidates: stats.rawValueCandidates, coverage: Number(coverage.toFixed(3))
    }
  }
}

// ── analyze.ts ───────────────────────────────────────────────────────

interface AnalyzeOptions {
  linkBase?: string
  annotationCategories?: AnnotationCategoryLookup
}

function toNodeIdParam(nodeId: string): string {
  return nodeId.replace(/:/g, '-')
}

function withNodeIdQuery(base: string, nodeId: string): string {
  const cleanBase = base.trim()
  const separator = cleanBase.includes('?') ? '&' : '?'
  return `${cleanBase}${separator}node-id=${encodeURIComponent(nodeId)}`
}

function buildSelectionLink(node: SceneNode, linkBase?: string): string | undefined {
  const nodeId = toNodeIdParam(node.id)
  if (!figma.fileKey) {
    if (!linkBase) return undefined
    return withNodeIdQuery(linkBase, nodeId)
  }
  const fileName = encodeURIComponent(figma.root.name || 'Untitled')
  return `https://www.figma.com/design/${figma.fileKey}/${fileName}?node-id=${encodeURIComponent(nodeId)}`
}

function getSelectedNodeInfo(node: SceneNode, linkBase?: string): SelectedNodeInfo {
  const selected: SelectedNodeInfo = { id: node.id, name: node.name, type: node.type, link: buildSelectionLink(node, linkBase) }
  if ('width' in node) selected.width = node.width
  if ('height' in node) selected.height = node.height
  return selected
}

export function analyzeNodeCore(node: SceneNode, options?: AnalyzeOptions): AnalysisCore {
  const selectedNode = getSelectedNodeInfo(node, options?.linkBase)
  const intent = classifyIntent(node)
  const uiSpec = extractUiSpec(node)
  return { selectedNode, intent, uiSpec }
}

export async function analyzeNodeCoreAsync(node: SceneNode, options?: AnalyzeOptions): Promise<AnalysisCore> {
  const core = analyzeNodeCore(node, options)
  const categories = options?.annotationCategories ?? (await loadAnnotationCategories())
  // Тот же комментарий, что в оригинале: per-node css block раздувает
  // payload — не тащим его в путь get_spec/export_tokens.
  await enrichUiSpec(core.uiSpec, node, { categories, maxNodesForCss: 0 })
  return core
}

// ── serialize.ts ─────────────────────────────────────────────────────

export function flattenNodes(root: UiNodeSpec): UiNodeSpec[] {
  const queue: UiNodeSpec[] = [root]
  const result: UiNodeSpec[] = []
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    result.push(current)
    for (const child of current.children) queue.push(child)
  }
  return result
}

export function collectAnnotationEntries(uiSpec: UiSpec): string[] {
  const nodes = flattenNodes(uiSpec.root).filter((node) => node.annotations && node.annotations.length > 0)
  const entries: string[] = []
  for (const node of nodes.slice(0, 20)) {
    for (const annotation of node.annotations ?? []) {
      const category = annotation.category ? `[${annotation.category}] ` : ''
      entries.push(`${node.name} (${node.id}): ${category}${annotation.label}`)
    }
  }
  return entries
}

export function collectInstances(uiSpec: UiSpec): UiNodeSpec[] {
  return flattenNodes(uiSpec.root).filter((node) => node.type === 'INSTANCE')
}

// ── tokens.ts ────────────────────────────────────────────────────────

export type TokenFormat = 'css' | 'tailwind' | 'sass' | 'dtcg'

function pathParts(name: string): string[] {
  return name
    .split('/')
    .map((p) => p.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase())
    .filter(Boolean)
}

function slug(name: string): string {
  return pathParts(name).join('-') || 'token'
}

function modeEntries(v: ResolvedVariable): Array<[string, string]> {
  return Object.entries(v.modes)
}

function defaultValue(v: ResolvedVariable): string {
  const first = modeEntries(v)[0]
  return first ? first[1] : ''
}

function dedupe(vars: ResolvedVariable[]): ResolvedVariable[] {
  const seen = new Set<string>()
  const out: ResolvedVariable[] = []
  for (const v of vars) {
    const key = `${slug(v.name)}|${JSON.stringify(v.modes)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

function exportCss(vars: ResolvedVariable[]): string {
  const modeNames: string[] = []
  for (const v of vars) {
    for (const [m] of modeEntries(v)) if (!modeNames.includes(m)) modeNames.push(m)
  }
  if (modeNames.length === 0) return ':root {\n}\n'
  const blocks: string[] = []
  modeNames.forEach((mode, i) => {
    const selector = i === 0 ? ':root' : `[data-theme="${slug(mode)}"]`
    const lines = vars
      .map((v) => {
        const val = v.modes[mode] ?? defaultValue(v)
        return val ? `  --${slug(v.name)}: ${val};` : null
      })
      .filter(Boolean)
    blocks.push(`${selector} {\n${lines.join('\n')}\n}`)
  })
  return blocks.join('\n\n') + '\n'
}

function exportSass(vars: ResolvedVariable[]): string {
  const lines = vars
    .map((v) => {
      const val = defaultValue(v)
      return val ? `$${slug(v.name)}: ${val};` : null
    })
    .filter(Boolean)
  return lines.join('\n') + '\n'
}

function exportTailwind(vars: ResolvedVariable[]): string {
  const groups: Record<string, Record<string, string>> = {}
  for (const v of vars) {
    const parts = pathParts(v.name)
    const group = parts.length > 1 ? parts[0]! : 'tokens'
    const key = (parts.length > 1 ? parts.slice(1) : parts).join('-') || 'DEFAULT'
    const val = defaultValue(v)
    if (!val) continue
    ;(groups[group] ??= {})[key] = val
  }
  const theme = { theme: { extend: groups } }
  return '// tailwind.config.js — design tokens exported from Figma by Web To Figma\nmodule.exports = ' + JSON.stringify(theme, null, 2) + ';\n'
}

function dtcgType(resolvedType: string): string {
  switch (resolvedType) {
    case 'COLOR':
      return 'color'
    case 'FLOAT':
      return 'number'
    case 'BOOLEAN':
      return 'boolean'
    default:
      return 'string'
  }
}

function exportDtcg(vars: ResolvedVariable[]): string {
  const root: Record<string, unknown> = {}
  for (const v of vars) {
    const parts = pathParts(v.name)
    let node = root
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        const entry: Record<string, unknown> = { $type: dtcgType(v.resolvedType), $value: defaultValue(v) }
        const modes = v.modes
        if (Object.keys(modes).length > 1) entry.$extensions = { 'com.webtofigma.modes': modes }
        node[part] = entry
      } else {
        node[part] = (node[part] as Record<string, unknown>) ?? {}
        node = node[part] as Record<string, unknown>
      }
    })
  }
  return JSON.stringify(root, null, 2) + '\n'
}

export function exportTokens(vars: ResolvedVariable[], format: TokenFormat): string {
  const deduped = dedupe(vars ?? [])
  if (deduped.length === 0) {
    return `/* No Figma variables resolved for this selection. Bind values to variables in Figma, or export ${format} after selecting a frame that uses tokens. */\n`
  }
  switch (format) {
    case 'css':
      return exportCss(deduped)
    case 'sass':
      return exportSass(deduped)
    case 'tailwind':
      return exportTailwind(deduped)
    case 'dtcg':
      return exportDtcg(deduped)
    default:
      throw new Error(`Unknown token format: ${format}`)
  }
}

// ── designdoc.ts ─────────────────────────────────────────────────────

export interface DesignDocFrame {
  core: AnalysisCore
}

export interface DesignDocMeta {
  fileName: string
  omittedFrameCount?: number
}

interface Rgb {
  r: number
  g: number
  b: number
  a: number
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function parseColor(raw: string): Rgb | null {
  const input = raw.trim()
  const hex = input.match(/^#([0-9a-fA-F]{3,8})$/)
  if (hex && hex[1]) {
    let h = hex[1]
    if (h.length === 3) {
      h = h.split('').map((c) => c + c).join('')
    }
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16)
      const g = parseInt(h.slice(2, 4), 16)
      const b = parseInt(h.slice(4, 6), 16)
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      return { r, g, b, a }
    }
    return null
  }
  const rgb = input.match(/rgba?\(([^)]+)\)/i)
  if (rgb && rgb[1]) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean)
    if (parts.length >= 3) {
      const r = parseFloat(parts[0] ?? '')
      const g = parseFloat(parts[1] ?? '')
      const b = parseFloat(parts[2] ?? '')
      const a = parts.length >= 4 ? parseFloat(parts[3] ?? '1') : 1
      if ([r, g, b].every((n) => Number.isFinite(n))) {
        return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: Number.isFinite(a) ? a : 1 }
      }
    }
  }
  return null
}

function extractColor(value: string): Rgb | null {
  const token = value.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/i)
  return token ? parseColor(token[0]) : null
}

function toHex({ r, g, b, a }: Rgb): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, '0')
  const base = `#${h(r)}${h(g)}${h(b)}`
  return a < 1 ? `${base}${Math.round(a * 255).toString(16).padStart(2, '0')}` : base
}

function luminance({ r, g, b }: Rgb): number {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

type ColorRole = 'text' | 'bg' | 'border'

interface ColorHit {
  hex: string
  rgb: Rgb
  count: number
  roles: Set<ColorRole>
}

function gatherColorHits(nodes: UiNodeSpec[]): { hits: ColorHit[]; hasGradient: boolean } {
  const map = new Map<string, ColorHit>()
  let hasGradient = false
  const add = (rgb: Rgb | null, role: ColorRole) => {
    if (!rgb || rgb.a === 0) return
    const hex = toHex(rgb)
    const existing = map.get(hex)
    if (existing) {
      existing.count += 1
      existing.roles.add(role)
    } else {
      map.set(hex, { hex, rgb, count: 1, roles: new Set([role]) })
    }
  }
  for (const node of nodes) {
    const css = node.css
    if (css) {
      if (css['color']) add(parseColor(css['color']), 'text')
      const bg = css['background-color'] ?? css['background']
      if (bg) {
        if (/gradient/i.test(bg)) hasGradient = true
        add(extractColor(bg), 'bg')
      }
      if (css['border']) add(extractColor(css['border']), 'border')
    }
    const visual = node.visual
    if (visual) {
      const fillRole: ColorRole = node.type === 'TEXT' ? 'text' : 'bg'
      for (const hex of visual.fillColors ?? []) add(parseColor(hex), fillRole)
      if (visual.strokeColor) add(parseColor(visual.strokeColor), 'border')
    }
  }
  const hits = [...map.values()].sort((a, b) => b.count - a.count)
  return { hits, hasGradient }
}

function sanitizeKey(name: string): string {
  const cleaned = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'token'
}

function uniqueKey(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let i = 2
  while (used.has(`${base}-${i}`)) i += 1
  const key = `${base}-${i}`
  used.add(key)
  return key
}

interface ColorTokens {
  ordered: Array<{ key: string; value: string }>
  byValue: Map<string, string>
}

function buildColorTokens(frames: DesignDocFrame[], nodes: UiNodeSpec[]): ColorTokens {
  const used = new Set<string>()
  const ordered: Array<{ key: string; value: string }> = []
  const byValue = new Map<string, string>()
  const push = (key: string, value: string) => {
    const k = uniqueKey(sanitizeKey(key), used)
    ordered.push({ key: k, value })
    const norm = parseColor(value)
    if (norm && !byValue.has(toHex(norm))) byValue.set(toHex(norm), k)
  }

  const variables: ResolvedVariable[] = []
  for (const frame of frames) variables.push(...(frame.core.uiSpec.tokenization.resolvedVariables ?? []))
  const colorVars = variables.filter((v) => /color/i.test(v.resolvedType))
  const seenVar = new Set<string>()
  for (const v of colorVars) {
    const value = Object.values(v.modes)[0]
    if (!value || seenVar.has(v.name)) continue
    seenVar.add(v.name)
    if (parseColor(value)) push(v.name, toHex(parseColor(value) as Rgb))
    if (ordered.length >= 16) break
  }
  if (ordered.length > 0) return { ordered, byValue }

  const { hits } = gatherColorHits(nodes)
  if (hits.length === 0) return { ordered, byValue }

  const taken = new Set<string>()
  const claim = (hit: ColorHit | undefined, key: string) => {
    if (!hit || taken.has(hit.hex)) return
    taken.add(hit.hex)
    push(key, hit.hex)
  }

  const primary = hits.find((h) => saturation(h.rgb) >= 0.25)
  claim(primary, 'primary')
  const surface = hits.find((h) => h.roles.has('bg') && luminance(h.rgb) >= 0.5 && !taken.has(h.hex))
  claim(surface ?? hits.find((h) => h.roles.has('bg') && !taken.has(h.hex)), 'surface')
  const onSurface = hits.find((h) => h.roles.has('text') && !taken.has(h.hex))
  claim(onSurface, 'on-surface')

  let neutral = 1
  let accent = 2
  for (const hit of hits) {
    if (taken.has(hit.hex) || ordered.length >= 10) continue
    if (saturation(hit.rgb) >= 0.25) {
      claim(hit, accent === 2 ? 'accent' : `accent-${accent}`)
      accent += 1
    } else {
      claim(hit, `neutral-${neutral}`)
      neutral += 1
    }
  }
  return { ordered, byValue }
}

const WEIGHT_NAMES: Array<[RegExp, number]> = [
  [/thin|hairline/, 100],
  [/extra[\s-]?light|ultra[\s-]?light/, 200],
  [/light/, 300],
  [/regular|normal|book/, 400],
  [/medium/, 500],
  [/semi[\s-]?bold|demi[\s-]?bold/, 600],
  [/extra[\s-]?bold|ultra[\s-]?bold/, 800],
  [/black|heavy/, 900],
  [/bold/, 700]
]

function weightFor(node: UiNodeSpec): number {
  const cssWeight = node.css?.['font-weight']
  if (cssWeight) {
    const n = parseInt(cssWeight, 10)
    if (Number.isFinite(n)) return n
  }
  const style = (node.text?.fontStyle ?? '').toLowerCase()
  for (const [re, w] of WEIGHT_NAMES) {
    if (re.test(style)) return w
  }
  return 400
}

function normalizeDimension(value: string | undefined): string | undefined {
  if (!value) return undefined
  const v = value.trim()
  if (!v || /^(auto|normal|none)$/i.test(v)) return undefined
  const pct = v.match(/^(-?\d+(?:\.\d+)?)%$/)
  if (pct && pct[1]) {
    const ratio = Math.round((parseFloat(pct[1]) / 100) * 100) / 100
    return String(ratio)
  }
  return v
}

interface TypographyToken {
  key: string
  fontFamily?: string
  fontSize: number
  fontWeight: number
  lineHeight?: string
  letterSpacing?: string
}

function sizeName(size: number): string {
  if (size >= 32) return 'display'
  if (size >= 24) return 'headline'
  if (size >= 20) return 'title'
  if (size >= 16) return 'body-lg'
  if (size >= 14) return 'body'
  if (size >= 12) return 'label'
  return 'caption'
}

function buildTypographyTokens(nodes: UiNodeSpec[]): TypographyToken[] {
  const combos = new Map<string, { token: Omit<TypographyToken, 'key'>; count: number }>()
  for (const node of nodes) {
    if (!node.text) continue
    const size = node.text.fontSize ?? (node.css?.['font-size'] ? parseFloat(node.css['font-size']) : undefined)
    if (!size || !Number.isFinite(size)) continue
    const family = (node.css?.['font-family'] ?? node.text.fontFamily ?? '').replace(/["']/g, '').trim()
    const weight = weightFor(node)
    const lineHeight = normalizeDimension(node.css?.['line-height'] ?? node.text.lineHeight)
    const letterSpacing = normalizeDimension(node.css?.['letter-spacing'] ?? node.text.letterSpacing)
    const rounded = Math.round(size)
    const key = `${family}|${rounded}|${weight}|${lineHeight ?? ''}|${letterSpacing ?? ''}`
    const existing = combos.get(key)
    if (existing) {
      existing.count += 1
    } else {
      combos.set(key, { count: 1, token: { fontFamily: family || undefined, fontSize: rounded, fontWeight: weight, lineHeight, letterSpacing } })
    }
  }
  const ranked = [...combos.values()].sort((a, b) => b.token.fontSize - a.token.fontSize).slice(0, 8)
  const used = new Set<string>()
  return ranked.map((entry) => ({ key: uniqueKey(sizeName(entry.token.fontSize), used), ...entry.token }))
}

function buildScale(values: number[], names: string[]): Array<{ key: string; value: number }> {
  const unique = [...new Set(values.filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.round(n)))].sort((a, b) => a - b)
  return unique.slice(0, names.length).map((value, i) => ({ key: names[i] ?? `s-${i}`, value }))
}

function collectSpacing(nodes: UiNodeSpec[]): number[] {
  const counts = new Map<number, number>()
  for (const node of nodes) {
    const l = node.layout
    if (!l) continue
    for (const v of [l.itemSpacing, l.paddingTop, l.paddingRight, l.paddingBottom, l.paddingLeft]) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        const key = Math.round(v)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()].filter(([, c]) => c >= 2).map(([value]) => value)
}

function collectRadii(nodes: UiNodeSpec[]): number[] {
  const values: number[] = []
  for (const node of nodes) {
    const r = node.visual?.cornerRadius
    if (typeof r === 'number') values.push(r)
  }
  return values
}

function collectShadows(nodes: UiNodeSpec[]): string[] {
  const set = new Set<string>()
  for (const node of nodes) {
    const shadow = node.css?.['box-shadow']
    if (shadow && shadow !== 'none') set.add(shadow.trim())
  }
  return [...set]
}

interface ComponentToken {
  key: string
  backgroundColor?: string
  textColor?: string
}

function colorRef(value: string | undefined, byValue: Map<string, string>): string | undefined {
  if (!value) return undefined
  const rgb = extractColor(value)
  if (!rgb) return undefined
  const hex = toHex(rgb)
  const token = byValue.get(hex)
  return token ? `{colors.${token}}` : hex
}

function buildComponentTokens(frames: DesignDocFrame[], byValue: Map<string, string>): ComponentToken[] {
  const seen = new Map<string, ComponentToken>()
  for (const frame of frames) {
    for (const instance of collectInstances(frame.core.uiSpec)) {
      const name = instance.instance?.mainComponentName ?? instance.name
      if (!name) continue
      const key = sanitizeKey(name)
      if (seen.has(key)) continue
      const bg = colorRef(instance.css?.['background-color'] ?? instance.css?.['background'], byValue)
      let textColor: string | undefined
      for (const child of flattenNodes(instance)) {
        if (child.text && child.css?.['color']) {
          textColor = colorRef(child.css['color'], byValue)
          if (textColor) break
        }
      }
      seen.set(key, { key, backgroundColor: bg, textColor })
      if (seen.size >= 16) break
    }
  }
  return [...seen.values()]
}

function yamlString(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function emitFrontmatter(
  meta: DesignDocMeta,
  description: string,
  colors: ColorTokens,
  typography: TypographyToken[],
  spacing: Array<{ key: string; value: number }>,
  rounded: Array<{ key: string; value: number }>,
  components: ComponentToken[]
): string {
  const lines: string[] = ['---', 'version: alpha', `name: ${yamlString(meta.fileName)}`]
  if (description) lines.push(`description: ${yamlString(description)}`)

  if (colors.ordered.length > 0) {
    lines.push('colors:')
    for (const c of colors.ordered) lines.push(`  ${c.key}: ${yamlString(c.value)}`)
  }

  if (typography.length > 0) {
    lines.push('typography:')
    for (const t of typography) {
      lines.push(`  ${t.key}:`)
      if (t.fontFamily) lines.push(`    fontFamily: ${yamlString(t.fontFamily)}`)
      lines.push(`    fontSize: ${t.fontSize}px`)
      lines.push(`    fontWeight: ${t.fontWeight}`)
      if (t.lineHeight) lines.push(`    lineHeight: ${t.lineHeight}`)
      if (t.letterSpacing) lines.push(`    letterSpacing: ${yamlString(t.letterSpacing)}`)
    }
  }

  if (spacing.length > 0) {
    lines.push('spacing:')
    for (const s of spacing) lines.push(`  ${s.key}: ${s.value}px`)
  }

  if (rounded.length > 0) {
    lines.push('rounded:')
    for (const r of rounded) lines.push(`  ${r.key}: ${r.value}px`)
  }

  if (components.length > 0) {
    lines.push('components:')
    for (const c of components) {
      lines.push(`  ${c.key}:`)
      if (c.backgroundColor) lines.push(`    backgroundColor: ${yamlString(c.backgroundColor)}`)
      if (c.textColor) lines.push(`    textColor: ${yamlString(c.textColor)}`)
    }
  }

  lines.push('---')
  return lines.join('\n')
}

function describeLayout(uiSpec: UiSpec): string | null {
  const layout = uiSpec.root.layout
  if (!layout || !layout.layoutMode || layout.layoutMode === 'NONE') return null
  if (layout.layoutMode === 'GRID') {
    const cols = layout.gridColumnCount ?? '?'
    const rows = layout.gridRowCount ?? '?'
    const parts = [`grid layout, ${cols} cols × ${rows} rows`]
    const gaps: string[] = []
    if (typeof layout.gridColumnGap === 'number') gaps.push(`col ${layout.gridColumnGap}`)
    if (typeof layout.gridRowGap === 'number') gaps.push(`row ${layout.gridRowGap}`)
    if (gaps.length) parts.push(`gap ${gaps.join('/')}`)
    return parts.join(', ')
  }
  const direction = layout.layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical'
  const parts = [`${direction} auto-layout`]
  if (typeof layout.itemSpacing === 'number') parts.push(`gap ${layout.itemSpacing}`)
  return parts.join(', ')
}

export function generateDesignDoc(frames: DesignDocFrame[], meta: DesignDocMeta): string {
  const nodes = frames.flatMap((frame) => flattenNodes(frame.core.uiSpec.root))
  const frameWord = frames.length === 1 ? 'frame' : 'frames'

  const colors = buildColorTokens(frames, nodes)
  const typography = buildTypographyTokens(nodes)
  const spacing = buildScale(collectSpacing(nodes), ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'xxxl'])
  const radii = collectRadii(nodes)
  const hasPill = radii.some((r) => r >= 999)
  const roundedScale = buildScale(radii.filter((r) => r < 999), ['sm', 'md', 'lg', 'xl'])
  const rounded: Array<{ key: string; value: number }> = [{ key: 'none', value: 0 }, ...roundedScale]
  if (hasPill) rounded.push({ key: 'full', value: 9999 })
  const components = buildComponentTokens(frames, colors.byValue)
  const shadows = collectShadows(nodes)

  const description = `Design tokens extracted by Web To Figma from ${frames.length} Figma ${frameWord}.`

  const out: string[] = []
  out.push(emitFrontmatter(meta, description, colors, typography, spacing, rounded, components))

  const frameNames = frames.map((f) => f.core.selectedNode.name).filter(Boolean)

  out.push('## Overview')
  const overview: string[] = [
    `**${meta.fileName}** — tokens and guidance derived from ${frames.length} Figma ${frameWord}` + (frameNames.length ? `: ${frameNames.map((n) => `\`${n}\``).join(', ')}.` : '.'),
    '',
    'The YAML frontmatter above holds the normative token values; the prose below is context for applying them. Token values are inferred from the design, so verify names before relying on them as a formal system.'
  ]
  if (meta.omittedFrameCount && meta.omittedFrameCount > 0) {
    overview.push('', `_Note: ${meta.omittedFrameCount} additional selected ${meta.omittedFrameCount === 1 ? 'frame was' : 'frames were'} omitted to keep this focused._`)
  }
  out.push(overview.join('\n'))

  if (colors.ordered.length > 0) {
    out.push('## Colors')
    out.push(colors.ordered.map((c) => `- \`${c.key}\` — ${c.value}`).join('\n'))
  }

  if (typography.length > 0) {
    out.push('## Typography')
    out.push(
      typography
        .map((t) => {
          const bits = [`${t.fontSize}px`, `weight ${t.fontWeight}`]
          if (t.fontFamily) bits.unshift(t.fontFamily)
          return `- \`${t.key}\` — ${bits.join(', ')}`
        })
        .join('\n')
    )
  }

  out.push('## Layout')
  const layoutLines = frames
    .map((f) => {
      const desc = describeLayout(f.core.uiSpec)
      return desc ? `- \`${f.core.selectedNode.name}\`: ${desc}` : null
    })
    .filter((line): line is string => Boolean(line))
  out.push(
    layoutLines.length > 0
      ? layoutLines.join('\n')
      : 'No auto-layout on the analyzed roots — positions are freeform. Spacing tokens above reflect the gaps and padding observed in nested layers.'
  )

  out.push('## Elevation & Depth')
  const elevation =
    shadows.length > 0
      ? `Shadows in use:\n${shadows.slice(0, 6).map((s) => `- \`${s}\``).join('\n')}`
      : 'Flat — no drop shadows detected. Use borders and surface contrast for depth.'
  const shaderCount = nodes.reduce((n, node) => n + (node.visual?.shaders?.length ?? 0), 0)
  out.push(
    shaderCount > 0
      ? `${elevation}\n\n${shaderCount} shader ${shaderCount === 1 ? 'effect is' : 'effects are'} applied in the design (Figma shaders — descriptive only, not reproducible from this spec).`
      : elevation
  )

  out.push('## Shapes')
  out.push(roundedScale.length > 0 ? `Corner radii: ${rounded.map((r) => `\`${r.key}\` ${r.value}px`).join(', ')}.` : 'Square corners throughout (no corner radius detected).')

  if (components.length > 0) {
    out.push('## Components')
    out.push(components.map((c) => `- \`${c.key}\``).join('\n'))
  }

  const animations = nodes.flatMap((n) => n.animations ?? [])
  if (animations.length > 0) {
    out.push('## Motion')
    const byName = new Map<string, number>()
    for (const a of animations) byName.set(a.name, (byName.get(a.name) ?? 0) + 1)
    const lines = [...byName.entries()].map(([name, count]) => `- \`${name}\`${count > 1 ? ` ×${count}` : ''}`)
    out.push(`Figma Motion animation styles applied in the design (Beta — descriptive only, not re-applied on import):\n${lines.join('\n')}`)
  }

  out.push("## Do's and Don'ts")
  const dos: string[] = [
    '- **Do** use the token values in the frontmatter verbatim; treat them as the source of truth.',
    '- **Do** reference color tokens (e.g. `{colors.primary}`) rather than hardcoding hexes.',
    "- **Don't** introduce new colors, type sizes, or spacing values outside the scales above without reason."
  ]
  const annotations = frames.flatMap((f) => collectAnnotationEntries(f.core.uiSpec))
  if (annotations.length > 0) {
    dos.push('', '**Designer notes**')
    for (const entry of annotations.slice(0, 20)) dos.push(`- ${entry}`)
  }
  out.push(dos.join('\n'))

  return out.join('\n\n') + '\n'
}
