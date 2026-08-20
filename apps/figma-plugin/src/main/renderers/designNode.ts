/// <reference types="@figma/plugin-typings" />
import type { AssetManifest, DesignNode, LayoutInfo } from '@web-to-figma/design-ast'
import { toFigmaPaints } from './paint'
import { toFigmaEffects } from './effects'
import { applyLayout } from './layout'
import { createImagePaint, createVectorFromAsset } from './asset'
import { applyCornerRadius } from './cornerRadius'
import { createTextNode } from './textNode'
import { loadStyleCatalog, matchColor, NO_STYLE_MATCHING, type ColorMatchSource, type StyleMatchOptions } from './styleMatching'

/**
 * DesignNode → SceneNode, рекурсивно (Phase 8 — "nested trees"). Auto Layout
 * (Phase 7, `layout.ts`) применяется, когда conversion-engine распознал
 * `display:flex`; иначе — обычный фрейм. `type:'image'`/`'vector'` (Phase 9)
 * рендерятся из `assets` манифеста DesignDocument — `asset.ts` изолирует
 * работу с `figma.createImage`/`createNodeFromSvg`. `type:'text'` (реальные
 * текстовые узлы с содержимым) — через `createTextNode` (`textNode.ts`,
 * требует `figma.loadFontAsync`, поэтому весь рендер асинхронный).
 *
 * Раздельные переключатели для шрифтов/цветов (см. styleMatching.ts) —
 * грузим каталог локальных text/paint styles ОДИН раз на весь импорт (не на
 * узел — `getLocalTextStylesAsync`/`getLocalPaintStylesAsync` не привязаны к
 * конкретному узлу), если включён хотя бы один из двух, дальше просто
 * пробрасываем вниз по рекурсии вместе с обоими флагами.
 */
export async function renderDesignNode(
  node: DesignNode,
  assets: AssetManifest,
  matchText = false,
  matchColorEnabled = false,
  colorMatchSource: ColorMatchSource = 'style'
): Promise<SceneNode> {
  const styleMatch: StyleMatchOptions =
    matchText || matchColorEnabled
      ? { catalog: await loadStyleCatalog({ matchText, matchColor: matchColorEnabled, colorMatchSource }), matchText, matchColor: matchColorEnabled, colorMatchSource }
      : NO_STYLE_MATCHING
  warnIfCatalogEmpty(styleMatch)
  return buildFrame(node, assets, styleMatch)
}

/**
 * "Стили проекта" включены, но подходящих кандидатов в файле нет вообще —
 * пользователь иначе не узнает, ПОЧЕМУ импорт тихо остался на raw-значениях
 * (единственный видимый симптом — "не сработало", неотличимый на глаз от
 * реального бага в подборе). `figma.notify` — тост в самой Figma, не нужно
 * лезть в консоль плагина за диагностикой.
 */
function warnIfCatalogEmpty(styleMatch: StyleMatchOptions): void {
  if (!styleMatch.catalog) return
  if (styleMatch.matchText && styleMatch.catalog.textStyles.length === 0) {
    figma.notify('Text styles не найдены в файле — шрифты импортированы как есть.', { timeout: 4000 })
  }
  if (styleMatch.matchColor) {
    const source = styleMatch.colorMatchSource
    const count = source === 'variable' ? styleMatch.catalog.colorVariables.length : styleMatch.catalog.solidPaintStyles.length
    if (count === 0) {
      const label = source === 'variable' ? 'Color variables' : 'Paint styles'
      figma.notify(`${label} не найдены в файле — цвета импортированы как есть.`, { timeout: 4000 })
    }
  }
}

