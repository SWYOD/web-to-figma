import { describe, expect, it } from 'vitest'
import { detectComponentGroups } from './componentGroups'
import { convertElement } from './convertElement'
import type { DomSnapshotNode } from './domSnapshot'

function baseStyle(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    display: 'block',
    position: 'static',
    'padding-top': '0px',
    'padding-right': '0px',
    'padding-bottom': '0px',
    'padding-left': '0px',
    'background-color': 'rgba(0, 0, 0, 0)',
    'border-top-width': '0px',
    'border-top-style': 'none',
    'border-top-color': 'rgb(0, 0, 0)',
    'border-top-left-radius': '0px',
    'border-top-right-radius': '0px',
    'border-bottom-right-radius': '0px',
    'border-bottom-left-radius': '0px',
    'box-shadow': 'none',
    opacity: '1',
    transform: 'none',
    'font-family': 'Inter, sans-serif',
    'font-size': '14px',
    'font-weight': '400',
    'line-height': 'normal',
    'letter-spacing': 'normal',
    'text-align': 'start',
    'text-transform': 'none',
    color: 'rgb(0, 0, 0)',
    ...overrides
  }
}

function node(overrides: Partial<DomSnapshotNode> & { tag: string; box: DomSnapshotNode['box'] }): DomSnapshotNode {
  return {
    id: null,
    classes: [],
    computedStyle: baseStyle(),
    ...overrides
  }
}

/** Карточка: <div class="card"><h3>title</h3><span>text</span></div>. */
function card(title: string, body: string, classes: string[] = ['card']): DomSnapshotNode {
  return node({
    tag: 'div',
    classes,
    box: { width: 200, height: 100, x: 0, y: 0 },
    children: [
      node({ tag: 'h3', box: { width: 180, height: 20, x: 0, y: 0 }, text: title }),
      node({ tag: 'span', box: { width: 180, height: 20, x: 0, y: 24 }, text: body })
    ]
  })
}

describe('detectComponentGroups', () => {
  it('groups 2+ structurally identical siblings as main + instance(s)', () => {
    const children = [card('Alpha', 'one'), card('Beta', 'two'), card('Gamma', 'three')]
    const assignments = detectComponentGroups(children)
    expect(assignments.size).toBe(3)
    expect(assignments.get(0)).toEqual({ groupId: expect.any(String), role: 'main' })
    const groupId = assignments.get(0)!.groupId
    expect(assignments.get(1)?.groupId).toBe(groupId)
    expect(assignments.get(2)?.groupId).toBe(groupId)
    expect(assignments.get(1)?.role).toBe('instance')
    expect(assignments.get(2)?.role).toBe('instance')
  })

  it('captures text overrides relative to the main, keyed by child-index path', () => {
    const children = [card('Alpha', 'one'), card('Beta', 'two')]
    const assignments = detectComponentGroups(children)
    const instance = assignments.get(1)!
    expect(instance.overrides?.text).toEqual({ '0': 'Beta', '1': 'two' })
  })

  it('does not group a single unmatched node (needs >=2)', () => {
    const children = [card('Alpha', 'one'), node({ tag: 'div', box: { width: 50, height: 50, x: 0, y: 0 } })]
    const assignments = detectComponentGroups(children)
    expect(assignments.size).toBe(0)
  })

  it('does not group structurally different siblings', () => {
    const children = [
      card('Alpha', 'one'),
      node({ tag: 'div', classes: ['card'], box: { width: 200, height: 100, x: 0, y: 0 }, children: [node({ tag: 'h3', box: { width: 180, height: 20, x: 0, y: 0 }, text: 'Only a heading' })] })
    ]
    const assignments = detectComponentGroups(children)
    expect(assignments.size).toBe(0)
  })

  it('excludes pure text leaves from grouping even when repeated', () => {
    const children = [
      node({ tag: 'li', box: { width: 100, height: 20, x: 0, y: 0 }, text: 'one' }),
      node({ tag: 'li', box: { width: 100, height: 20, x: 0, y: 20 }, text: 'two' })
    ]
    const assignments = detectComponentGroups(children)
    expect(assignments.size).toBe(0)
  })

  it('captures asset overrides by assetId, not by visual content', () => {
    const withAsset = (assetId: string): DomSnapshotNode =>
      node({
        tag: 'div',
        classes: ['icon-card'],
        box: { width: 60, height: 60, x: 0, y: 0 },
        children: [node({ tag: 'img', box: { width: 40, height: 40, x: 0, y: 0 }, asset: { assetId, kind: 'raster' } })]
      })
    const assignments = detectComponentGroups([withAsset('asset-1'), withAsset('asset-2')])
    expect(assignments.get(1)?.overrides?.assets).toEqual({ '0': 'asset-2' })
  })
})

