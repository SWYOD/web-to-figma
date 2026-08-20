import type { WebContents } from 'electron'
import { createConsoleLogger } from '@web-to-figma/shared'
import { AssetCollector, fetchAssetBytes } from '@web-to-figma/asset-engine'
import type { DesignAsset } from '@web-to-figma/design-ast'
import type { DomSnapshotNode } from '@web-to-figma/conversion-engine'

const log = createConsoleLogger('domSnapshot')

/** Защита от CDP-снапшота гигантских поддеревьев (SPA с тысячами узлов) —
 *  см. docs/architecture.md §6.1. За пределами лимита узлы просто не входят
 *  в дерево, вызывающая сторона решает, показывать ли об этом диагностику. */
const MAX_NODES = 400

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT'])

/** "Чисто инлайновые" теги форматирования — необходимое (но не достаточное,
 *  см. looksLikeInlineFormatting) условие для разворота в стилизованные
 *  диапазоны ОДНОГО TextNode; нужны ВСЕ вложенные элементы из этого списка
 *  (см. extractTextRuns). Картинки/блочные элементы/таблицы и т.п. — не
 *  сюда: Figma TextNode не умеет встроенные картинки внутри текста, поэтому
 *  такой контент сознательно остаётся на старом пути (droppedInlineText,
 *  вложенные элементы — отдельными узлами). */
const INLINE_TEXT_TAGS = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'STRIKE',
  'SPAN',
  'A',
  'SMALL',
  'MARK',
  'SUB',
  'SUP',
  'CODE',
  'ABBR',
  'CITE',
  'Q',
  'TIME',
  'LABEL'
])

/**
 * Тег из INLINE_TEXT_TAGS — необходимое, но НЕ достаточное условие для
 * разворачивания в textRuns. Сайты сплошь и рядом используют `<a>`/`<span>`
 * как основу для визуально самостоятельных "пилюль"/бейджей/кнопок (тег,
 * рейтинг, чип) — своя заливка, своя рамка, свой border-radius, через
 * `display:inline-block`/`flex` и padding. Тег формально "инлайновый", но
 * визуально это отдельная фигура, а не кусок форматированного текста —
 * TextRun (см. design-ast/schema.ts) не умеет заливку/рамку/скругление НА
 * ДИАПАЗОН, только typography+color текста, так что разворачивание в
 * textRuns БЕЗ этой проверки тихо теряет всю визуальную идентичность
 * каждой такой "пилюли" и схлопывает их layout (gap/wrap) в одну строку
 * без пробелов — конкретно так и было поймано (реальный сайт, блок тегов
 * новостей: весь блок ссылок-пилюль превратился в один текстовый слой без
 * стилей). Если хоть один вложенный "инлайновый" тег визуально ведёт себя
 * как коробка — весь разворот в textRuns отменяется (см. extractTextRuns),
 * откат на старый путь: элементы конвертируются каждый сам по себе,
 * заливка/рамка/скругление там уже применяются штатно.
 */
function looksLikeInlineFormatting(style: Record<string, string>): boolean {
  const bg = style['background-color']
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return false
  if (style['box-shadow'] && style['box-shadow'] !== 'none') return false
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const borderStyle = style[`border-${side}-style`]
    const borderWidth = parseFloat(style[`border-${side}-width`] ?? '0')
    if (borderStyle && borderStyle !== 'none' && borderWidth > 0) return false
  }
  return true
}

/** figma.createImage() принимает только эти форматы — см. Figma Plugin API. */
const SUPPORTED_RASTER_MIME = new Set(['image/png', 'image/jpeg', 'image/gif'])

