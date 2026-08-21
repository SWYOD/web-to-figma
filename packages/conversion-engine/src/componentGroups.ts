import { nanoid } from 'nanoid'
import type { ComponentRef } from '@web-to-figma/design-ast'
import type { DomSnapshotNode } from './domSnapshot.js'
import { pickSemanticClass } from './classHeuristics.js'

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
      text[path] = nodeText(inst)
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
    const groupId = nanoid()
    const mainIndex = indices[0]!
    const mainNode = children[mainIndex]!
    assignments.set(mainIndex, { groupId, role: 'main' })
    for (const idx of indices.slice(1)) {
      const overrides = diffOverrides(mainNode, children[idx]!)
      assignments.set(idx, { groupId, role: 'instance', ...(overrides ? { overrides } : {}) })
    }
  }

  return assignments
}