async function buildFrame(node: DesignNode, assets: AssetManifest, styleMatch: StyleMatchOptions): Promise<SceneNode> {
  if (node.type === 'text') {
    const { textNode } = await createTextNode(node, styleMatch)
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
  const matchedFill = !imagePaint ? matchSolidColor(node.fills, styleMatch) : null
  if (matchedFill?.kind === 'style') {
    frame.fillStyleId = matchedFill.styleId
  } else if (matchedFill?.kind === 'variable') {
    frame.fills = [matchedFill.paint]
  } else {
    frame.fills = imagePaint ? [imagePaint] : node.fills ? toFigmaPaints(node.fills) : []
  }

  if (node.strokes) {
    const matchedStroke = matchSolidColor(node.strokes.paints, styleMatch)
    if (matchedStroke?.kind === 'style') {
      frame.strokeStyleId = matchedStroke.styleId
    } else if (matchedStroke?.kind === 'variable') {
      frame.strokes = [matchedStroke.paint]
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
    const childNode = await buildFrame(child, assets, styleMatch)
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
      // FILL/HUG только валидны на детях Auto Layout родителя (см.
      // designNode.ts JSDoc выше и plugin-typings) — 'absolute' дети выше уже
      // выведены из потока через layoutPositioning:'ABSOLUTE' и сюда не
      // попадают.
      applyChildSizing(childNode, child.layout)
      // Живой баг: figma.appendChild() в Auto-Layout родителя САМ, ДО того
      // как мы успеваем выставить layoutSizingHorizontal/Vertical выше,
      // синхронно применяет к новому ребёнку какой-то дефолт по ГЛАВНОЙ оси
      // родителя (в горизонтальном ряду — ширина) — для узла БЕЗ собственных
      // детей (картинка/вектор с одной лишь заливкой, нечего "hug"-ать)
      // Figma схлопывает эту ось в единицы пикселей ДО нашего кода, а наш
      // последующий layoutSizingHorizontal='FIXED' лишь "замораживает" уже
      // испорченный размер, не восстанавливая исходный (проверено живьём:
      // картинки-логотипы в горизонтальном flex-ряду импортировались шириной
      // 1px при верной высоте). Переприменяем захваченный пиксельный размер
      // ПОСЛЕ назначения sizing-режимов — на FILL/HUG-осях это безвредный
      // no-op (auto-layout пересчитает их сам на следующем layout pass), на
      // FIXED — гарантированно восстанавливает то, что реально было на странице.
      if ('resize' in childNode) {
        childNode.resize(Math.max(1, child.size.width), Math.max(1, child.size.height))
      }
    }
  }

  return frame
}

/** Первый solid paint массива → ближайший локальный paint style/color variable
 *  (или null — цветовой матчинг выключен/нет каталога/подходящих кандидатов/solid-заливок). */
function matchSolidColor(paints: DesignNode['fills'], styleMatch: StyleMatchOptions): ReturnType<typeof matchColor> {
  if (!styleMatch.matchColor || !styleMatch.catalog) return null
  const firstSolid = paints?.find((p) => p.type === 'solid')
  if (!firstSolid) return null
  return matchColor(firstSolid.color, styleMatch.catalog, styleMatch.colorMatchSource)
}

/**
 * node.layout.widthSizing/heightSizing → layoutSizingHorizontal/Vertical на
 * реальном Auto Layout ребёнке; 'fixed' по умолчанию (явно, не полагаясь на
 * дефолт API). 'HUG' — валиден в Figma ТОЛЬКО на TEXT-узлах и на FRAME,
 * который сам является Auto Layout контейнером (`layoutMode !== 'NONE'`);
 * на плоском фрейме/картинке/векторе без своего Auto Layout API бросает
 * ошибку — canHug ниже это отсекает, оставляя FIXED (conversion-engine мог
 * посчитать 'hug' по authored CSS независимо от того, чем узел стал здесь).
 */
function applyChildSizing(childNode: SceneNode, layout: LayoutInfo | undefined): void {
  if (!('layoutSizingHorizontal' in childNode)) return
  const sizable = childNode as FrameNode | TextNode
  const canHug = childNode.type === 'TEXT' || (childNode.type === 'FRAME' && childNode.layoutMode !== 'NONE')
  sizable.layoutSizingHorizontal = layout?.widthSizing === 'fill' ? 'FILL' : layout?.widthSizing === 'hug' && canHug ? 'HUG' : 'FIXED'
  sizable.layoutSizingVertical = layout?.heightSizing === 'fill' ? 'FILL' : layout?.heightSizing === 'hug' && canHug ? 'HUG' : 'FIXED'
}

/** Ставит новый узел рядом с текущим viewport и подводит взгляд к нему — см. ТЗ §17. */
export function placeNearViewport(node: SceneNode): void {
  node.x = Math.round(figma.viewport.center.x - node.width / 2)
  node.y = Math.round(figma.viewport.center.y - node.height / 2)
  figma.currentPage.selection = [node]
  figma.viewport.scrollAndZoomIntoView([node])
}
