import { nanoid } from 'nanoid'
import type { ComponentRef } from '@web-to-figma/design-ast'
import type { DomSnapshotNode } from './domSnapshot.js'
import { pickSemanticClass } from './classHeuristics.js'
import { hasVisualTextBox } from './visualTextContainer.js'

/**
 * Component recognition (последний пункт бэклога после Phase 11) — находит
 * СТРУКТУРНО идентичные соседние узлы среди детей ОДНОГО родителя (карточки,
 * элементы списка/сетки, строки таблицы) и размечает их для рендерера
 * (apps/figma-plugin/renderers/designNode.ts): первый — `role:'main'`
 * (станет Figma-компонентом), остальные — `role:'instance'` с тем же
 * `groupId` (станут инстансами этого компонента) + карта override'ов
 * (текст/картинки — единственное, что реально может отличаться между
 * доказанно идентичными по структуре повторами).
 *
 * Осознанные ограничения v1 (безопасные — при несовпадении просто НЕ
 * группирует, откатываясь на обычные отдельные фреймы, как раньше):
 *  - только ПРЯМЫЕ соседи (дети одного родителя), не по всему дереву;
 *  - точное совпадение структурной сигнатуры, без нечёткого сравнения;
 *  - минимум 2 узла в группе;
 *  - текстовые листья (`isTextLeaf`) никогда не группируются сами по себе —
 *    только структурно нетривиальные повторы (карточка/строка), не голые
 *    `<li>текст</li>`.
 *  - вложенные повторы (карточка с своим повторяющимся рядом иконок внутри)
 *    работают "бесплатно" — группировка вызывается для ДЕТЕЙ КАЖДОГО узла
 *    отдельно, на каждом уровне обычной рекурсии conversion-engine.
 */

/** Как isTextLeaf в convertElement.ts — тот же критерий "это текстовый лист,
 *  не подходит для отдельного компонента". Отдельная копия, а не импорт
 *  приватной функции — здесь работаем с DomSnapshotNode (до conversion),
 *  там — с уже собранным DesignNode. */
function isTextLeaf(node: DomSnapshotNode): boolean {
  return !node.asset && (node.text !== undefined || (node.textRuns?.length ?? 0) > 0)
}

/** Текст узла для сравнения при диффе — тот же merge, что и
 *  buildName/textRuns-рендер: сырой text ИЛИ склейка textRuns. */
function nodeText(node: DomSnapshotNode): string {
  return node.text ?? (node.textRuns ?? []).map((r) => r.text).join('')
}

/**
 * Структурная сигнатура узла — форма, а НЕ содержимое: тег + осмысленный
 * (не-utility) класс + тип ассета (raster/svg, конкретный файл не важен) +
 * рекурсивная сигнатура детей. Текстовые листья все схлопываются в одну
 * сигнатуру `'text'` (содержимое явно игнорируется — два `<li>` с разным
 * текстом, но одинаковой формой, обязаны совпасть). Два узла — часть одной
 * группы, только если их сигнатуры строково идентичны.
 */
function structuralSignature(node: DomSnapshotNode): string {
  if (isTextLeaf(node)) return 'text'
  if (node.asset) return `asset:${node.asset.kind}`
  const cls = pickSemanticClass(node.classes) ?? ''
  const childSig = (node.children ?? []).map(structuralSignature).join(',')
  return `${node.tag}.${cls}[${childSig}]`
}

/**
 * Path-ключ для override'а — индексы детей ОТ УЗЛА ГРУППЫ вниз ("0.2.1"),
 * корень группы — пустая строка. main/instance гарантированно одной формы
 * (сигнатуры совпали), поэтому индексы совпадают между ними один в один —
 * рендерер идёт по тем же индексам вниз по РЕАЛЬНОМУ дереву Figma-инстанса
 * (`instance.children[i].children[j]…`), т.к. структура DesignNode/
 * Figma-нод зеркалит DomSnapshotNode 1:1.
 */
