import { nanoid } from 'nanoid'
import type { ConversionWarning, CornerRadius, DesignNode, LayoutInfo, Paint, StrokeInfo, TypographyInfo } from '@web-to-figma/design-ast'
import { isTransparent, parseColor } from './color.js'
import { parseLength } from './length.js'
import { parseBoxShadow } from './shadow.js'
import { parseLayout } from './layout.js'
import type { DomSnapshotNode } from './domSnapshot.js'

/**
 * DOM-снапшот (с детьми, Phase 8) → дерево DesignNode. Чистая функция — не
 * трогает CDP/Electron, тестируется в изоляции.
 */
export function convertElement(snapshot: DomSnapshotNode): { node: DesignNode; diagnostics: ConversionWarning[] } {
  const diagnostics: ConversionWarning[] = []
  const node = convertNode(snapshot, diagnostics, null)
  return { node, diagnostics }
}

/**
 * `parentLayoutMode: null` — это корень (нет родителя, positioning не имеет
 * смысла). Иначе — режим родителя решает, остаётся ли ребёнок в обычном
 * flow (Auto Layout родителя сам разложит) или получает явные координаты:
 * CSS `position:absolute/fixed` — всегда; а если у родителя вообще нет
 * Auto Layout (`mode:'none'`, обычный block-flow) — тоже, это осознанный
 * fallback по факту захваченных координат, см. docs/conversion-rules.md
 * §block/inline (не пытаемся вывести устойчивый межэлементный margin).
 */
function convertNode(snapshot: DomSnapshotNode, diagnostics: ConversionWarning[], parentLayoutMode: LayoutInfo['mode'] | null): DesignNode {
  const id = nanoid()
  const style = snapshot.computedStyle

  const transform = style['transform']
  if (transform && transform !== 'none') {
    diagnostics.push({
      nodeId: id,
      code: 'transform-not-applied',
      severity: 'info',
      message: `CSS transform (${transform}) обнаружен, но пока не применяется — материализация transform запланирована для более поздней фазы.`
    })
  }

  const bg = parseColor(style['background-color'] ?? 'rgba(0, 0, 0, 0)')
  const fills: Paint[] | undefined = isTransparent(bg) ? undefined : [{ type: 'solid', color: bg }]
  const effects = parseBoxShadow(style['box-shadow'] ?? 'none')
  const opacity = parseLength(style['opacity'], 1)
  const strokes = parseBorder(style)
  const cornerRadius = parseCornerRadius(style)
  const layout = resolvePositioning(parseLayout(style, id, diagnostics), snapshot, style, parentLayoutMode, id, diagnostics)

  const children = snapshot.children?.map((child) => convertNode(child, diagnostics, layout.mode))

  const node: DesignNode = {
    id,
    type: snapshot.asset ? (snapshot.asset.kind === 'svg' ? 'vector' : 'image') : 'frame',
    name: buildName(snapshot),
    size: { width: Math.round(snapshot.box.width), height: Math.round(snapshot.box.height) },
    layout,
    typography: parseTypography(style),
    ...(snapshot.asset ? { asset: { assetId: snapshot.asset.assetId } } : {}),
    ...(fills ? { fills } : {}),
    ...(strokes ? { strokes } : {}),
    ...(effects.length > 0 ? { effects } : {}),
    ...(cornerRadius !== undefined ? { cornerRadius } : {}),
    ...(opacity < 1 ? { opacity } : {}),
    ...(children && children.length > 0 ? { children } : {}),
    source: {
      tag: snapshot.tag,
      ...(snapshot.id ? { id: snapshot.id } : {}),
      ...(snapshot.classes.length > 0 ? { classes: snapshot.classes } : {}),
      cssSelector: buildSelector(snapshot)
    }
  }

  return node
}

