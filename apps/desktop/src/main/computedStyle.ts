import type { ElementAppearance, ElementLayout, ElementTypography } from '../shared/types'

/**
 * Сырые computed-style значения (строки, как их отдаёт CDP
 * `CSS.getComputedStyleForNode`) → структурированные Layout/Typography/
 * Appearance для Inspector Panel. Это Phase 4 ("basic property extraction") —
 * сознательно НЕ Design AST (типизированные Paint/Effect и т.д., см.
 * docs/design-ast.md) — та нормализация начинается в Phase 5 вместе с
 * conversion-engine. Здесь — просто читаемое отображение сырых значений.
 *
 * Чистая функция без Electron/CDP-зависимостей — тестируется в изоляции.
 */

export type ComputedStyleMap = ReadonlyMap<string, string>

export function toComputedStyleMap(entries: { name: string; value: string }[]): ComputedStyleMap {
  const map = new Map<string, string>()
  for (const { name, value } of entries) map.set(name, value)
  return map
}

function get(map: ComputedStyleMap, name: string, fallback = ''): string {
  return map.get(name) ?? fallback
}

/** Сворачивает 4 стороны в CSS shorthand-подобную строку: "0" / "T LR" / "T R B L". */
function collapseBox(top: string, right: string, bottom: string, left: string): string {
  if (top === right && right === bottom && bottom === left) return top
  if (top === bottom && right === left) return `${top} ${right}`
  return `${top} ${right} ${bottom} ${left}`
}

/** row-gap/column-gap → "8" (равны) или "8 16" (различаются). */
function collapsePair(a: string, b: string): string {
  return a === b ? a : `${a} ${b}`
}

const ZERO_LENGTH = /^0(px)?$/

export function parseLayout(map: ComputedStyleMap): ElementLayout {
  const display = get(map, 'display', 'block')
  const isFlexOrGrid = display.includes('flex') || display.includes('grid')

  return {
    display,
    position: get(map, 'position', 'static'),
    padding: collapseBox(
      get(map, 'padding-top', '0px'),
      get(map, 'padding-right', '0px'),
      get(map, 'padding-bottom', '0px'),
      get(map, 'padding-left', '0px')
    ),
    flexDirection: isFlexOrGrid ? get(map, 'flex-direction', 'row') : null,
    justifyContent: isFlexOrGrid ? get(map, 'justify-content', 'normal') : null,
    alignItems: isFlexOrGrid ? get(map, 'align-items', 'normal') : null,
    gap: isFlexOrGrid ? collapsePair(get(map, 'row-gap', '0px'), get(map, 'column-gap', '0px')) : null
  }
}

export function parseTypography(map: ComputedStyleMap): ElementTypography {
  return {
    fontFamily: get(map, 'font-family', 'inherit').split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? 'inherit',
    fontSize: get(map, 'font-size', '16px'),
    fontWeight: get(map, 'font-weight', '400'),
    lineHeight: get(map, 'line-height', 'normal'),
    letterSpacing: get(map, 'letter-spacing', 'normal'),
    textAlign: get(map, 'text-align', 'start'),
    color: get(map, 'color', 'rgb(0, 0, 0)')
  }
}

export function parseAppearance(map: ComputedStyleMap): ElementAppearance {
  const borderWidth = get(map, 'border-top-width', '0px')
  const borderStyle = get(map, 'border-top-style', 'none')
  const hasBorder = borderStyle !== 'none' && !ZERO_LENGTH.test(borderWidth)

  const radius = collapseBox(
    get(map, 'border-top-left-radius', '0px'),
    get(map, 'border-top-right-radius', '0px'),
    get(map, 'border-bottom-right-radius', '0px'),
    get(map, 'border-bottom-left-radius', '0px')
  )
  const hasRadius = !radius.split(' ').every((v) => ZERO_LENGTH.test(v))

  return {
    backgroundColor: get(map, 'background-color', 'rgba(0, 0, 0, 0)'),
    border: hasBorder ? `${borderWidth} ${borderStyle} ${get(map, 'border-top-color', '')}`.trim() : null,
    borderRadius: hasRadius ? radius : null,
    boxShadow: get(map, 'box-shadow', 'none')
  }
}
