/// <reference types="@figma/plugin-typings" />
import type { Color } from '@web-to-figma/design-ast'

/**
 * "Стили проекта" (п.21/28 ТЗ, отложено до явного запроса пользователя):
 * при импорте вместо "голых" значений (raw fontSize/fontName/fills) —
 * подобрать ближайший уже существующий в целевом Figma-файле text/paint
 * style и привязать к нему созданный узел (`setTextStyleIdAsync`/
 * `fillStyleId`), а не задавать значение напрямую. "Ближайший" — для текста
 * по fontSize (единственная ось, которую предложил пользователь: "в кегле
 * шрифтов анализировало по кеглю"), для цвета — по евклидову расстоянию в
 * RGBA (нет другого разумного способа сравнить произвольные цвета). Если
 * подходящих локальных стилей нет вообще (пустой файл/новый документ) —
 * `match*` возвращают `null`, вызывающая сторона обязана откатиться на raw-
 * значения, а не бросать — это ДОПОЛНИТЕЛЬНЫЙ режим импорта, а не замена.
 */

export interface StyleCatalog {
  textStyles: TextStyle[]
  /** Только сплошные (SOLID) стили — градиентные/image paint style с одним
   *  числом-цветом сравнивать бессмысленно, поэтому исключены из подбора. */
  solidPaintStyles: PaintStyle[]
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
}

export const NO_STYLE_MATCHING: StyleMatchOptions = { catalog: null, matchText: false, matchColor: false }

export async function loadStyleCatalog(): Promise<StyleCatalog> {
  const [textStyles, paintStyles] = await Promise.all([figma.getLocalTextStylesAsync(), figma.getLocalPaintStylesAsync()])
  return {
    textStyles,
    solidPaintStyles: paintStyles.filter((s) => s.paints.length === 1 && s.paints[0]!.type === 'SOLID')
  }
}

export function matchNearestTextStyle(fontSize: number, styles: TextStyle[]): TextStyle | null {
  if (styles.length === 0) return null
  return styles.reduce((best, s) => (Math.abs(s.fontSize - fontSize) < Math.abs(best.fontSize - fontSize) ? s : best))
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