interface CdpNode {
  backendNodeId: number
  nodeType: number
  nodeName: string
  nodeValue?: string
  attributes?: string[]
  children?: CdpNode[]
  pseudoElements?: CdpNode[]
}
interface DescribeNodeResult {
  node: CdpNode
}
interface GetDocumentResult {
  root: { baseURL: string }
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
interface OuterHtmlResult {
  outerHTML: string
}
interface CssProperty {
  name: string
  value: string
}
interface MatchedStylesResult {
  inlineStyle?: { cssProperties: CssProperty[] }
  matchedCSSRules?: { rule: { origin: string; style: { cssProperties: CssProperty[] } } }[]
}
interface FetchedNodeData {
  box: BoxModelResult['model']
  style: Record<string, string>
  /** true = свойство реально ЗАДАНО каким-то правилом автора страницы (или
   *  inline style), не только унаследовано/резолвлено дефолтом браузера — см.
   *  hasAuthoredProperty ниже и докстринг у DomSnapshotNode.authoredSizing в
   *  conversion-engine. */
  authoredSizing: { width: boolean; height: boolean }
}

/**
 * computed-стиль (`CSS.getComputedStyleForNode`) ВСЕГДА резолвится в
 * конкретное px-значение и не говорит, было ли оно явно задано автором
 * страницы или это просто browser-дефолт (`width:auto` на блочном элементе
 * резолвится в те же px, что и `width:100%`) — этого достаточно для layout/
 * позиционирования, но НЕДОСТАТОЧНО, чтобы отличить "должен hug-аться по
 * контенту" от "явно растянут на всю ширину" (см. resolveSizing в
 * convertElement.ts). Для этого нужен authored-уровень — `matchedCSSRules`
 * (+ `inlineStyle`) из `CSS.getMatchedStylesForNode`: реально применённые к
 * узлу CSS-правила автора, а не user-agent-стили браузера по умолчанию.
 */
function hasAuthoredProperty(matched: MatchedStylesResult, propertyName: string): boolean {
  if (matched.inlineStyle?.cssProperties.some((p) => p.name === propertyName)) return true
  return (matched.matchedCSSRules ?? []).some(
    (m) => m.rule.origin !== 'user-agent' && m.rule.style.cssProperties.some((p) => p.name === propertyName)
  )
}

export interface SnapshotResult {
  tree: DomSnapshotNode
  /** true — поддерево было больше MAX_NODES, часть узлов не вошла в дерево. */
  truncated: boolean
  assets: Record<string, DesignAsset>
}

/**
 * Прямой текст ИЛИ смешанный контент элемента.
 *
 * Чистый текстовый лист (все прямые дети — DOM-текстовые узлы, ни одного
 * дочернего элемента) — как раньше, `text`.
 *
 * Смешанный контент (текст + вложенные теги, напр. `<p>Some <b>x</b> text</p>`,
 * а также случай "только вложенные инлайновые теги без голого текста вокруг",
 * напр. `<p><b>x</b> <i>y</i></p>`) — пробуем развернуть ВСЁ поддерево в
 * плоский список стилизованных диапазонов (`textRuns`, см. extractTextRuns).
 * Получается, только если КАЖДЫЙ вложенный элемент — "чисто инлайновый" тег
 * форматирования (INLINE_TEXT_TAGS) И визуально ведёт себя как текст, а не
 * как отдельная фигура (см. looksLikeInlineFormatting — своя заливка/рамка/
 * тень отменяет разворот, даже если тег из allowlist: сайты сплошь и рядом
 * стилизуют `<a>`/`<span>` под "пилюли"/бейджи). Если среди вложенных
 * попался тег вне списка (картинка, блочный элемент и т.п.) ИЛИ элемент из
 * списка, но визуально не текст — откат на старое поведение: вложенные
 * элементы конвертируются как обычно сами по себе, а потерянный "голый"
 * прямой текст вокруг них помечается `droppedInlineText` для diagnostic,
 * а не тихо пропадает без следа.
 *
 * Пробелы нормализуются как в CSS `white-space:normal` (частый случай, а не
 * точный расчёт per-node computed white-space — упрощение, задокументировано
 * в conversion-rules.md).
 */
function extractTextContent(
  cdpNode: CdpNode,
  dataByBackendId: Map<number, FetchedNodeData>
): { text?: string; textRuns?: { text: string; style: Record<string, string> }[]; droppedInlineText?: boolean } {
  let hasElementChild = false
  let hasDirectText = false

  for (const child of cdpNode.children ?? []) {
    if (child.nodeType === ELEMENT_NODE && !SKIP_TAGS.has(child.nodeName)) {
      hasElementChild = true
    } else if (child.nodeType === TEXT_NODE && (child.nodeValue ?? '').trim() !== '') {
      hasDirectText = true
    }
  }

  if (!hasElementChild) {
    if (!hasDirectText) return {}
    const rawText = (cdpNode.children ?? [])
      .filter((c) => c.nodeType === TEXT_NODE)
      .map((c) => c.nodeValue ?? '')
      .join('')
    return { text: rawText.replace(/\s+/g, ' ').trim() }
  }

  const rawRuns = extractTextRuns(cdpNode, dataByBackendId)
  if (rawRuns === null) return hasDirectText ? { droppedInlineText: true } : {}
  const trimmed = trimRunsEdges(rawRuns)
  if (trimmed.length === 0) return {}
  return { textRuns: trimmed }
}

/**
 * Разворачивает смешанный контент в плоский список `{text, style}` прогонов
 * (DOM-порядок) — null, если среди вложенных элементов встретился НЕ "чисто
 * инлайновый" тег (см. INLINE_TEXT_TAGS) ИЛИ тег из allowlist, но визуально
 * не текст (см. looksLikeInlineFormatting — своя заливка/рамка/тень), тогда
 * вызывающая сторона откатывается на droppedInlineText. Стиль каждого
 * прогона — computed style ЕГО НЕПОСРЕДСТВЕННОГО родителя (тот, что
 * содержит текстовый узел напрямую) — уже с учётом полного CSS-каскада
 * (браузер сам резолвит наследование в CDP computed style), парсить каскад
 * вручную не нужно. Данные по каждому узлу уже собраны обычным обходом
 * дерева в buildSnapshotTree (INLINE_TEXT_TAGS не входят в SKIP_TAGS,
 * значит уже прошли через тот же getBoxModel/getComputedStyleForNode
 * round-trip, что и любой другой элемент) — новых CDP-вызовов не требуется.
 */
function extractTextRuns(
  cdpNode: CdpNode,
  dataByBackendId: Map<number, FetchedNodeData>
): { text: string; style: Record<string, string> }[] | null {
  const ownStyle = dataByBackendId.get(cdpNode.backendNodeId)?.style ?? {}
  const runs: { text: string; style: Record<string, string> }[] = []

  for (const child of cdpNode.children ?? []) {
    if (child.nodeType === TEXT_NODE) {
      const value = (child.nodeValue ?? '').replace(/\s+/g, ' ')
      if (value !== '') runs.push({ text: value, style: ownStyle })
      continue
    }
    if (child.nodeType !== ELEMENT_NODE) continue
    const tag = child.nodeName.toUpperCase()
    if (SKIP_TAGS.has(tag)) continue
    if (tag === 'BR') {
      runs.push({ text: '\n', style: ownStyle })
      continue
    }
    if (!INLINE_TEXT_TAGS.has(tag)) return null
    const childStyle = dataByBackendId.get(child.backendNodeId)?.style
    if (childStyle && !looksLikeInlineFormatting(childStyle)) return null
    const nested = extractTextRuns(child, dataByBackendId)
    if (nested === null) return null
    runs.push(...nested)
  }
  return runs
}

/** Внутренние прогоны собираются с сохранённым (не обрезанным) пробелом на
 *  границах — иначе "Some " перед `<b>` потеряло бы разделяющий пробел
 *  перед склейкой с "bold". Обрезаем только КРАЙНИЕ пробелы всего
 *  развёрнутого текста целиком (как браузер обрезает видимый текст блока по
 *  краям), затем убираем прогоны, опустевшие после этого. */
function trimRunsEdges(
  runs: { text: string; style: Record<string, string> }[]
): { text: string; style: Record<string, string> }[] {
  if (runs.length === 0) return runs
  const result = runs.map((r) => ({ ...r }))
  const first = result[0]!
  first.text = first.text.replace(/^\s+/, '')
  const last = result[result.length - 1]!
  last.text = last.text.replace(/\s+$/, '')
  return result.filter((r) => r.text !== '')
}

function getAttr(node: CdpNode, name: string): string | undefined {
  const attrs = node.attributes ?? []
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === name) return attrs[i + 1]
  }
  return undefined
}

