import type { ConversionWarning, LayoutInfo } from '@web-to-figma/design-ast'
import { parseLength } from './length.js'

/**
 * `display:flex` → LayoutInfo с реальным Auto-Layout-режимом (Phase 7). Не-flex
 * узлы по-прежнему получают `mode:'none'` (см. docs/conversion-rules.md).
 * `justify`/`align` — нейтральный словарь AST, не Figma enum напрямую: сама
 * approximation к Figma primaryAxisAlignItems/counterAxisAlignItems — забота
 * рендерера (apps/figma-plugin/src/main/renderers/designNode.ts), а не этого
 * пакета (изоляция от Figma API, см. docs/architecture.md §3).
 */
export function parseLayout(style: Record<string, string>, nodeId: string, diagnostics: ConversionWarning[]): LayoutInfo {
  const padding = {
    top: parseLength(style['padding-top']),
    right: parseLength(style['padding-right']),
    bottom: parseLength(style['padding-bottom']),
    left: parseLength(style['padding-left'])
  }

  const display = style['display'] ?? 'block'
  if (!display.includes('flex')) {
    return { mode: 'none', padding, widthSizing: 'fixed', heightSizing: 'fixed', positioning: 'auto' }
  }

  const direction = style['flex-direction'] ?? 'row'
  const mode = direction.startsWith('column') ? 'vertical' : 'horizontal'

  const rowGap = parseLength(style['row-gap'])
  const columnGap = parseLength(style['column-gap'])
  // Между рядами-элементами row-flex зазор задаёт column-gap (гэп между "колонками"
  // в ряду), а не row-gap (тот про зазор между рядами — актуален только при wrap).
  const gap = mode === 'horizontal' ? columnGap : rowGap

  return {
    mode,
    gap,
    padding,
    align: mapAlignItems(style['align-items']),
    justify: mapJustifyContent(style['justify-content'], nodeId, diagnostics),
    widthSizing: 'fixed',
    heightSizing: 'fixed',
    positioning: 'auto'
  }
}

function mapJustifyContent(raw: string | undefined, nodeId: string, diagnostics: ConversionWarning[]): LayoutInfo['justify'] {
  switch (raw) {
    case 'center':
      return 'center'
    case 'flex-end':
    case 'end':
      return 'end'
    case 'space-between':
      return 'space-between'
    case 'space-around':
    case 'space-evenly':
      diagnostics.push({
        nodeId,
        code: 'justify-content-approximated',
        severity: 'warning',
        message: `justify-content: ${raw} не имеет аналога в Figma Auto Layout — приближено к выравниванию по началу.`
      })
      return 'start'
    default:
      return 'start'
  }
}

function mapAlignItems(raw: string | undefined): LayoutInfo['align'] {
  switch (raw) {
    case 'center':
      return 'center'
    case 'flex-end':
    case 'end':
      return 'end'
    case 'baseline':
      return 'baseline'
    case 'flex-start':
    case 'start':
      return 'start'
    default:
      // CSS-дефолт align-items — 'normal', эквивалентно 'stretch' для flex-контейнеров.
      return 'stretch'
  }
}
