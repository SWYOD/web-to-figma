/// <reference types="@figma/plugin-typings" />
import type { AssetManifest, DesignNode, LayoutInfo } from '@web-to-figma/design-ast'
import { toFigmaPaints } from './paint'
import { toFigmaEffects } from './effects'
import { applyLayout } from './layout'
import { createImagePaint, createVectorFromAsset } from './asset'
import { applyCornerRadius } from './cornerRadius'
import { createTextNode } from './textNode'
import { loadStyleCatalog, matchNearestSolidPaintStyle, type StyleCatalog } from './styleMatching'

/**
 * DesignNode → SceneNode, рекурсивно (Phase 8 — "nested trees"). Auto Layout
 * (Phase 7, `layout.ts`) применяется, когда conversion-engine распознал
 * `display:flex`; иначе — обычный фрейм. `type:'image'`/`'vector'` (Phase 9)
 * рендерятся из `assets` манифеста DesignDocument — `asset.ts` изолирует
 * работу с `figma.createImage`/`createNodeFromSvg`. `type:'text'` (реальные
 * текстовые узлы с содержимым) — через `createTextNode` (`textNode.ts`,
 * требует `figma.loadFontAsync`, поэтому весь рендер асинхронный).
 *
 * `useMatchedStyles` (см. styleMatching.ts) — грузим каталог локальных
 * text/paint styles ОДИН раз на весь импорт (не на узел — `getLocalTextStylesAsync`/
 * `getLocalPaintStylesAsync` не привязаны к конкретному узлу), дальше просто
 * пробрасываем вниз по рекурсии.
 */
export async function renderDesignNode(node: DesignNode, assets: AssetManifest, useMatchedStyles = false): Promise<SceneNode> {
  const catalog = useMatchedStyles ? await loadStyleCatalog() : null
  return buildFrame(node, assets, catalog)
}

async function buildFrame(node: DesignNode, assets: AssetManifest, catalog: StyleCatalog | null): Promise<SceneNode> {
  if (node.type === 'text') {
    const { textNode } = await createTextNode(node, catalog)
    return textNode
  }

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
  const matchedFillStyle = !imagePaint ? matchSolidFillStyle(node.fills, catalog) : null
  if (matchedFillStyle) {
    frame.fillStyleId = matchedFillStyle.id
  } else {
    frame.fills = imagePaint ? [imagePaint] : node.fills ? toFigmaPaints(node.fills) : []
  }

  if (node.strokes) {
    const matchedStrokeStyle = matchSolidFillStyle(node.strokes.paints, catalog)
    if (matchedStrokeStyle) {
      frame.strokeStyleId = matchedStrokeStyle.id
    } else {
      frame.strokes = toFigmaPaints(node.strokes.paints)
    }
    frame.strokeWeight = node.strokes.weight
  }

  if (node.effects && node.effects.length > 0) {
    frame.effects = toFigmaEffects(node.effects)
  }

  applyCornerRadius(frame, node.cornerRadius)
  applyLayout(frame, node.layout)
  // Явно, не полагаясь на дефолт figma.createFrame() — CSS overflow:visible
  // (браузерный дефолт) должен НЕ обрезать, что фактически важно для детей,
  // выходящих за границы (напр. декоративные ::before/::after со смещением
  // через transform, см. docs/architecture.md находку "double border").
  frame.clipsContent = node.clipsContent ?? false

  if (node.opacity !== undefined) frame.opacity = node.opacity
  if (node.rotationDeg !== undefined) frame.rotation = node.rotationDeg

  for (const child of node.children ?? []) {
    const childNode = await buildFrame(child, assets, catalog)
    frame.appendChild(childNode)

    // positioning:'auto' — child.layout.mode пуст, доверяем Auto Layout
    // родителя. positioning:'absolute' — либо реальный CSS absolute, либо
    // fallback block-flow-родителя без Auto Layout (см. conversion-engine
    // resolvePositioning) — в обоих случаях нужны явные координаты;
    // layoutPositioning — только если у родителя ЕСТЬ что "покидать".
    if (child.layout?.positioning === 'absolute' && child.layout.absolute) {
      // childNode здесь никогда не StickyNode/ConnectorNode (мы сами его
      // только что создали через createFrame/createText/createNodeFromSvg) —
      // у полного SceneNode union'а есть члены без layoutPositioning
      // (FigJam-специфика), поэтому явный cast, а не сужение на месте.
      if (frame.layoutMode !== 'NONE') (childNode as FrameNode).layoutPositioning = 'ABSOLUTE'
      childNode.x = child.layout.absolute.x
      childNode.y = child.layout.absolute.y
    } else if (frame.layoutMode !== 'NONE') {
      // FILL только валиден на детях Auto Layout родителя (см. designNode.ts
      // JSDoc выше и plugin-typings) — 'absolute' дети выше уже выведены из
      // потока через layoutPositioning:'ABSOLUTE' и сюда не попадают. 'hug'
      // conversion-engine намеренно не производит (см. resolveSizing в
      // convertElement.ts — нужен authored CSS, не только computed), поэтому
      // здесь только fill/fixed.
      applyChildSizing(childNode as FrameNode | TextNode, child.layout)
    }
  }

  return frame
}

/** Первый solid paint массива → ближайший локальный paint style (или null — нет каталога/подходящих стилей/solid-заливок). */
function matchSolidFillStyle(paints: DesignNode['fills'], catalog: StyleCatalog | null): PaintStyle | null {
  if (!catalog) return null
  const firstSolid = paints?.find((p) => p.type === 'solid')
  if (!firstSolid) return null
  return matchNearestSolidPaintStyle(firstSolid.color, catalog.solidPaintStyles)
}

/** node.layout.widthSizing/heightSizing:'fill' → layoutSizingHorizontal/Vertical:'FILL' на реальном Auto Layout ребёнке; иначе 'FIXED' (явно, не полагаясь на дефолт API). */
function applyChildSizing(childNode: FrameNode | TextNode, layout: LayoutInfo | undefined): void {
  childNode.layoutSizingHorizontal = layout?.widthSizing === 'fill' ? 'FILL' : 'FIXED'
  childNode.layoutSizingVertical = layout?.heightSizing === 'fill' ? 'FILL' : 'FIXED'
}

/** Ставит новый узел рядом с текущим viewport и подводит взгляд к нему — см. ТЗ §17. */
export function placeNearViewport(node: SceneNode): void {
  node.x = Math.round(figma.viewport.center.x - node.width / 2)
  node.y = Math.round(figma.viewport.center.y - node.height / 2)
  figma.currentPage.selection = [node]
  figma.viewport.scrollAndZoomIntoView([node])
}
