import { nanoid } from 'nanoid'
import type { ConversionWarning, CornerRadius, DesignNode, LayoutInfo, Paint, StrokeInfo, TextRun, TypographyInfo } from '@web-to-figma/design-ast'
import { isTransparent, parseColor } from './color.js'
import { parseLength } from './length.js'
import { parseBoxShadow } from './shadow.js'
import { parseLayout } from './layout.js'
import type { DomSnapshotNode } from './domSnapshot.js'
import { detectComponentGroups } from './componentGroups.js'
import { pickSemanticClass } from './classHeuristics.js'

/**
 * DOM-снапшот (с детьми, Phase 8) → дерево DesignNode. Чистая функция — не
 * трогает CDP/Electron, тестируется в изоляции.
 */
export function convertElement(snapshot: DomSnapshotNode): { node: DesignNode; diagnostics: ConversionWarning[] } {
  const diagnostics: ConversionWarning[] = []
  const node = convertNode(snapshot, diagnostics, null)
  return { node, diagnostics }
}

/** Часть родительского `LayoutInfo`, нужная ребёнку для решений о позиции
 *  (`mode`) и о fill-sizing (`align`, см. `resolveSizing`) — не весь объект,
 *  чтобы не тащить gap/padding/justify, которые ребёнку не нужны. */
interface ParentContext {
  mode: LayoutInfo['mode']
  align: LayoutInfo['align']
}

/**
 * `parentContext: null` — это корень (нет родителя, positioning/sizing
 * относительно родителя не имеют смысла). Иначе — режим родителя решает,
 * остаётся ли ребёнок в обычном flow (Auto Layout родителя сам разложит)
 * или получает явные координаты: CSS `position:absolute/fixed` — всегда; а
 * если у родителя вообще нет Auto Layout (`mode:'none'`, обычный
 * block-flow) — тоже, это осознанный fallback по факту захваченных
 * координат, см. docs/conversion-rules.md §block/inline (не пытаемся
 * вывести устойчивый межэлементный margin).
 */
