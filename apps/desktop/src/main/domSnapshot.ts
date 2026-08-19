import type { WebContents } from 'electron'
import { createConsoleLogger } from '@web-to-figma/shared'
import type { DomSnapshotNode } from '@web-to-figma/conversion-engine'

const log = createConsoleLogger('domSnapshot')

/** Защита от CDP-снапшота гигантских поддеревьев (SPA с тысячами узлов) —
 *  см. docs/architecture.md §6.1. За пределами лимита узлы просто не входят
 *  в дерево, вызывающая сторона решает, показывать ли об этом диагностику. */
const MAX_NODES = 400

const ELEMENT_NODE = 1
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT'])

interface CdpNode {
  backendNodeId: number
  nodeType: number
  nodeName: string
  attributes?: string[]
  children?: CdpNode[]
  pseudoElements?: CdpNode[]
}
interface DescribeNodeResult {
  node: CdpNode
}
interface PushNodesResult {
  nodeIds: number[]
}
interface BoxModelResult {
  model: { width: number; height: number; border: number[] }
}
interface ComputedStyleResult {
  computedStyle: { name: string; value: string }[]
}
interface FetchedNodeData {
  box: BoxModelResult['model']
  style: Record<string, string>
}

export interface SnapshotResult {
  tree: DomSnapshotNode
  /** true — поддерево было больше MAX_NODES, часть узлов не вошла в дерево. */
  truncated: boolean
}

/**
 * DOM-поддерево выбранного элемента → DomSnapshotNode (Phase 8, "nested
 * trees"). Схема опроса CDP выбрана ради количества round-trip'ов, а не по
 * инерции: (1) один `DOM.describeNode({depth:-1})` даёт всю структуру
 * (children + pseudoElements) сразу; (2) один batch
 * `DOM.pushNodesByBackendIdsToFrontend` резолвит nodeId для ВСЕХ узлов разом
 * (нужен только для `CSS.getComputedStyleForNode` — `DOM.getBoxModel`
 * принимает backendNodeId напрямую); (3) `getBoxModel`+`getComputedStyleForNode`
 * для каждого узла — параллельно, а не по одному узлу за раз.
 */
export async function buildSnapshotTree(wc: WebContents, rootBackendNodeId: number): Promise<SnapshotResult> {
  const dbg = wc.debugger
  const described = (await dbg.sendCommand('DOM.describeNode', {
    backendNodeId: rootBackendNodeId,
    depth: -1
  })) as DescribeNodeResult

  const toFetch: number[] = []
  let truncated = false
  const collect = (node: CdpNode): void => {
    for (const id of [node.backendNodeId, ...(node.pseudoElements ?? []).map((p) => p.backendNodeId)]) {
      if (toFetch.length >= MAX_NODES) {
        truncated = true
        return
      }
      toFetch.push(id)
    }
    for (const child of node.children ?? []) {
      if (child.nodeType !== ELEMENT_NODE || SKIP_TAGS.has(child.nodeName)) continue
      collect(child)
    }
  }
  collect(described.node)

  const pushed = (await dbg.sendCommand('DOM.pushNodesByBackendIdsToFrontend', {
    backendNodeIds: toFetch
  })) as PushNodesResult
  const nodeIdByBackendId = new Map(toFetch.map((backendId, i) => [backendId, pushed.nodeIds[i]]))

  const dataByBackendId = new Map<number, FetchedNodeData>()
  await Promise.all(
    toFetch.map(async (backendId) => {
      const nodeId = nodeIdByBackendId.get(backendId)
      if (nodeId === undefined) return
      try {
        const [box, computed] = await Promise.all([
          dbg.sendCommand('DOM.getBoxModel', { backendNodeId: backendId }) as Promise<BoxModelResult>,
          dbg.sendCommand('CSS.getComputedStyleForNode', { nodeId }) as Promise<ComputedStyleResult>
        ])
        dataByBackendId.set(backendId, {
          box: box.model,
          style: Object.fromEntries(computed.computedStyle.map((e) => [e.name, e.value]))
        })
      } catch (err) {
        // Не отрендерен (display:none и т.п.) — узел и его поддерево просто выпадают из снапшота.
        log.debug('skipping node without box model', { backendId, message: (err as Error).message })
      }
    })
  )

  const rootData = dataByBackendId.get(rootBackendNodeId)
  if (!rootData) throw new Error('Selected element has no box model (not rendered)')

  const tree = buildNode(described.node, rootData, null, undefined, dataByBackendId)
  if (!tree) throw new Error('Failed to build snapshot tree for selected element')
  return { tree, truncated }
}

function boxOrigin(model: BoxModelResult['model']): { x: number; y: number } {
  return { x: model.border[0] ?? 0, y: model.border[1] ?? 0 }
}

function buildNode(
  cdpNode: CdpNode,
  data: FetchedNodeData,
  parentOrigin: { x: number; y: number } | null,
  pseudoType: 'before' | 'after' | undefined,
  dataByBackendId: Map<number, FetchedNodeData>
): DomSnapshotNode | null {
  if (pseudoType && isEmptyPseudo(data)) return null

  const nodeOrigin = boxOrigin(data.box)
  const rel = parentOrigin ? { x: nodeOrigin.x - parentOrigin.x, y: nodeOrigin.y - parentOrigin.y } : { x: 0, y: 0 }

  const attrs = cdpNode.attributes ?? []
  const attrMap = new Map<string, string>()
  for (let i = 0; i < attrs.length; i += 2) attrMap.set(attrs[i] as string, attrs[i + 1] ?? '')

  const children: DomSnapshotNode[] = []

  // CDP отдаёт pseudoElements в DOM-порядке (::before раньше ::after) — сохраняем как есть.
  for (const pseudo of cdpNode.pseudoElements ?? []) {
    const pseudoData = dataByBackendId.get(pseudo.backendNodeId)
    if (!pseudoData) continue
    const converted = buildNode(pseudo, pseudoData, nodeOrigin, pseudo.nodeName === '::after' ? 'after' : 'before', dataByBackendId)
    if (converted) children.push(converted)
  }

  for (const child of cdpNode.children ?? []) {
    if (child.nodeType !== ELEMENT_NODE || SKIP_TAGS.has(child.nodeName)) continue
    const childData = dataByBackendId.get(child.backendNodeId)
    if (!childData) continue
    const converted = buildNode(child, childData, nodeOrigin, undefined, dataByBackendId)
    if (converted) children.push(converted)
  }

  return {
    tag: pseudoType ? `::${pseudoType}` : cdpNode.nodeName.toLowerCase(),
    id: attrMap.get('id') || null,
    classes: (attrMap.get('class') ?? '').split(/\s+/).filter(Boolean),
    computedStyle: data.style,
    box: { width: data.box.width, height: data.box.height, x: Math.round(rel.x), y: Math.round(rel.y) },
    ...(children.length > 0 ? { children } : {}),
    ...(pseudoType ? { pseudoType } : {})
  }
}

/** content:''/none без размера и без фона/бордера — пустышка, не материализуем (см. docs/design-ast.md). */
function isEmptyPseudo(data: FetchedNodeData): boolean {
  const content = data.style['content']
  const hasContent = content !== undefined && content !== 'none' && content !== '""' && content !== "''"
  if (hasContent) return false
  const hasSize = data.box.width > 0 && data.box.height > 0
  const bg = data.style['background-color']
  const hasBackground = Boolean(bg) && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
  const borderWidth = parseFloat(data.style['border-top-width'] ?? '0')
  const hasBorder = borderWidth > 0 && data.style['border-top-style'] !== 'none'
  return !(hasSize && (hasBackground || hasBorder))
}
