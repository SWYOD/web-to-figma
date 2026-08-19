/// <reference types="@figma/plugin-typings" />
import type { DesignNode } from '@web-to-figma/design-ast'
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
