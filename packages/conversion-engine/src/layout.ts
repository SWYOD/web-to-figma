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

  if (display.includes('grid')) {
    const gridMode = detectSingleTrackGridMode(style)
    if (gridMode) return buildAutoLayout(gridMode, style, padding, nodeId, diagnostics, /* isGrid */ true)
    // Настоящая многоколоночная/многострочная сетка — приближение только для
    // одной "дорожки" (см. detectSingleTrackGridMode); честная 2D grid-
    // структура (несколько строк И несколько колонок разом) пока не
    // реализована — остаётся обычным блоком (block-layout-approximated
    // у детей, см. resolvePositioning в convertElement.ts), не притворяемся.
    return { mode: 'none', padding, widthSizing: 'fixed', heightSizing: 'fixed', positioning: 'auto' }
  }

  if (!display.includes('flex')) {
    return { mode: 'none', padding, widthSizing: 'fixed', heightSizing: 'fixed', positioning: 'auto' }
  }

  const direction = style['flex-direction'] ?? 'row'
  const mode = direction.startsWith('column') ? 'vertical' : 'horizontal'
  return buildAutoLayout(mode, style, padding, nodeId, diagnostics, /* isGrid */ false)
}

/**
 * Число дорожек по значению `grid-template-columns`/`-rows` — то, что
 * реально отдаёт CDP computed style: список резолвленных треков через
 * пробел (`"100px 100px 100px"` → 3), либо `'none'` (треков нет вообще, см.
 * ниже). `repeat(...)`/`minmax(...)` уже развёрнуты браузером в computed
 * style, парсить сам синтаксис не нужно.
 */
function countGridTracks(value: string | undefined): number {
  if (!value || value === 'none') return 0
  return value.trim().split(/\s+/).filter(Boolean).length
}

/**
 * CSS Grid, которую можно честно приблизить к Figma Auto Layout — только
 * когда фактически используется ОДНА "дорожка" (см. countGridTracks): одна
 * явная колонка (или колонки не заданы вовсе — по умолчанию `grid-auto-flow:
 * row` без `grid-template-columns` создаёт один неявный столбец, элементы
 * идут друг под другом, это частый способ получить "flex column + gap" ещё
 * до широкой поддержки gap во flexbox) → вертикальный стек; одна строка (или
 * не задана) при НЕСКОЛЬКИХ колонках → горизонтальный ряд. Настоящая 2D
 * сетка (обе оси многодорожечные) возвращает `null` — не приближаем то, что
 * реально требует Figma Grid, а не Auto Layout.
 */
function detectSingleTrackGridMode(style: Record<string, string>): 'vertical' | 'horizontal' | null {
  const columns = countGridTracks(style['grid-template-columns'])
  const rows = countGridTracks(style['grid-template-rows'])
  if (columns <= 1) return 'vertical'
  if (rows <= 1) return 'horizontal'
  return null
}

/**
 * Общая сборка Auto-Layout-ветки LayoutInfo для flex И для приближённой
 * single-track grid (см. detectSingleTrackGridMode) — с ключевой разницей в
 * том, ОТКУДА берутся align/justify: у flex ось "выравнивание вдоль" всегда
 * `align-items`/`align-self`, а "распределение поперёк" — `justify-content`,
 * и обе оси меняются местами с `flex-direction`. У CSS Grid `justify-*`
 * ВСЕГДА про inline-ось (горизонталь), `align-*` ВСЕГДА про block-ось
 * (вертикаль), независимо от того, что мы сами решили считать "главной осью"
 * при приближении к вертикальному/горизонтальному Auto Layout — поэтому для
 * grid матчинг CSS-свойства к AST-полю (align/justify) переворачивается
 * относительно того, что было бы для flex с тем же `mode`.
 */
function buildAutoLayout(
  mode: 'vertical' | 'horizontal',
  style: Record<string, string>,
  padding: LayoutInfo['padding'],
  nodeId: string,
  diagnostics: ConversionWarning[],
  isGrid: boolean
): LayoutInfo {
  const rowGap = parseLength(style['row-gap'])
  const columnGap = parseLength(style['column-gap'])
  // Между рядами-элементами row-flex зазор задаёт column-gap (гэп между "колонками"
  // в ряду), а не row-gap (тот про зазор между рядами — актуален только при wrap).
  const gap = mode === 'horizontal' ? columnGap : rowGap

  const alignSource = isGrid ? (mode === 'vertical' ? style['justify-items'] : style['align-items']) : style['align-items']
  // В single-track grid выравнивается САМ item внутри своей grid-area:
  // vertical → align-items по Y, horizontal → justify-items по X.
  // align/justify-content двигают сетку треков целиком и для одного трека
  // часто остаются normal, из-за чего иконка прижималась к верхнему краю.
  const justifySource = isGrid ? (mode === 'vertical' ? style['align-items'] : style['justify-items']) : style['justify-content']

  return {
    mode,
    ...(!isGrid && (style['flex-wrap'] ?? 'nowrap') !== 'nowrap' ? { wrap: true } : {}),
    gap,
    rowGap,
    columnGap,
    padding,
    align: mapAlignItems(alignSource),
    justify: mapJustifyContent(justifySource, nodeId, diagnostics),
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