function diffOverrides(main: DomSnapshotNode, instance: DomSnapshotNode): ComponentRef['overrides'] | undefined {
  const text: Record<string, string> = {}
  const assets: Record<string, string> = {}

  const walk = (m: DomSnapshotNode, inst: DomSnapshotNode, path: string): void => {
    // Только raster — svg рендерится собственной вложенной vector-структурой
    // (см. createVectorFromAsset в figma-plugin/renderers/asset.ts), простой
    // swap заливки для неё не применим; рендерер override'а на svg-путях
    // просто не найдёт подходящей ноды и молча пропустит (см. designNode.ts).
    if (inst.asset && m.asset && inst.asset.kind === 'raster' && m.asset.kind === 'raster' && inst.asset.assetId !== m.asset.assetId) {
      assets[path] = inst.asset.assetId
    }
    if (isTextLeaf(inst) && nodeText(inst) !== nodeText(m)) {
      // Визуальный текстовый контейнер после convertElement становится
      // Frame + Text, поэтому override должен указывать не на исходный path
      // фрейма, а на его синтетического текстового ребёнка `.0`.
      const textPath = hasVisualTextBox(inst.computedStyle) ? (path ? `${path}.0` : '0') : path
      text[textPath] = nodeText(inst)
    }
    const mChildren = m.children ?? []
    const iChildren = inst.children ?? []
    const len = Math.min(mChildren.length, iChildren.length)
    for (let i = 0; i < len; i++) {
      walk(mChildren[i]!, iChildren[i]!, path ? `${path}.${i}` : `${i}`)
    }
  }
  walk(main, instance, '')

  const hasText = Object.keys(text).length > 0
  const hasAssets = Object.keys(assets).length > 0
  if (!hasText && !hasAssets) return undefined
  return { ...(hasText ? { text } : {}), ...(hasAssets ? { assets } : {}) }
}

/** Figma character override внутри Instance не может надёжно менять геометрию
 * вложенного TextNode: ширина master остаётся прежней (`◷` 20px → `45`
 * переносится столбиком). Поэтому повтор можно превращать в Component только
 * когда все отличающиеся текстовые листья имеют ту же захваченную геометрию.
 * В противном случае отдельные Frame точнее исходного сайта. */
function hasUnsafeTextGeometryOverride(main: DomSnapshotNode, instance: DomSnapshotNode): boolean {
  if (isTextLeaf(instance) && nodeText(instance) !== nodeText(main)) {
    const mainBox = main.textBox ?? main.box
    const instanceBox = instance.textBox ?? instance.box
    if (Math.abs(mainBox.width - instanceBox.width) > 0.5 || Math.abs(mainBox.height - instanceBox.height) > 0.5) return true
  }

  const mainChildren = main.children ?? []
  const instanceChildren = instance.children ?? []
  const len = Math.min(mainChildren.length, instanceChildren.length)
  for (let i = 0; i < len; i++) {
    if (hasUnsafeTextGeometryOverride(mainChildren[i]!, instanceChildren[i]!)) return true
  }
  return false
}

/**
 * Группирует детей ОДНОГО родителя по структурной сигнатуре — вызывается
 * ОТДЕЛЬНО на каждом уровне рекурсии conversion-engine (см. convertElement.ts
 * convertNode), не по всему дереву разом. Возвращает assignment только для
 * индексов, вошедших в группу из ≥2 узлов; остальные индексы в карте
 * отсутствуют (обычные узлы без componentRef, как раньше).
 */
export function detectComponentGroups(children: DomSnapshotNode[]): Map<number, ComponentRef> {
  const assignments = new Map<number, ComponentRef>()
  const bySignature = new Map<string, number[]>()

  children.forEach((child, i) => {
    if (isTextLeaf(child)) return
    const sig = structuralSignature(child)
    const list = bySignature.get(sig)
    if (list) list.push(i)
    else bySignature.set(sig, [i])
  })

  for (const indices of bySignature.values()) {
    if (indices.length < 2) continue
    const mainIndex = indices[0]!
    const mainNode = children[mainIndex]!
    // Fidelity first: если хотя бы один instance потребовал бы менять размеры
    // текста master-компонента, вся визуально единая группа остаётся обычными
    // Frame — иначе порядок/контент сохранится, а геометрия нет.
    if (indices.slice(1).some((idx) => hasUnsafeTextGeometryOverride(mainNode, children[idx]!))) continue

    const groupId = nanoid()
    assignments.set(mainIndex, { groupId, role: 'main' })
    for (const idx of indices.slice(1)) {
      const overrides = diffOverrides(mainNode, children[idx]!)
      assignments.set(idx, { groupId, role: 'instance', ...(overrides ? { overrides } : {}) })
    }
  }

  return assignments
}

export interface RecognizedComponentCandidate {
  selector: string
  name: string
  tag: string
  classes: string[]
  instances: number
  width: number
  height: number
  confidence: number
  pageBox?: { x: number; y: number; width: number; height: number }
}

