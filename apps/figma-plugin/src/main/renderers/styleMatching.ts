/// <reference types="@figma/plugin-typings" />
import type { Color } from '@web-to-figma/design-ast'

/**
 * "Стили проекта" (п.21/28 ТЗ, отложено до явного запроса пользователя):
 * при импорте вместо "голых" значений (raw fontSize/fontName/fills) —
 * подобрать ближайший уже существующий в целевом Figma-файле text style/
 * paint style/color variable и привязать к нему созданный узел
 * (`setTextStyleIdAsync`/`fillStyleId`/`setBoundVariableForPaint`), а не
 * задавать значение напрямую. "Ближайший" — для текста по fontSize И весу
 * (см. `matchNearestTextStyle`), для цвета — по евклидову расстоянию в RGBA
 * (нет другого разумного способа сравнить произвольные цвета). Если
 * подходящих локальных стилей/переменных нет вообще (пустой файл/новый
 * документ) — `match*` возвращают `null`, вызывающая сторона обязана
 * откатиться на raw-значения, а не бросать — это ДОПОЛНИТЕЛЬНЫЙ режим
 * импорта, а не замена.
 */

/** Цвет можно матчить на Paint Style (легаси) или на Variable (Figma
 *  Variables, современный способ токенов) — пользователь явно попросил
 *  выбор, не одно из двух зашитым. */
export type ColorMatchSource = 'style' | 'variable'

export interface ColorVariableCandidate {
  variable: Variable
  /** Резолвится на defaultModeId коллекции переменной — без привязки к
   *  конкретному consumer-узлу (см. Variable.resolveForConsumer) заранее
   *  неизвестно, какой режим у будущего узла, поэтому берём дефолтный. */
  color: Color
}

export interface StyleCatalog {
  textStyles: TextStyle[]
  /** Только сплошные (SOLID) стили — градиентные/image paint style с одним
   *  числом-цветом сравнивать бессмысленно, поэтому исключены из подбора. */
  solidPaintStyles: PaintStyle[]
  /** Только переменные с прямым RGBA-значением на дефолтном режиме — алиасы
   *  (переменная ссылается на другую переменную) пропущены: разрешение цепочки
   *  алиасов не нужно для подбора "ближайшего", усложняет без явной пользы. */
  colorVariables: ColorVariableCandidate[]
}

/**
 * Раздельные переключатели для шрифтов и цветов (пользователь явно попросил
 * не объединять в один общий "стили проекта") — `catalog` грузится, если
 * ХОТЯ БЫ один из двух включён, но каждый узел проверяет СВОЙ флаг перед
 * тем, как пробовать матчинг конкретно для текста/цвета.
 */
export interface StyleMatchOptions {
  catalog: StyleCatalog | null
  matchText: boolean
  matchColor: boolean
  colorMatchSource: ColorMatchSource
}

export const NO_STYLE_MATCHING: StyleMatchOptions = {
  catalog: null,
  matchText: false,
  matchColor: false,
  colorMatchSource: 'style'
}

export async function loadStyleCatalog(opts: {
  matchText: boolean
  matchColor: boolean
  colorMatchSource: ColorMatchSource
}): Promise<StyleCatalog> {
  const [textStyles, paintStyles, colorVariables] = await Promise.all([
    opts.matchText ? figma.getLocalTextStylesAsync() : Promise.resolve([]),
    opts.matchColor && opts.colorMatchSource === 'style' ? figma.getLocalPaintStylesAsync() : Promise.resolve([]),
    // Variables API может бросить (напр. недоступна на текущем плане файла) —
    // не роняем весь импорт из-за этого, откатываемся на пустой список
    // (см. warnIfCatalogEmpty в designNode.ts — пользователь всё равно увидит
    // тост, что кандидатов нет, независимо от того, пустой список или ошибка).
    opts.matchColor && opts.colorMatchSource === 'variable'
      ? loadColorVariables().catch((err) => {
          console.error('loadColorVariables failed', err)
          return []
        })
      : Promise.resolve([])
  ])
  return {
    textStyles,
    solidPaintStyles: paintStyles.filter((s) => s.paints.length === 1 && s.paints[0]!.type === 'SOLID'),
    colorVariables
  }
}

async function loadColorVariables(): Promise<ColorVariableCandidate[]> {
  const variables = await figma.variables.getLocalVariablesAsync('COLOR')
  const collectionIds = [...new Set(variables.map((variable) => variable.variableCollectionId))]
  const collections = await Promise.all(collectionIds.map((id) => figma.variables.getVariableCollectionByIdAsync(id)))
  const collectionCache = new Map(collectionIds.map((id, index) => [id, collections[index] ?? null]))
  const candidates: ColorVariableCandidate[] = []
  for (const variable of variables) {
    const collection = collectionCache.get(variable.variableCollectionId)
    if (!collection) continue
    const value = variable.valuesByMode[collection.defaultModeId]
    // Пропускаем алиасы (VariableAlias) и не-RGBA значения — только прямой цвет.
    if (!value || typeof value !== 'object' || !('r' in value) || !('g' in value) || !('b' in value)) continue
    candidates.push({
      variable,
      color: { r: value.r, g: value.g, b: value.b, a: 'a' in value ? value.a : 1 }
    })
  }
  return candidates
}