/**
 * DOM-поддерево выбранного элемента → DomSnapshotNode (Phase 8, "nested
 * trees") + манифест ассетов (Phase 9). Схема опроса CDP выбрана ради
 * количества round-trip'ов, а не по инерции: (1) один
 * `DOM.describeNode({depth:-1})` даёт всю структуру (children +
 * pseudoElements) сразу; (2) один batch `DOM.pushNodesByBackendIdsToFrontend`
 * резолвит nodeId для ВСЕХ узлов разом (нужен только для
 * `CSS.getComputedStyleForNode` — `DOM.getBoxModel` принимает backendNodeId
 * напрямую); (3) `getBoxModel`+`getComputedStyleForNode` для каждого узла —
 * параллельно, а не по одному узлу за раз.
 *
 * Ассеты (Phase 9): `<img>` — байты качает НАПРЯМУЮ main-процесс через
 * `fetchAssetBytes` (обычный `fetch()`, не через JS-инъекцию в контексте
 * страницы и не через CDP `Page.getResourceContent` — тот эмпирически
 * ненадёжен для уже загруженных суб-ресурсов, см. docs/architecture.md
 * §риски, проверено live перед реализацией). Inline `<svg>` — весь узел
 * целиком становится одним vector-ассетом через `DOM.getOuterHTML`, внутрь
 * его собственного DOM (path/circle/...) не спускаемся.
 */