describe('convertElement: component recognition wiring', () => {
  it('attaches componentRef to children converted from a repeated-siblings group', () => {
    const parent = node({
      tag: 'div',
      box: { width: 620, height: 100, x: 0, y: 0 },
      computedStyle: baseStyle({ display: 'flex', 'flex-direction': 'row' }),
      children: [card('Alpha', 'one'), card('Beta', 'two'), card('Gamma', 'three')]
    })
    const { node: result } = convertElement(parent)
    const [first, second, third] = result.children!
    expect(first!.componentRef?.role).toBe('main')
    expect(second!.componentRef?.role).toBe('instance')
    expect(third!.componentRef?.role).toBe('instance')
    expect(second!.componentRef?.groupId).toBe(first!.componentRef?.groupId)
  })

  it('does not attach componentRef to unrelated single children', () => {
    const parent = node({
      tag: 'div',
      box: { width: 300, height: 100, x: 0, y: 0 },
      computedStyle: baseStyle({ display: 'flex' }),
      children: [card('Alpha', 'one'), node({ tag: 'footer', box: { width: 300, height: 20, x: 0, y: 100 }, text: 'Footer' })]
    })
    const { node: result } = convertElement(parent)
    for (const child of result.children!) {
      expect(child.componentRef).toBeUndefined()
    }
  })

  it('detects nested repeats independently at each level', () => {
    const iconRow = (n: number): DomSnapshotNode =>
      node({
        tag: 'div',
        classes: ['icon-row'],
        box: { width: 100, height: 20, x: 0, y: 0 },
        children: [
          node({ tag: 'img', box: { width: 16, height: 16, x: 0, y: 0 }, asset: { assetId: `icon-${n}-a`, kind: 'svg' } }),
          node({ tag: 'img', box: { width: 16, height: 16, x: 20, y: 0 }, asset: { assetId: `icon-${n}-b`, kind: 'svg' } })
        ]
      })
    const cardWithIcons = (n: number): DomSnapshotNode =>
      node({
        tag: 'div',
        classes: ['card'],
        box: { width: 200, height: 100, x: 0, y: 0 },
        children: [iconRow(n)]
      })
    const parent = node({
      tag: 'div',
      box: { width: 420, height: 100, x: 0, y: 0 },
      computedStyle: baseStyle({ display: 'flex' }),
      children: [cardWithIcons(1), cardWithIcons(2)]
    })
    const { node: result } = convertElement(parent)
    const [firstCard, secondCard] = result.children!
    expect(firstCard!.componentRef?.role).toBe('main')
    expect(secondCard!.componentRef?.role).toBe('instance')
    // Иконки внутри КАЖДОЙ карточки — свой собственный, независимый уровень
    // группировки (два <img> одного kind — тоже структурно идентичны, раз
    // сигнатура ассета не включает конкретный assetId), с другим groupId,
    // чем у группировки самих карточек.
    const iconsInFirstCard = firstCard!.children![0]!.children!
    expect(iconsInFirstCard[0]!.componentRef?.role).toBe('main')
    expect(iconsInFirstCard[1]!.componentRef?.role).toBe('instance')
    expect(iconsInFirstCard[0]!.componentRef?.groupId).not.toBe(firstCard!.componentRef?.groupId)
  })
})