const RECOGNITION_STYLE_KEYS = [
  'display',
  'position',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'gap',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'box-shadow',
  'animation-name'
] as const

function recognitionSignature(node: DomSnapshotNode): string {
  if (isTextLeaf(node)) return 'text'
  if (node.asset) return `asset:${node.asset.kind}`
  const semanticClass = pickSemanticClass(node.classes) ?? ''
  const styles = RECOGNITION_STYLE_KEYS.map((key) => node.computedStyle[key] ?? '').join('|')
  const children = (node.children ?? []).map(recognitionSignature).join(',')
  return `${node.tag}.${semanticClass}{${styles}}[${children}]`
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(2, Math.max(Math.abs(a), Math.abs(b)) * 0.06)
}

function hasCompatibleGeometry(a: DomSnapshotNode, b: DomSnapshotNode): boolean {
  // Text is component content, not component geometry. Repeated cards with
  // identical structure routinely have labels of very different lengths
  // ("Orders" vs "Financial and procurement activity"). Comparing their
  // glyph boxes rejected a real component family even though the card,
  // image slot and all styles were identical.
  if (isTextLeaf(a) && isTextLeaf(b)) return true
  if (!nearlyEqual(a.box.width, b.box.width) || !nearlyEqual(a.box.height, b.box.height)) return false
  const aChildren = a.children ?? []
  const bChildren = b.children ?? []
  if (aChildren.length !== bChildren.length) return false
  return aChildren.every((child, index) => hasCompatibleGeometry(child, bChildren[index]!))
}

function isUsefulCandidateRoot(node: DomSnapshotNode, parent: DomSnapshotNode): boolean {
  if (!node.sourceSelector || isTextLeaf(node) || node.asset) return false
  if (node.box.width < 16 || node.box.height < 12) return false
  // Infinite marquees/carousels commonly duplicate one oversized animated
  // strip. Those siblings are implementation machinery, not reusable UI
  // components (GitHub's logo marquee produced two 2473×32 false positives).
  const animationName = node.computedStyle['animation-name']?.trim()
  if (animationName && animationName !== 'none') return false
  if (parent.box.width > 0 && node.box.width > parent.box.width * 1.8) return false
  const tag = node.tag.toLowerCase()
  return Boolean(pickSemanticClass(node.classes)) || ['button', 'a', 'input', 'select', 'textarea'].includes(tag) || (node.children?.length ?? 0) >= 2
}

/**
 * Отдельный read-only проход распознавания для вкладки «Компоненты».
 * В отличие от legacy detectComponentGroups результат — только инвентарь:
 * он никогда не попадает в Design AST и не может сам создать Component.
 */
export function detectComponentCandidates(root: DomSnapshotNode): RecognizedComponentCandidate[] {
  const result = new Map<string, RecognizedComponentCandidate>()

  const visit = (parent: DomSnapshotNode): void => {
    const bySignature = new Map<string, DomSnapshotNode[]>()
    for (const child of parent.children ?? []) {
      if (!isUsefulCandidateRoot(child, parent)) continue
      const signature = recognitionSignature(child)
      const group = bySignature.get(signature)
      if (group) group.push(child)
      else bySignature.set(signature, [child])
    }

    for (const [signature, group] of bySignature) {
      if (group.length < 2) continue
      const representative = group[0]!
      const compatible = group.filter((node) => hasCompatibleGeometry(representative, node))
      if (compatible.length < 2) continue
      const semanticClass = pickSemanticClass(representative.classes)
      const candidate: RecognizedComponentCandidate = {
        selector: representative.sourceSelector!,
        name: semanticClass ?? representative.tag,
        tag: representative.tag,
        classes: representative.classes,
        instances: compatible.length,
        width: Math.round(representative.box.width),
        height: Math.round(representative.box.height),
        confidence: Math.min(0.99, 0.72 + Math.min(compatible.length, 6) * 0.035 + (semanticClass ? 0.06 : 0)),
        ...(representative.pageBox ? { pageBox: representative.pageBox } : {})
      }
      const key = `${signature}:${candidate.width}x${candidate.height}`
      const existing = result.get(key)
      if (!existing || existing.instances < candidate.instances) result.set(key, candidate)
    }

    for (const child of parent.children ?? []) visit(child)
  }

  visit(root)
  return [...result.values()].sort((a, b) => b.confidence - a.confidence || b.instances - a.instances)
}