function resolvePositioning(
  layout: LayoutInfo,
  snapshot: DomSnapshotNode,
  style: Record<string, string>,
  parentLayoutMode: LayoutInfo['mode'] | null,
  nodeId: string,
  diagnostics: ConversionWarning[]
): LayoutInfo {
  if (parentLayoutMode === null) return layout // корень — позиционирование относительно родителя не имеет смысла

  const cssPosition = style['position']
  const absoluteCoords = { x: Math.round(snapshot.box.x), y: Math.round(snapshot.box.y) }

  if (cssPosition === 'absolute' || cssPosition === 'fixed') {
    return { ...layout, positioning: 'absolute', absolute: absoluteCoords }
  }
  if (parentLayoutMode === 'none') {
    diagnostics.push({
      nodeId,
      code: 'block-layout-approximated',
      severity: 'info',
      message: 'Родитель не Flex-контейнер — узел размещён по факту захваченных координат, не через Auto Layout.'
    })
    return { ...layout, positioning: 'absolute', absolute: absoluteCoords }
  }
  return layout // родитель — Auto Layout, ребёнок в обычном flow остаётся positioning:'auto'
}

function buildName(snapshot: DomSnapshotNode): string {
  if (snapshot.id) return snapshot.id
  if (snapshot.classes.length > 0) return snapshot.classes[0] as string
  return snapshot.tag.toUpperCase()
}

function buildSelector(snapshot: DomSnapshotNode): string {
  const idPart = snapshot.id ? `#${snapshot.id}` : ''
  const classPart = snapshot.classes.map((c) => `.${c}`).join('')
  return `${snapshot.tag}${idPart}${classPart}`
}

function parseBorder(style: Record<string, string>): StrokeInfo | undefined {
  const width = parseLength(style['border-top-width'])
  const borderStyle = style['border-top-style'] ?? 'none'
  if (width <= 0 || borderStyle === 'none') return undefined
  return {
    paints: [{ type: 'solid', color: parseColor(style['border-top-color'] ?? 'rgb(0, 0, 0)') }],
    weight: width
  }
}

function parseCornerRadius(style: Record<string, string>): number | CornerRadius | undefined {
  const tl = parseLength(style['border-top-left-radius'])
  const tr = parseLength(style['border-top-right-radius'])
  const br = parseLength(style['border-bottom-right-radius'])
  const bl = parseLength(style['border-bottom-left-radius'])
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) return undefined
  if (tl === tr && tr === br && br === bl) return tl
  return { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl }
}

function parseTypography(style: Record<string, string>): TypographyInfo {
  const fontFamily =
    (style['font-family'] ?? 'sans-serif')
      .split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '') ?? 'sans-serif'
  const lineHeightRaw = style['line-height'] ?? 'normal'
  const letterSpacingRaw = style['letter-spacing'] ?? 'normal'

  return {
    fontFamily,
    fontSize: parseLength(style['font-size'], 16),
    fontWeight: parseLength(style['font-weight'], 400),
    lineHeight: lineHeightRaw === 'normal' ? 'normal' : parseLength(lineHeightRaw),
    ...(letterSpacingRaw === 'normal' ? {} : { letterSpacing: parseLength(letterSpacingRaw) }),
    textAlign: mapTextAlign(style['text-align']),
    textCase: mapTextCase(style['text-transform']),
    textDecoration: mapTextDecoration(style['text-decoration-line'] ?? style['text-decoration'])
  }
}

function mapTextAlign(raw: string | undefined): TypographyInfo['textAlign'] {
  switch (raw) {
    case 'end':
      return 'right'
    case 'center':
    case 'right':
    case 'justify':
      return raw
    case 'start':
    default:
      return 'left'
  }
}

function mapTextCase(raw: string | undefined): TypographyInfo['textCase'] {
  switch (raw) {
    case 'uppercase':
      return 'upper'
    case 'lowercase':
      return 'lower'
    case 'capitalize':
      return 'title'
    default:
      return 'none'
  }
}

function mapTextDecoration(raw: string | undefined): TypographyInfo['textDecoration'] {
  if (!raw) return 'none'
  if (raw.includes('line-through')) return 'strikethrough'
  if (raw.includes('underline')) return 'underline'
  return 'none'
}
