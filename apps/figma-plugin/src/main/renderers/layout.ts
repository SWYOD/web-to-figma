/// <reference types="@figma/plugin-typings" />
import type { LayoutInfo } from '@web-to-figma/design-ast'

/**
 * LayoutInfo → Auto Layout Figma-свойства (Phase 7). `mode:'none'` — обычный
 * фрейм, ничего не трогаем (padding/itemSpacing/align на не-auto-layout
 * фрейме ничего не значат в Figma). Оба измерения фиксированы (`FIXED`),
 * т.к. conversion-engine пока всегда отдаёт `widthSizing/heightSizing:
 * 'fixed'` — hug/fill появятся вместе с child-aware sizing (Phase 8+).
 */
export function applyLayout(frame: FrameNode, layout: LayoutInfo | undefined): void {
  if (!layout || layout.mode === 'none') return

  frame.layoutMode = layout.mode === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL'
  frame.primaryAxisSizingMode = 'FIXED'
  frame.counterAxisSizingMode = 'FIXED'
  frame.itemSpacing = layout.gap ?? 0

  if (layout.padding) {
    frame.paddingTop = layout.padding.top
    frame.paddingRight = layout.padding.right
    frame.paddingBottom = layout.padding.bottom
    frame.paddingLeft = layout.padding.left
  }

  frame.primaryAxisAlignItems = toPrimaryAxisAlign(layout.justify)
  frame.counterAxisAlignItems = toCounterAxisAlign(layout.align, layout.mode)
}

function toPrimaryAxisAlign(justify: LayoutInfo['justify']): 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN' {
  switch (justify) {
    case 'center':
      return 'CENTER'
    case 'end':
      return 'MAX'
    case 'space-between':
      return 'SPACE_BETWEEN'
    // 'start' и 'space-around' (уже приближённое к 'start' в conversion-engine,
    // см. layout.ts §mapJustifyContent) — оба в MIN, у Figma нет третьего варианта.
    default:
      return 'MIN'
  }
}

function toCounterAxisAlign(align: LayoutInfo['align'], mode: LayoutInfo['mode']): 'MIN' | 'MAX' | 'CENTER' | 'BASELINE' {
  switch (align) {
    case 'center':
      return 'CENTER'
    case 'end':
      return 'MAX'
    case 'baseline':
      // BASELINE валиден в Figma только для HORIZONTAL layoutMode.
      return mode === 'horizontal' ? 'BASELINE' : 'MIN'
    // 'start' и 'stretch' (дефолт align-items в CSS) — у контейнера в Figma
    // нет отдельного STRETCH для counterAxisAlignItems (это per-child
    // layoutAlign), ближайший нейтральный вариант — MIN.
    default:
      return 'MIN'
  }
}
