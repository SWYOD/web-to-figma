/// <reference types="@figma/plugin-typings" />
import type { DesignNode, TypographyInfo } from '@web-to-figma/design-ast'
import { toFigmaPaints } from './paint'
import { toTextAlign, toTextCase, toTextDecoration } from './typography'
import { matchColor, matchNearestTextStyle, NO_STYLE_MATCHING, weightToStyle, type StyleMatchOptions } from './styleMatching'

/** Гарантированно доступен в любом Figma-файле — безопасный откат, если
 *  запрошенный шрифт/начертание не установлены (см. createTextNode). */
const FALLBACK_FONT: FontName = { family: 'Inter', style: 'Regular' }

export interface CreateTextNodeResult {
  textNode: TextNode
  /** true — запрошенный шрифт сайта не нашёлся в Figma, применён Inter Regular. */
  fontFallback: boolean
}

/**
 * DesignNode (`type:'text'`) → реальный `TextNode` с содержимым — не только
 * пустой прямоугольник. Подбор конкретного НАЧЕРТАНИЯ под CSS font-weight
 * (`weightToStyle`) — эвристика по общепринятым именам стилей ("Bold",
 * "SemiBold", ...), которая может не совпасть с тем, что реально установлено
 * в Figma для данного семейства; в этом случае `loadFontAsync` бросает —
 * откатываемся на Inter Regular с diagnostic, а не роняем весь импорт узла
 * (см. docs/architecture.md — то же решение, что и в Apply to Selection,
 * только там применяется поверх УЖЕ загруженного шрифта существующего слоя,
 * здесь шрифт нужно выбрать с нуля для НОВОГО узла).
 */
export async function createTextNode(node: DesignNode, styleMatch: StyleMatchOptions = NO_STYLE_MATCHING): Promise<CreateTextNodeResult> {
  if (node.textRuns && node.textRuns.length > 0) {
    return createMixedTextNode(node)
  }

  const typography = node.typography
  const requested: FontName | null = typography ? { family: typography.fontFamily, style: weightToStyle(typography.fontWeight) } : null

  let font = FALLBACK_FONT
  let fontFallback = false
  if (requested) {
    try {
      await figma.loadFontAsync(requested)
      font = requested
    } catch {
      await figma.loadFontAsync(FALLBACK_FONT)
      fontFallback = true
    }
  } else {
    await figma.loadFontAsync(FALLBACK_FONT)
  }

  const textNode = figma.createText()
  textNode.fontName = font
  textNode.characters = node.text ?? ''
  textNode.name = node.name

  if (typography) {
    textNode.fontSize = typography.fontSize
    textNode.lineHeight =
      typography.lineHeight === 'normal' || typography.lineHeight === undefined
        ? { unit: 'AUTO' }
        : { unit: 'PIXELS', value: typography.lineHeight }
    if (typography.letterSpacing !== undefined) {
      textNode.letterSpacing = { unit: 'PIXELS', value: typography.letterSpacing }
    }
    textNode.textAlignHorizontal = toTextAlign(typography.textAlign)
    textNode.textCase = toTextCase(typography.textCase)
    textNode.textDecoration = toTextDecoration(typography.textDecoration)
  }

  // "Стили проекта" (см. styleMatching.ts) — необязательный второй проход
  // ПОВЕРХ уже применённых raw-свойств выше, раздельно для шрифта и цвета:
  // если для fontSize/цвета нашёлся достаточно близкий локальный style —
  // привязываем узел к нему (`setTextStyleIdAsync`/`fillStyleId`), иначе
  // тихо остаёмся на raw.
  if (styleMatch.matchText && styleMatch.catalog && typography) {
    const textStyle = matchNearestTextStyle(typography.fontSize, typography.fontWeight, styleMatch.catalog.textStyles)
    if (textStyle) {
      try {
        await textNode.setTextStyleIdAsync(textStyle.id)
      } catch {
        // Стиль ссылается на шрифт, который не удалось загрузить — остаёмся на raw fontName/fontSize выше.
      }
    }
  }

  const firstSolidFill = node.fills?.find((p) => p.type === 'solid')
  const matchedColor =
    styleMatch.matchColor && styleMatch.catalog && firstSolidFill
      ? matchColor(firstSolidFill.color, styleMatch.catalog, styleMatch.colorMatchSource)
      : null
  if (matchedColor?.kind === 'style') {
    textNode.fillStyleId = matchedColor.styleId
  } else if (matchedColor?.kind === 'variable') {
    textNode.fills = [matchedColor.paint]
  } else if (node.fills) {
    textNode.fills = toFigmaPaints(node.fills)
  }

  // Фиксированный размер по факту захваченного box, а не auto-resize —
  // тот же принцип, что у фреймов (widthSizing/heightSizing всегда 'fixed'
  // пока conversion-engine не научился hug/fill, см. layout.ts).
  textNode.textAutoResize = 'NONE'
  textNode.resize(Math.max(1, node.size.width), Math.max(1, node.size.height))

  if (node.opacity !== undefined) textNode.opacity = node.opacity
  if (node.rotationDeg !== undefined) textNode.rotation = node.rotationDeg

  return { textNode, fontFallback }
}