/** Общепринятые имена начертаний под CSS font-weight — используется и для
 *  подбора РЕАЛЬНОГО шрифта с нуля (createTextNode, raw-путь), и здесь для
 *  матчинга text style ПО ВЕСУ (см. matchNearestTextStyle). */
export function weightToStyle(weight: number): string {
  if (weight >= 800) return 'Black'
  if (weight >= 700) return 'Bold'
  if (weight >= 600) return 'SemiBold'
  if (weight >= 500) return 'Medium'
  if (weight <= 300) return 'Light'
  return 'Regular'
}

/**
 * Раньше матчил ТОЛЬКО по fontSize — на реальном контенте (карточка с
 * заголовком+телом) ближайший ПО РАЗМЕРУ style мог оказаться совсем другого
 * начертания (напр. жирный заголовок мог попасть на style с обычным весом,
 * если тот просто ближе по кеглю) — пользователь поймал это как "не
 * воспринимает веса моих стилей". Вес теперь ДОМИНИРУЕТ подбор (большой
 * штраф за несовпадение имени начертания, эвристика та же `weightToStyle`),
 * fontSize только разрешает выбор среди кандидатов ОДНОГО начертания —
 * это не "точное совпадение", а разумный приоритет: лучше style нужного
 * веса чуть другого размера, чем наоборот.
 */
export function matchNearestTextStyle(fontSize: number, weight: number, styles: TextStyle[]): TextStyle | null {
  if (styles.length === 0) return null
  const expected = weightToStyle(weight).toLowerCase()
  const WEIGHT_MISMATCH_PENALTY = 10000
  const score = (s: TextStyle): number => {
    const sizeDiff = Math.abs(s.fontSize - fontSize)
    const weightMatches = s.fontName.style.toLowerCase().includes(expected)
    return sizeDiff + (weightMatches ? 0 : WEIGHT_MISMATCH_PENALTY)
  }
  return styles.reduce((best, s) => (score(s) < score(best) ? s : best))
}

export function matchNearestSolidPaintStyle(color: Color, styles: PaintStyle[]): PaintStyle | null {
  if (styles.length === 0) return null
  const distance = (s: PaintStyle): number => {
    const paint = s.paints[0] as SolidPaint
    const dr = paint.color.r - color.r
    const dg = paint.color.g - color.g
    const db = paint.color.b - color.b
    const da = (paint.opacity ?? 1) - color.a
    return dr * dr + dg * dg + db * db + da * da
  }
  return styles.reduce((best, s) => (distance(s) < distance(best) ? s : best))
}

export function matchNearestColorVariable(color: Color, candidates: ColorVariableCandidate[]): Variable | null {
  if (candidates.length === 0) return null
  const distance = (c: ColorVariableCandidate): number => {
    const dr = c.color.r - color.r
    const dg = c.color.g - color.g
    const db = c.color.b - color.b
    const da = c.color.a - color.a
    return dr * dr + dg * dg + db * db + da * da
  }
  return candidates.reduce((best, c) => (distance(c) < distance(best) ? c : best)).variable
}

export type ColorMatchResult = { kind: 'style'; styleId: string } | { kind: 'variable'; paint: SolidPaint } | null

/**
 * Единая точка входа для цветового матчинга — скрывает разницу между "Paint
 * Style" (fillStyleId, готовый Figma-концепт) и "Variable" (нужно сначала
 * собрать raw SolidPaint и привязать к нему переменную через
 * `setBoundVariableForPaint`, сам объект переменной не является Paint'ом).
 * Вызывающая сторона (designNode.ts/textNode.ts) просто применяет то, что
 * вернулось, не зная деталей API для каждого источника.
 */
export function matchColor(color: Color, catalog: StyleCatalog, source: ColorMatchSource): ColorMatchResult {
  if (source === 'style') {
    const style = matchNearestSolidPaintStyle(color, catalog.solidPaintStyles)
    return style ? { kind: 'style', styleId: style.id } : null
  }
  const variable = matchNearestColorVariable(color, catalog.colorVariables)
  if (!variable) return null
  const rawPaint: SolidPaint = { type: 'SOLID', color: { r: color.r, g: color.g, b: color.b }, opacity: color.a }
  return { kind: 'variable', paint: figma.variables.setBoundVariableForPaint(rawPaint, 'color', variable) }
}
