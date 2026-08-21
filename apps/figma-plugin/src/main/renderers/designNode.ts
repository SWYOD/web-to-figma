/// <reference types="@figma/plugin-typings" />
import type { AssetManifest, ComponentRef, DesignNode, LayoutInfo } from '@web-to-figma/design-ast'
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
  colorMatchSource: ColorMatchSource = 'style',
  as: 'frame' | 'component' = 'frame',
  alsoCreateInstance = false
): Promise<{ primary: SceneNode; secondary?: SceneNode }> {
  const styleMatch: StyleMatchOptions =
    matchText || matchColorEnabled
      ? { catalog: await loadStyleCatalog({ matchText, matchColor: matchColorEnabled, colorMatchSource }), matchText, matchColor: matchColorEnabled, colorMatchSource }
      : NO_STYLE_MATCHING
  warnIfCatalogEmpty(styleMatch)
  const built = await buildFrame(node, assets, styleMatch)

  if (as !== 'component') return { primary: built }

  let component: ComponentNode
  try {
    component = figma.createComponentFromNode(built)
  } catch (err) {
    console.warn('createComponentFromNode failed, importing as plain frame', (err as Error).message)
    figma.notify('Не удалось создать Component для этого типа элемента — импортирован как обычный Frame.', {
      timeout: 4000
    })
    return { primary: built }
  }

  if (!alsoCreateInstance) return { primary: component }
  return { primary: component, secondary: component.createInstance() }
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

  // Component recognition (см. componentGroups.ts в conversion-engine) —
  // дети с componentRef обрабатываются ГРУППОЙ (первый componentRef каждого
  // ещё не встречавшегося groupId запускает всю группу сразу: main →
  // компонент, остальные → инстансы с override'ами), остальные — как раньше,
  // по одному. Группа обрабатывается ПОЛНОСТЬЮ в момент первого попавшегося
  // члена — если члены группы не идут подряд в исходном списке (на практике
  // почти всегда идут, т.к. это прямые DOM-соседи), более поздние "перепрыгнут"
  // вперёд относительно неgrouped-соседей между ними; осознанный компромисс
  // ради простоты, не отдельный проход с восстановлением позиций.
  const processedGroups = new Set<string>()
  for (const child of node.children ?? []) {
    const groupId = child.componentRef?.groupId
    if (groupId) {
      if (processedGroups.has(groupId)) continue
      processedGroups.add(groupId)
      const members = (node.children ?? []).filter((c) => c.componentRef?.groupId === groupId)
      await appendComponentGroup(frame, members, assets, styleMatch)
      continue
    }

    const childNode = await buildFrame(child, assets, styleMatch)
    frame.appendChild(childNode)
    finishChildPlacement(frame, childNode, child)
  }

  return frame
}

/**
 * Один член группы component recognition → Figma-компонент (main) или его
 * инстанс (остальные), с override'ами текста/картинок (см. componentGroups.ts
 * в conversion-engine — там же формат `overrides`). `figma.createComponentFromNode`
 * превращает УЖЕ добавленную в дерево ноду в компонент НА МЕСТЕ (тот же
 * родитель/позиция) — поэтому main сперва строится и добавляется как обычный
 * child, и только потом промотируется.
 */
async function appendComponentGroup(
  parentFrame: FrameNode,
  members: DesignNode[],
  assets: AssetManifest,
  styleMatch: StyleMatchOptions
): Promise<void> {
  const mainDesignNode = members.find((m) => m.componentRef?.role === 'main') ?? members[0]!
  const mainSceneNode = await buildFrame(mainDesignNode, assets, styleMatch)
  parentFrame.appendChild(mainSceneNode)
  finishChildPlacement(parentFrame, mainSceneNode, mainDesignNode)

  let mainComponent: ComponentNode
  try {
    mainComponent = figma.createComponentFromNode(mainSceneNode)
  } catch (err) {
    // Не удалось превратить ноду в компонент (неподходящий тип и т.п.) —
    // тихо деградируем: остальные члены рендерятся ОБЫЧНЫМИ отдельными
    // фреймами, как до этой фичи, а не роняют весь импорт.
    console.warn('createComponentFromNode failed, falling back to plain frames', (err as Error).message)
    for (const member of members) {
      if (member === mainDesignNode) continue
      const childNode = await buildFrame(member, assets, styleMatch)
      parentFrame.appendChild(childNode)
      finishChildPlacement(parentFrame, childNode, member)
    }
    return
  }

  for (const member of members) {
    if (member === mainDesignNode) continue
    const instance = mainComponent.createInstance()
    parentFrame.appendChild(instance)
    await applyInstanceOverrides(instance, member.componentRef?.overrides, assets)
    finishChildPlacement(parentFrame, instance, member)
  }
}