export async function buildSnapshotTree(wc: WebContents, rootBackendNodeId: number): Promise<SnapshotResult> {
  const dbg = wc.debugger
  const [described, doc] = await Promise.all([
    dbg.sendCommand('DOM.describeNode', { backendNodeId: rootBackendNodeId, depth: -1 }) as Promise<DescribeNodeResult>,
    dbg.sendCommand('DOM.getDocument', {}) as Promise<GetDocumentResult>
  ])
  const baseURL = doc.root.baseURL

  const toFetch: number[] = []
  const svgBackendIds = new Set<number>()
  const imgNodes = new Map<number, CdpNode>()
  let truncated = false

  const collect = (node: CdpNode): void => {
    for (const id of [node.backendNodeId, ...(node.pseudoElements ?? []).map((p) => p.backendNodeId)]) {
      if (toFetch.length >= MAX_NODES) {
        truncated = true
        return
      }
      toFetch.push(id)
    }

    const tag = node.nodeName.toUpperCase()
    if (tag === 'SVG') {
      svgBackendIds.add(node.backendNodeId)
      return // не спускаемся во внутренний DOM svg — это один vector-ассет, не поддерево
    }
    if (tag === 'IMG') {
      imgNodes.set(node.backendNodeId, node)
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
        const [box, computed, matched] = await Promise.all([
          dbg.sendCommand('DOM.getBoxModel', { backendNodeId: backendId }) as Promise<BoxModelResult>,
          dbg.sendCommand('CSS.getComputedStyleForNode', { nodeId }) as Promise<ComputedStyleResult>,
          (dbg.sendCommand('CSS.getMatchedStylesForNode', { nodeId }).catch(() => ({}))) as Promise<MatchedStylesResult>
        ])
        dataByBackendId.set(backendId, {
          box: box.model,
          style: Object.fromEntries(computed.computedStyle.map((e) => [e.name, e.value])),
          authoredSizing: { width: hasAuthoredProperty(matched, 'width'), height: hasAuthoredProperty(matched, 'height') }
        })
      } catch (err) {
        // Не отрендерен (display:none и т.п.) — узел и его поддерево просто выпадают из снапшота.
        log.debug('skipping node without box model', { backendId, message: (err as Error).message })
      }
    })
  )

  const collector = new AssetCollector()
  const assetByBackendId = new Map<number, { assetId: string; kind: 'raster' | 'svg' }>()

  await Promise.all([
    ...[...svgBackendIds].map(async (backendId) => {
      try {
        const outer = (await dbg.sendCommand('DOM.getOuterHTML', { backendNodeId: backendId })) as OuterHtmlResult
        const data = dataByBackendId.get(backendId)
        const asset = collector.addSvg({
          svgMarkup: outer.outerHTML,
          width: data?.box.width,
          height: data?.box.height
        })
        assetByBackendId.set(backendId, { assetId: asset.id, kind: 'svg' })
      } catch (err) {
        log.debug('failed to capture inline svg', { backendId, message: (err as Error).message })
      }
    }),
    ...[...imgNodes.entries()].map(async ([backendId, node]) => {
      const src = getAttr(node, 'src')
      if (!src) return
      try {
        const absoluteUrl = new URL(src, baseURL).href
        const fetched = await fetchAssetBytes(absoluteUrl)
        if (!fetched) return
        const data = dataByBackendId.get(backendId)

        // <img src="x.svg"> — SVG, загруженный как обычная картинка, не inline —
        // figma.createImage() принимает только PNG/JPEG/GIF и упадёт на SVG-байтах,
        // поэтому такой случай идёт по SVG-пути (текст), а не raster.
        if (fetched.mimeType === 'image/svg+xml') {
          const asset = collector.addSvg({
            svgMarkup: fetched.bytes.toString('utf-8'),
            sourceUrl: absoluteUrl,
            width: data?.box.width,
            height: data?.box.height
          })
          assetByBackendId.set(backendId, { assetId: asset.id, kind: 'svg' })
          return
        }
        if (!SUPPORTED_RASTER_MIME.has(fetched.mimeType)) {
          log.debug('skipping unsupported image mime type for figma.createImage', { backendId, mimeType: fetched.mimeType })
          return
        }

        const asset = collector.addRaster({
          kind: 'raster',
          sourceUrl: absoluteUrl,
          mimeType: fetched.mimeType,
          bytes: fetched.bytes,
          width: data?.box.width,
          height: data?.box.height
        })
        assetByBackendId.set(backendId, { assetId: asset.id, kind: 'raster' })
      } catch (err) {
        log.debug('failed to fetch img asset', { backendId, src, message: (err as Error).message })
      }
    })
  ])

  const rootData = dataByBackendId.get(rootBackendNodeId)
  if (!rootData) throw new Error('Selected element has no box model (not rendered)')

  const tree = buildNode(described.node, rootData, null, undefined, dataByBackendId, assetByBackendId)
  if (!tree) throw new Error('Failed to build snapshot tree for selected element')
  return { tree, truncated, assets: collector.manifest() }
}

