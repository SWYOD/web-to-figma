import { describe, expect, it } from 'vitest'
import { detectComponentCandidates, detectComponentGroups } from './componentGroups'
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

  it('targets the synthetic Text child when a visual text container is promoted to Frame + Text', () => {
    const fact = (icon: string, label: string): DomSnapshotNode =>
      node({
        tag: 'div',
        classes: ['fact'],
        box: { width: 130, height: 147, x: 0, y: 0 },
        children: [
          node({
            tag: 'div',
            classes: ['fact-icon'],
            box: { width: 64, height: 64, x: 33, y: 15 },
            text: icon,
            textBox: { width: 20, height: 29, x: 22, y: 1 },
            computedStyle: baseStyle({ display: 'grid', 'border-top-width': '1px', 'border-top-left-radius': '50px' })
          }),
          node({ tag: '#text', box: { width: 113, height: 39, x: 8, y: 93 }, text: label })
        ]
      })

    const assignments = detectComponentGroups([fact('◷', 'Занятия'), fact('45', '45 мест')])
    expect(assignments.get(1)?.overrides?.text).toEqual({ '0.0': '45', '1': '45 мест' })
  })

  it('does not create instances when changed text has different captured geometry', () => {
    const visualIcon = (text: string, width: number): DomSnapshotNode =>
      node({
        tag: 'div',
        classes: ['fact-icon'],
        box: { width: 64, height: 64, x: 0, y: 0 },
        text,
        textBox: { width, height: 29, x: 20, y: 1 },
        computedStyle: baseStyle({ display: 'grid', 'border-top-width': '1px', 'border-top-left-radius': '50px' })
      })
    const fact = (icon: DomSnapshotNode): DomSnapshotNode =>
      node({ tag: 'div', classes: ['fact'], box: { width: 130, height: 147, x: 0, y: 0 }, children: [icon] })

    const assignments = detectComponentGroups([fact(visualIcon('◷', 20)), fact(visualIcon('45', 26))])
    expect(assignments.size).toBe(0)
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

describe('separate component recognition inventory', () => {
  it('ordinary conversion never attaches renderer instructions', () => {
    const parent = node({
      tag: 'div',
      box: { width: 620, height: 100, x: 0, y: 0 },
      computedStyle: baseStyle({ display: 'flex', 'flex-direction': 'row' }),
      children: [card('Alpha', 'one'), card('Beta', 'two'), card('Gamma', 'three')]
    })
    const { node: result } = convertElement(parent)
    expect(result.children).toHaveLength(3)
    expect(result.children?.every((child) => child.componentRef === undefined)).toBe(true)
  })

  it('reports repeated candidates as metadata for the panel', () => {
    const first = card('Alpha', 'one')
    const second = card('Beta', 'two')
    first.sourceSelector = 'main > div:nth-child(1)'
    second.sourceSelector = 'main > div:nth-child(2)'
    const parent = node({
      tag: 'main',
      box: { width: 420, height: 100, x: 0, y: 0 },
      computedStyle: baseStyle({ display: 'flex' }),
      children: [first, second]
    })
    expect(detectComponentCandidates(parent)).toEqual([
      expect.objectContaining({ selector: 'main > div:nth-child(1)', name: 'card', instances: 2, width: 200, height: 100 })
    ])
  })

  it('recognizes repeated cards when text content has different glyph geometry', () => {
    const documentCard = (title: string, titleWidth: number, count: string): DomSnapshotNode =>
      node({
        tag: 'a',
        classes: ['card', 'tw:grid'],
        sourceSelector: `#documents > a:nth-child(${count})`,
        box: { width: 200, height: 140, x: 0, y: 0 },
        computedStyle: baseStyle({ display: 'grid', 'padding-top': '20px', 'padding-bottom': '20px' }),
        children: [
          node({ tag: 'img', box: { width: 64, height: 64, x: 68, y: 20 }, asset: { assetId: '', kind: 'raster' } }),
          node({ tag: 'span', box: { width: titleWidth, height: titleWidth > 120 ? 36 : 18, x: 20, y: 90 }, text: title }),
          node({ tag: 'span', box: { width: 90, height: 18, x: 55, y: 118 }, text: `${count} documents` })
        ]
      })

    const root = node({
      tag: 'div',
      classes: ['grid'],
      box: { width: 640, height: 140, x: 0, y: 0 },
      children: [
        documentCard('Orders', 52, '2'),
        documentCard('Financial and procurement activity', 168, '10'),
        documentCard('Occupational safety', 112, '4')
      ]
    })

    expect(detectComponentCandidates(root)).toEqual([
      expect.objectContaining({ name: 'card', tag: 'a', instances: 3, width: 200, height: 140 })
    ])
  })

  it('ignores duplicated animated marquee strips', () => {
    const strip = (selector: string): DomSnapshotNode =>
      node({
        tag: 'div',
        classes: ['logo-marquee'],
        sourceSelector: selector,
        box: { width: 2473, height: 32, x: -1100, y: 0 },
        computedStyle: baseStyle({ 'animation-name': 'marquee' }),
        children: [node({ tag: 'svg', box: { width: 270, height: 32, x: 0, y: 0 }, asset: { assetId: '', kind: 'svg' } })]
      })
    const root = node({
      tag: 'div',
      box: { width: 1200, height: 40, x: 0, y: 0 },
      children: [strip('.marquee:nth-child(1)'), strip('.marquee:nth-child(2)')]
    })

    expect(detectComponentCandidates(root)).toEqual([])
  })
})