function convertNode(snapshot: DomSnapshotNode, diagnostics: ConversionWarning[], parentContext: ParentContext | null): DesignNode {
  const id = nanoid()
  const style = snapshot.computedStyle

  // Текстовый лист — snapshot.text (чистый текст без вложенных элементов) ИЛИ
  // snapshot.textRuns (смешанный контент, успешно развёрнутый в стилизованные
  // диапазоны, см. domSnapshot.ts extractTextContent) — оба обходят asset
  // ТОЛЬКО когда asset не задан — приоритет image/vector сохраняется, если
  // оба сигнала пришли.
  const hasPlainText = !snapshot.asset && snapshot.text !== undefined
  const hasTextRuns = !snapshot.asset && snapshot.textRuns !== undefined && snapshot.textRuns.length > 0
  const isTextLeaf = hasPlainText || hasTextRuns
  const type = snapshot.asset ? (snapshot.asset.kind === 'svg' ? 'vector' : 'image') : isTextLeaf ? 'text' : 'frame'

  // Для текстового узла Figma-поле `fills` — это цвет ГЛИФОВ (CSS `color`),
  // а не заливка фона, в отличие от фрейма (см. docs/design-ast.md). Если у
  // текстового листа при этом задан непрозрачный background-color, он молча
  // потерялся бы (TextNode фона не имеет) — явный diagnostic вместо тишины.
  const textColor = parseColor(style['color'] ?? 'rgb(0, 0, 0)')
  const bg = parseColor(style['background-color'] ?? 'rgba(0, 0, 0, 0)')
  const bgIsOpaque = !isTransparent(bg)
  const fills: Paint[] | undefined = isTextLeaf
    ? [{ type: 'solid', color: textColor }]
    : bgIsOpaque
      ? [{ type: 'solid', color: bg }]
      : undefined
  if (isTextLeaf && bgIsOpaque) {
    diagnostics.push({
      nodeId: id,
      code: 'text-background-dropped',
      severity: 'info',
      message: 'У текстового узла был непрозрачный background-color — у Figma TextNode нет фона, цвет отброшен (оберните в родительский frame, если фон важен).'
    })
  }
  if (snapshot.droppedInlineText) {
    diagnostics.push({
      nodeId: id,
      code: 'mixed-inline-text-not-captured',
      severity: 'warning',
      message: 'Текст вперемешку с вложенными тегами (напр. "текст <b>жирный</b> ещё текст") — захвачены только вложенные элементы, "голый" текст между ними потерян (стилизованные диапазоны внутри одного текстового узла пока не поддержаны).'
    })
  }

  const effects = parseBoxShadow(style['box-shadow'] ?? 'none')
  const opacity = parseLength(style['opacity'], 1)
  const strokes = parseBorder(style)
  const cornerRadius = parseCornerRadius(style)
  const clipsContent = isTextLeaf ? false : parseClipsContent(style)
  const layout = resolveSizing(
    resolvePositioning(parseLayout(style, id, diagnostics), snapshot, style, parentContext?.mode ?? null, id, diagnostics),
    style,
    parentContext,
    snapshot.authoredSizing
  )

  // Чистый translate() на абсолютно спозиционированном узле НЕ нуждается в
  // отдельном diagnostic: box-модель (CDP DOM.getBoxModel), из которой мы
  // берём layout.absolute.x/y, уже отражает СМЕЩЁННЫЕ transform'ом экранные
  // координаты (проверено вживую — см. architecture.md находку про
  // ::before/::after со "стопкой бумаг" transform:translate()). Для узлов в
  // обычном flow (Auto Layout родителя решает позицию сам, наши x/y не
  // используются) и для rotate/scale/skew — по-прежнему честный warning,
  // т.к. они реально не применяются к результирующей Figma-ноде.
  const transform = style['transform']
  if (transform && transform !== 'none' && !(layout.positioning === 'absolute' && isPureTranslate(transform))) {
    diagnostics.push({
      nodeId: id,
      code: 'transform-not-applied',
      severity: 'info',
      message: `CSS transform (${transform}) обнаружен, но пока не применяется — материализация transform запланирована для более поздней фазы.`
    })
  }

  // Component recognition — группировка СРЕДИ ДЕТЕЙ ЭТОГО УЗЛА, до их
  // конвертации (см. componentGroups.ts): структурно идентичные соседи
  // (карточки/строки/элементы сетки) размечаются componentRef'ом, который
  // рендерер (apps/figma-plugin) превращает в Figma-компонент + инстансы
  // вместо N одинаковых фреймов. Вызывается на КАЖДОМ уровне рекурсии —
  // вложенные повторы (напр. ряд иконок внутри каждой карточки) находятся
  // автоматически, без отдельной логики.
  const componentGroups = !isTextLeaf && snapshot.children ? detectComponentGroups(snapshot.children) : undefined
  const children = isTextLeaf
    ? undefined
    : snapshot.children?.map((child, i) => {
        const node = convertNode(child, diagnostics, { mode: layout.mode, align: layout.align })
        const componentRef = componentGroups?.get(i)
        return componentRef ? { ...node, componentRef } : node
      })

  // Каждый прогон парсится ТЕМИ ЖЕ функциями, что и typography/цвет узла
  // целиком (parseTypography/parseColor) — единая точка разбора CSS→AST,
  // просто применённая к computed style конкретного инлайн-элемента вместо
  // computed style контейнера.
  const textRuns: TextRun[] | undefined = hasTextRuns
    ? snapshot.textRuns!.map((run) => ({
        text: run.text,
        typography: parseTypography(run.style),
        color: parseColor(run.style['color'] ?? 'rgb(0, 0, 0)')
      }))
    : undefined

  const node: DesignNode = {
    id,
    type,
    name: buildName(snapshot),
    size: { width: Math.round(snapshot.box.width), height: Math.round(snapshot.box.height) },
    layout,
    typography: parseTypography(style),
    ...(snapshot.asset ? { asset: { assetId: snapshot.asset.assetId } } : {}),
    ...(hasPlainText ? { text: snapshot.text } : {}),
    ...(textRuns ? { textRuns } : {}),
    ...(fills ? { fills } : {}),
    ...(strokes ? { strokes } : {}),
    ...(effects.length > 0 ? { effects } : {}),
    ...(cornerRadius !== undefined ? { cornerRadius } : {}),
    ...(opacity < 1 ? { opacity } : {}),
    ...(clipsContent ? { clipsContent } : {}),
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

/**
 * Fill/hug-sizing (Figma `layoutSizingHorizontal`/`Vertical`) для детей
 * Auto-Layout родителя.
 *
 * Fill вычисляется из сигналов, которые ДОСТОВЕРНЫ уже на computed-уровне:
 *  - главная ось (совпадает с `flex-direction` родителя): computed
 *    `flex-grow` > 0 → fill (`flex-grow` всегда резолвится в конкретное
 *    число, авторство тут не важно — 0 и "not set" неотличимы, и это ок,
 *    оба означают "не расти").
 *  - поперечная ось: computed `align-self` (если не `auto`/`normal`) или,
 *    иначе, `align-items` родителя (уже смаплено в layout.align, дефолт CSS
 *    — 'stretch', см. `layout.ts` mapAlignItems) — `'stretch'` → fill, это
 *    ровно то поведение браузера по умолчанию, что и создаёт эффект
 *    "текст не ужимается уже своей ширины, а тянется на всю ширину
 *    родителя" (см. п.21 находка "не autolayout" в architecture.md).
 *
 * Hug — раньше был сознательно НЕ реализован (см. git-историю этого
 * комментария): отличить "ширина не задана явно, должна hug-аться по
 * контенту" от "ширина задана как `100%`/blocklevel-дефолт" требует
 * АВТОРСКОГО значения CSS-свойства (что реально написано в правиле), а не
 * computed (которое ВСЕГДА резолвится в px и не говорит, было ли это
 * explicit или auto). Теперь этот сигнал доступен — `authoredSizing`
 * (заполняется в apps/desktop/src/main/domSnapshot.ts через
 * `CSS.getMatchedStylesForNode`, см. докстринг там же): если по оси НЕТ
 * fill И свойство `width`/`height` НЕ было явно задано ни одним правилом
 * автора страницы — узел hug-ается по контенту. `authoredSizing` может
 * отсутствовать (не все вызывающие стороны его собирают, напр. тесты) —
 * тогда ось остаётся 'fixed', как раньше (безопасный дефолт, не HUG наугад).
 */
function resolveSizing(
  layout: LayoutInfo,
  style: Record<string, string>,
  parentContext: ParentContext | null,
  authoredSizing: DomSnapshotNode['authoredSizing']
): LayoutInfo {
  if (!parentContext || (parentContext.mode !== 'horizontal' && parentContext.mode !== 'vertical')) return layout

  const mainAxisFill = parseLength(style['flex-grow'], 0) > 0

  const alignSelf = style['align-self']
  const crossAxisFill = alignSelf && alignSelf !== 'auto' && alignSelf !== 'normal' ? alignSelf === 'stretch' : parentContext.align === 'stretch'

  const [widthFill, heightFill] = parentContext.mode === 'horizontal' ? [mainAxisFill, crossAxisFill] : [crossAxisFill, mainAxisFill]

  const widthHug = !widthFill && authoredSizing?.width === false
  const heightHug = !heightFill && authoredSizing?.height === false

  return {
    ...layout,
    widthSizing: widthFill ? 'fill' : widthHug ? 'hug' : layout.widthSizing,
    heightSizing: heightFill ? 'fill' : heightHug ? 'hug' : layout.heightSizing
  }
}

/** Максимальная длина имени фрейма из текстового содержимого — Figma не
 *  ограничивает длину имени технически, но "Nam name name name..." на всю
 *  ширину сайдбара слоёв бесполезен; обрезаем с многоточием, как обычно
 *  делают сами дизайн-тулы. */
const MAX_TEXT_NAME_LENGTH = 60

function truncateName(text: string): string {
  return text.length > MAX_TEXT_NAME_LENGTH ? `${text.slice(0, MAX_TEXT_NAME_LENGTH - 1).trimEnd()}…` : text
}

/**
 * Имя фрейма/ноды при импорте — по запросу пользователя: текстовые узлы
 * называются по своему содержимому (сразу видно, что это за текст, в
 * сайдбаре слоёв Figma), остальные — по осмысленному CSS-классу, если такой
 * есть, иначе как раньше (id → первый класс → тег). id остаётся высшим
 * приоритетом для НЕ-текстовых узлов: он уникален и осознанно проставлен
 * автором страницы, семантичнее любого класса.
 */
function buildName(snapshot: DomSnapshotNode): string {
  const isTextLeaf = !snapshot.asset && (snapshot.text !== undefined || (snapshot.textRuns?.length ?? 0) > 0)
  if (isTextLeaf) {
    const raw = snapshot.text ?? (snapshot.textRuns ?? []).map((r) => r.text).join('')
    const cleaned = raw.replace(/\s+/g, ' ').trim()
    if (cleaned) return truncateName(cleaned)
  }
  if (snapshot.id) return snapshot.id
  const semanticClass = pickSemanticClass(snapshot.classes)
  if (semanticClass) return semanticClass
  if (snapshot.classes.length > 0) return snapshot.classes[0] as string
  return snapshot.tag.toUpperCase()
}

function buildSelector(snapshot: DomSnapshotNode): string {
  const idPart = snapshot.id ? `#${snapshot.id}` : ''
  const classPart = snapshot.classes.map((c) => `.${c}`).join('')
  return `${snapshot.tag}${idPart}${classPart}`
}

/**
 * CSS default для `overflow`/`overflow-x`/`overflow-y` — 'visible' (не
 * обрезает). Любое другое значение (`hidden`/`clip`/`scroll`/`auto`) в
 * реальных браузерах визуально обрезает содержимое, выходящее за границы
 * padding-box — грубое приближение (auto/scroll не обрезают ДО overflow,
 * только после, но для статического снапшота разница не наблюдаема),
 * зато честнее, чем всегда доверять дефолту Figma API для новых фреймов.
 * Заметно на практике: декоративные ::before/::after со смещением через
 * transform (см. п.21 находка "double border" в architecture.md) либо
 * утекают за край там, где сайт их обрезает, либо наоборот обрезаются там,
 * где сайт даёт им "вытечь" — без чтения overflow оба случая расходятся.
 */
/** Computed `transform` — всегда `matrix(a, b, c, d, tx, ty)` (браузер
 *  нормализует любой transform-синтаксис в матрицу). Чистый translate —
 *  единичная a/d, нулевые b/c, произвольные tx/ty. Малый epsilon —
 *  подстраховка от float-погрешности вычисления матрицы браузером. */
function isPureTranslate(transform: string): boolean {
  const match = transform.match(/^matrix\(([^)]+)\)$/)
  if (!match) return false
  const parts = (match[1] ?? '').split(',').map((p) => parseFloat(p.trim()))
  if (parts.length !== 6 || parts.some((p) => Number.isNaN(p))) return false
  const [a, b, c, d] = parts
  const EPSILON = 0.001
  return Math.abs((a ?? 0) - 1) < EPSILON && Math.abs(b ?? 0) < EPSILON && Math.abs(c ?? 0) < EPSILON && Math.abs((d ?? 0) - 1) < EPSILON
}

function parseClipsContent(style: Record<string, string>): boolean {
  const x = style['overflow-x'] ?? style['overflow'] ?? 'visible'
  const y = style['overflow-y'] ?? style['overflow'] ?? 'visible'
  return x !== 'visible' || y !== 'visible'
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