function boxOrigin(model: BoxModelResult['model']): { x: number; y: number } {
  return { x: model.border[0] ?? 0, y: model.border[1] ?? 0 }
}

function buildNode(
  cdpNode: CdpNode,
  data: FetchedNodeData,
  parentOrigin: { x: number; y: number } | null,
  pseudoType: 'before' | 'after' | undefined,
  dataByBackendId: Map<number, FetchedNodeData>,
  assetByBackendId: Map<number, { assetId: string; kind: 'raster' | 'svg' }>
): DomSnapshotNode | null {
  if (pseudoType && isEmptyPseudo(data)) return null

  const nodeOrigin = boxOrigin(data.box)
  const rel = parentOrigin ? { x: nodeOrigin.x - parentOrigin.x, y: nodeOrigin.y - parentOrigin.y } : { x: 0, y: 0 }

  const attrs = cdpNode.attributes ?? []
  const attrMap = new Map<string, string>()
  for (let i = 0; i < attrs.length; i += 2) attrMap.set(attrs[i] as string, attrs[i + 1] ?? '')

  const asset = assetByBackendId.get(cdpNode.backendNodeId)
  const directText = asset ? {} : extractTextContent(cdpNode, dataByBackendId)
  const children: DomSnapshotNode[] = []

  // Узел с успешно развёрнутыми textRuns не нуждается в отдельных дочерних
  // DomSnapshotNode для тех же инлайновых тегов — они уже вошли в textRuns
  // как стилизованные диапазоны (convertElement.ts всё равно отбросил бы
  // `children` для текстового листа, но не строить их вообще дешевле и
  // яснее, чем строить и тут же выбрасывать).
  if ((!asset || asset.kind !== 'svg') && !directText.textRuns) {
    // CDP отдаёт pseudoElements в DOM-порядке (::before раньше ::after) — сохраняем как есть.
    for (const pseudo of cdpNode.pseudoElements ?? []) {
      const pseudoData = dataByBackendId.get(pseudo.backendNodeId)
      if (!pseudoData) continue
      const converted = buildNode(pseudo, pseudoData, nodeOrigin, pseudo.nodeName === '::after' ? 'after' : 'before', dataByBackendId, assetByBackendId)
      if (converted) children.push(converted)
    }

    for (const child of cdpNode.children ?? []) {
      if (child.nodeType !== ELEMENT_NODE || SKIP_TAGS.has(child.nodeName)) continue
      const childData = dataByBackendId.get(child.backendNodeId)
      if (!childData) continue
      const converted = buildNode(child, childData, nodeOrigin, undefined, dataByBackendId, assetByBackendId)
      if (converted) children.push(converted)
    }
  }

  return {
    tag: pseudoType ? `::${pseudoType}` : cdpNode.nodeName.toLowerCase(),
    id: attrMap.get('id') || null,
    classes: (attrMap.get('class') ?? '').split(/\s+/).filter(Boolean),
    computedStyle: data.style,
    authoredSizing: data.authoredSizing,
    box: { width: data.box.width, height: data.box.height, x: Math.round(rel.x), y: Math.round(rel.y) },
    ...(children.length > 0 ? { children } : {}),
    ...(pseudoType ? { pseudoType } : {}),
    ...(asset ? { asset } : {}),
    ...directText
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
