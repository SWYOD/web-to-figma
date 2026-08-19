/// <reference types="@figma/plugin-typings" />
import type { AssetManifest, CornerRadius, DesignNode } from '@web-to-figma/design-ast'
import { toFigmaPaints } from './paint'
import { toFigmaEffects } from './effects'
import { applyLayout } from './layout'
import { createImagePaint, createVectorFromAsset } from './asset'

/**
 * DesignNode → FrameNode, рекурсивно (Phase 8 — "nested trees"). Auto Layout
 * (Phase 7, `layout.ts`) применяется, когда conversion-engine распознал
 * `display:flex`; иначе — обычный фрейм. `type:'image'`/`'vector'` (Phase 9)
 * рендерятся из `assets` манифеста DesignDocument — `asset.ts` изолирует
 * работу с `figma.createImage`/`createNodeFromSvg`. Остальные типы
 * (`'text'`) conversion-engine пока не производит — default-ветка не нужна
 * раньше появления продюсера (design-ast.md).
 */
export function renderDesignNode(node: DesignNode, assets: AssetManifest): FrameNode {
  return buildFrame(node, assets)
}

function buildFrame(node: DesignNode, assets: AssetManifest): FrameNode {
  if (node.type === 'vector' && node.asset) {
    const svgFrame = createVectorFromAsset(node.asset.assetId, assets)
    if (svgFrame) {
      svgFrame.name = node.name
      svgFrame.resize(Math.max(1, node.size.width), Math.max(1, node.size.height))
      if (node.opacity !== undefined) svgFrame.opacity = node.opacity
      if (node.rotationDeg !== undefined) svgFrame.rotation = node.rotationDeg
      // SVG сам несёт свои fills/strokes/effects — не перезаписываем содержимым AST.
      return svgFrame
    }
    // Ассет недоступен (ref-транспорт/ошибка) — тихо деградируем до обычного фрейма ниже.
  }

  const frame = figma.createFrame()
  frame.name = node.name
  frame.resize(Math.max(1, node.size.width), Math.max(1, node.size.height))

  const imagePaint = node.type === 'image' && node.asset ? createImagePaint(node.asset.assetId, assets) : null
  frame.fills = imagePaint ? [imagePaint] : node.fills ? toFigmaPaints(node.fills) : []

  if (node.strokes) {
    frame.strokes = toFigmaPaints(node.strokes.paints)
    frame.strokeWeight = node.strokes.weight
  }

  if (node.effects && node.effects.length > 0) {
    frame.effects = toFigmaEffects(node.effects)
  }

  applyCornerRadius(frame, node.cornerRadius)
  applyLayout(frame, node.layout)

  if (node.opacity !== undefined) frame.opacity = node.opacity
  if (node.rotationDeg !== undefined) frame.rotation = node.rotationDeg

  for (const child of node.children ?? []) {
    const childFrame = buildFrame(child, assets)
    frame.appendChild(childFrame)

    // positioning:'auto' — child.layout.mode пуст, доверяем Auto Layout
    // родителя. positioning:'absolute' — либо реальный CSS absolute, либо
    // fallback block-flow-родителя без Auto Layout (см. conversion-engine
    // resolvePositioning) — в обоих случаях нужны явные координаты;
    // layoutPositioning — только если у родителя ЕСТЬ что "покидать".
    if (child.layout?.positioning === 'absolute' && child.layout.absolute) {
      if (frame.layoutMode !== 'NONE') childFrame.layoutPositioning = 'ABSOLUTE'
      childFrame.x = child.layout.absolute.x
      childFrame.y = child.layout.absolute.y
    }
  }

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
