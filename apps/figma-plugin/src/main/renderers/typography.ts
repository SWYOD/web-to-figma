/// <reference types="@figma/plugin-typings" />
import type { TypographyInfo } from '@web-to-figma/design-ast'

/**
 * Применяет доступные без подбора нового шрифта свойства типографики на
 * TextNode: размер, интерлиньяж, трекинг, выравнивание, регистр, decoration.
 * Подбор font-family/weight под шрифты, установленные в Figma (font matching
 * с fallback, п.21 исходного ТЗ) — отдельная, более сложная задача (нет
 * надёжного способа угадать стиль шрифта без risка ошибиться и уронить
 * операцию), сознательно отложена — см. docs/architecture.md. Применяем
 * поверх ТЕКУЩЕГО шрифта слоя, шрифт не меняем.
 */
export async function applyTypography(node: TextNode, typography: TypographyInfo): Promise<string | null> {
  if (node.fontName === figma.mixed) {
    return `${node.name}: смешанные шрифты в текстовом слое — typography пропущена`
  }
  await figma.loadFontAsync(node.fontName)

  node.fontSize = typography.fontSize
  node.lineHeight =
    typography.lineHeight === 'normal' || typography.lineHeight === undefined
      ? { unit: 'AUTO' }
      : { unit: 'PIXELS', value: typography.lineHeight }
  if (typography.letterSpacing !== undefined) {
    node.letterSpacing = { unit: 'PIXELS', value: typography.letterSpacing }
  }
  node.textAlignHorizontal = toTextAlign(typography.textAlign)
  node.textCase = toTextCase(typography.textCase)
  node.textDecoration = toTextDecoration(typography.textDecoration)
  return null
}

export function toTextAlign(align: TypographyInfo['textAlign']): TextNode['textAlignHorizontal'] {
  switch (align) {
    case 'center':
      return 'CENTER'
    case 'right':
      return 'RIGHT'
    case 'justify':
      return 'JUSTIFIED'
    default:
      return 'LEFT'
  }
}

export function toTextCase(textCase: TypographyInfo['textCase']): TextNode['textCase'] {
  switch (textCase) {
    case 'upper':
      return 'UPPER'
    case 'lower':
      return 'LOWER'
    case 'title':
      return 'TITLE'
    default:
      return 'ORIGINAL'
  }
}

export function toTextDecoration(decoration: TypographyInfo['textDecoration']): TextNode['textDecoration'] {
  switch (decoration) {
    case 'underline':
      return 'UNDERLINE'
    case 'strikethrough':
      return 'STRIKETHROUGH'
    default:
      return 'NONE'
  }
}
