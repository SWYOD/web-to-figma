import { isTransparent, parseColor } from './color.js'
import { parseLength } from './length.js'

/** TextNode в Figma не умеет фон/рамку/radius/padding. Элементы вроде
 * `<a class="button">` и круглых текстовых `.fact-icon` материализуются как
 * внешний Frame + внутренний TextNode. Эту проверку обязаны разделять
 * конвертер и component recognition, иначе пути instance overrides перестают
 * совпадать с реально созданным деревом Figma. */
export function hasVisualTextBox(style: Record<string, string>): boolean {
  const display = style['display'] ?? ''
  if (display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid') return true
  const bg = parseColor(style['background-color'] ?? 'rgba(0, 0, 0, 0)')
  if (!isTransparent(bg)) return true
  if ((style['box-shadow'] ?? 'none') !== 'none') return true
  if (['top', 'right', 'bottom', 'left'].some((side) => parseLength(style[`padding-${side}`], 0) > 0)) return true
  if (['top', 'right', 'bottom', 'left'].some((side) => parseLength(style[`border-${side}-width`], 0) > 0)) return true
  return parseLength(style['border-top-left-radius'], 0) > 0
}