/**
 * Path-ключи override'ов ("0.2.1", индексы детей от узла группы вниз, см.
 * componentGroups.ts) резолвятся на РЕАЛЬНОЙ Figma-ноде инстанса тем же
 * индексированием `.children[i]` — main/instance гарантированно одной формы
 * (сигнатуры совпали на этапе группировки), поэтому индексы совпадают 1:1.
 * Текст — единственное, что требует `loadFontAsync` перед записью
 * `characters` (Figma-ограничение); картинки — простой swap заливки, только
 * для узлов, у которых реально есть `fills` (raster-картинки; svg-вектора
 * туда осознанно не попадают, см. componentGroups.ts diffOverrides).
 */
async function applyInstanceOverrides(
  instance: InstanceNode,
  overrides: ComponentRef['overrides'],
  assets: AssetManifest
): Promise<void> {
  if (!overrides) return

  const resolvePath = (path: string): SceneNode | null => {
    if (path === '') return instance
    let current: SceneNode = instance
    for (const raw of path.split('.')) {
      const index = Number(raw)
      if (!('children' in current)) return null
      const next: SceneNode | undefined = (current as FrameNode).children[index]
      if (!next) return null
      current = next
    }
    return current
  }

  for (const [path, text] of Object.entries(overrides.text ?? {})) {
    const target = resolvePath(path)
    if (!target || target.type !== 'TEXT') continue
    try {
      const fontName = target.fontName
      // Разные шрифты внутри одного текстового узла (mixed textRuns) —
      // пропускаем override, безопаснее оставить текст main-компонента, чем
      // упасть на попытке загрузить "смешанный" fontName.
      if (fontName === figma.mixed) continue
      await figma.loadFontAsync(fontName)
      target.characters = text
    } catch (err) {
      console.debug('text override failed', path, (err as Error).message)
    }
  }

  for (const [path, assetId] of Object.entries(overrides.assets ?? {})) {
    const target = resolvePath(path)
    if (!target || !('fills' in target)) continue
    const imagePaint = createImagePaint(assetId, assets)
    if (imagePaint) (target as FrameNode).fills = [imagePaint]
  }
}

/** positioning:'auto' — child.layout.mode пуст, доверяем Auto Layout
 *  родителя. positioning:'absolute' — либо реальный CSS absolute, либо
 *  fallback block-flow-родителя без Auto Layout (см. conversion-engine
 *  resolvePositioning) — в обоих случаях нужны явные координаты;
 *  layoutPositioning — только если у родителя ЕСТЬ что "покидать". Общая для
 *  обычных детей и для компонентов/инстансов из component recognition —
 *  позиционирование/sizing не зависит от того, обычный это фрейм или
 *  компонент/инстанс (см. applyChildSizing ниже, уже типизирована широко). */
function finishChildPlacement(frame: FrameNode, childNode: SceneNode, child: DesignNode): void {
  if (child.layout?.positioning === 'absolute' && child.layout.absolute) {
    // childNode здесь никогда не StickyNode/ConnectorNode (мы сами его
    // только что создали через createFrame/createText/createNodeFromSvg/
    // createInstance) — у полного SceneNode union'а есть члены без
    // layoutPositioning (FigJam-специфика), поэтому явный cast, а не
    // сужение на месте.
    if (frame.layoutMode !== 'NONE') (childNode as FrameNode).layoutPositioning = 'ABSOLUTE'
    childNode.x = child.layout.absolute.x
    childNode.y = child.layout.absolute.y
  } else if (frame.layoutMode !== 'NONE') {
    // FILL/HUG только валидны на детях Auto Layout родителя (см.
    // designNode.ts JSDoc выше и plugin-typings) — 'absolute' дети выше уже
    // выведены из потока через layoutPositioning:'ABSOLUTE' и сюда не
    // попадают.
    applyChildSizing(childNode, child.layout)
    // Живой баг: figma.appendChild() в Auto-Layout родителя САМ, ДО того как
    // мы успеваем выставить layoutSizingHorizontal/Vertical выше, синхронно
    // применяет к новому ребёнку какой-то дефолт по ГЛАВНОЙ оси родителя (в
    // горизонтальном ряду — ширина) — для узла БЕЗ собственных детей
    // (картинка/вектор с одной лишь заливкой, нечего "hug"-ать) Figma
    // схлопывает эту ось в единицы пикселей ДО нашего кода, а наш
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

/**
 * Ставит новый узел рядом с текущим viewport и подводит взгляд к нему — см.
 * ТЗ §17. `offset` — для батч-импорта из очереди (мульти-импорт, см.
 * ImportNodeMessage.placementOffset в bridge-protocol): desktop накопительно
 * увеличивает его на ширину каждого предыдущего документа + отступ, чтобы N
 * фреймов легли в ряд от viewport-центра, а не друг на друга. Одиночный
 * импорт не передаёт offset — ведёт себя как раньше.
 */
export function placeNearViewport(node: SceneNode, offset?: { x: number; y: number }): void {
  node.x = Math.round(figma.viewport.center.x - node.width / 2 + (offset?.x ?? 0))
  node.y = Math.round(figma.viewport.center.y - node.height / 2 + (offset?.y ?? 0))
  figma.currentPage.selection = [node]
  figma.viewport.scrollAndZoomIntoView([node])
}