/**
 * Смешанный текст (п.3 запроса пользователя — "смешанный текст") — вместо
 * единого `text`+`typography` узел несёт `textRuns`: плоский список
 * стилизованных диапазонов (см. convertElement.ts, каждый прогон уже
 * получил СВОЙ typography/color парсингом computed style соответствующего
 * инлайн-элемента). Здесь просто конкатенируем текст и раскрашиваем
 * диапазоны через `setRange*` — та же логика подбора шрифта/фолбэка, что и
 * в обычном пути выше, применённая на каждый уникальный (family, style) а
 * не один раз на узел.
 *
 * "Стили проекта" (styleMatching) сознательно НЕ применяются к диапазонам в
 * этом срезе — per-range сопоставление с каталогом умножило бы сложность
 * (для каждого прогона отдельное решение, потенциально разные локальные
 * стили внутри одного узла), не оправдано без отдельного запроса
 * пользователя; raw-стили по каждому прогону — уже реальное улучшение
 * по сравнению с полной потерей текста (см. mixed-inline-text-not-captured
 * в conversion-engine — это как раз тот случай, который теперь ловится).
 */
async function createMixedTextNode(node: DesignNode): Promise<CreateTextNodeResult> {
  const runs = node.textRuns!

  const fontCache = new Map<string, FontName>()
  let fontFallback = false
  const resolveFont = async (typography: TypographyInfo): Promise<FontName> => {
    const requested: FontName = { family: typography.fontFamily, style: weightToStyle(typography.fontWeight) }
    const key = `${requested.family}::${requested.style}`
    const cached = fontCache.get(key)
    if (cached) return cached
    try {
      await figma.loadFontAsync(requested)
      fontCache.set(key, requested)
      return requested
    } catch {
      fontFallback = true
      await figma.loadFontAsync(FALLBACK_FONT)
      fontCache.set(key, FALLBACK_FONT)
      return FALLBACK_FONT
    }
  }

  // Все шрифты грузятся ДО createText()/characters — Figma требует, чтобы
  // текущий fontName узла был загружен при любом изменении текста, включая
  // самое первое присвоение characters.
  const runFonts = await Promise.all(runs.map((r) => resolveFont(r.typography)))

  const textNode = figma.createText()
  textNode.fontName = runFonts[0] ?? FALLBACK_FONT
  textNode.characters = runs.map((r) => r.text).join('')
  textNode.name = node.name

  let offset = 0
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    const length = run.text.length
    const start = offset
    const end = offset + length
    offset = end
    if (length === 0) continue

    const font = runFonts[i] ?? FALLBACK_FONT
    textNode.setRangeFontName(start, end, font)
    textNode.setRangeFontSize(start, end, run.typography.fontSize)
    textNode.setRangeFills(start, end, toFigmaPaints([{ type: 'solid', color: run.color }]))
    textNode.setRangeTextCase(start, end, toTextCase(run.typography.textCase))
    textNode.setRangeTextDecoration(start, end, toTextDecoration(run.typography.textDecoration))
    if (run.typography.letterSpacing !== undefined) {
      textNode.setRangeLetterSpacing(start, end, { unit: 'PIXELS', value: run.typography.letterSpacing })
    }
  }

  // Выравнивание/интерлиньяж — общие на весь TextNode, не per-range: берём
  // из typography КОНТЕЙНЕРА (самого параграфа), не отдельного прогона —
  // соответствует тому, как это работает в CSS (text-align/line-height
  // наследуются от блока, инлайновые теги их не переопределяют).
  if (node.typography) {
    textNode.textAlignHorizontal = toTextAlign(node.typography.textAlign)
    textNode.lineHeight =
      node.typography.lineHeight === 'normal' || node.typography.lineHeight === undefined
        ? { unit: 'AUTO' }
        : { unit: 'PIXELS', value: node.typography.lineHeight }
  }

  textNode.textAutoResize = 'NONE'
  textNode.resize(Math.max(1, node.size.width), Math.max(1, node.size.height))

  if (node.opacity !== undefined) textNode.opacity = node.opacity
  if (node.rotationDeg !== undefined) textNode.rotation = node.rotationDeg

  return { textNode, fontFallback }
}
