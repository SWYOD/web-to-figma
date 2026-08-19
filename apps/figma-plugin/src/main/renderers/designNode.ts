/// <reference types="@figma/plugin-typings" />
import type { CornerRadius, DesignNode } from '@web-to-figma/design-ast'
import { toFigmaPaints } from './paint'
import { toFigmaEffects } from './effects'

/**
 * DesignNode → FrameNode. Phase 6 — один узел, без Auto Layout (`layout.mode`
 * от conversion-engine сейчас всегда `'none'`, см. docs/architecture.md
 * roadmap Phase 7) и без детей (Phase 8). `node.type` в Phase 5 всегда
 * `'frame'` — ветки на другие типы не нужны, пока conversion-engine их не
 * производит (design-ast.md: "потребители обязаны иметь default-ветку на
 * неизвестный тип", но конкретную реализацию для text/image/vector добавляем
 * тогда, когда появится продюсер, не раньше).
 */
export function renderDesignNode(node: DesignNode): FrameNode {
  const frame = figma.createFrame()
  frame.name = node.name
  frame.resize(Math.max(1, node.size.width), Math.max(1, node.size.height))

  frame.fills = node.fills ? toFigmaPaints(node.fills) : []

  if (node.strokes) {
    frame.strokes = toFigmaPaints(node.strokes.paints)
    frame.strokeWeight = node.strokes.weight
  }

  if (node.effects && node.effects.length > 0) {
    frame.effects = toFigmaEffects(node.effects)
  }

  applyCornerRadius(frame, node.cornerRadius)

  if (node.opacity !== undefined) frame.opacity = node.opacity
  if (node.rotationDeg !== undefined) frame.rotation = node.rotationDeg

  return frame
}

function applyCornerRadius(frame: FrameNode, radius: number | CornerRadius | undefined): void {
  if (radius === undefined) return
  if (typeof radius === 'number') {
    frame.cornerRadius = radius
    return
  }
  frame.topLeftRadius = radius.topLeft
  frame.topRightRadius = radius.topRight
  frame.bottomRightRadius = radius.bottomRight
  frame.bottomLeftRadius = radius.bottomLeft
}

/** Ставит фрейм рядом с текущим viewport и подводит взгляд к нему — см. ТЗ §17. */
export function placeNearViewport(frame: FrameNode): void {
  frame.x = Math.round(figma.viewport.center.x - frame.width / 2)
  frame.y = Math.round(figma.viewport.center.y - frame.height / 2)
  figma.currentPage.selection = [frame]
  figma.viewport.scrollAndZoomIntoView([frame])
}
