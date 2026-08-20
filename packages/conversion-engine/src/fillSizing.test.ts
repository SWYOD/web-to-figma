import { describe, expect, it } from 'vitest'
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
    'flex-grow': '0',
    'align-self': 'auto',
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

function node(
  tag: string,
  box: DomSnapshotNode['box'],
  style: Record<string, string>,
  children?: DomSnapshotNode[],
  text?: string,
  authoredSizing?: DomSnapshotNode['authoredSizing']
): DomSnapshotNode {
  return {
    tag,
    id: null,
    classes: [],
    box,
    computedStyle: baseStyle(style),
    ...(children ? { children } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(authoredSizing ? { authoredSizing } : {})
  }
}

describe('fill sizing — main axis (flex-grow)', () => {
  it('flex-grow > 0 in a row container -> widthSizing:fill (width is the main axis)', () => {
    const parent = node('div', { width: 300, height: 100, x: 0, y: 0 }, { display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-start' }, [
      node('div', { width: 100, height: 40, x: 0, y: 0 }, { 'flex-grow': '1' })
    ])
    const { node: result } = convertElement(parent)
    expect(result.children![0]!.layout!.widthSizing).toBe('fill')
    expect(result.children![0]!.layout!.heightSizing).toBe('fixed')
  })

  it('flex-grow > 0 in a column container -> heightSizing:fill (height is the main axis)', () => {
    const parent = node('div', { width: 300, height: 100, x: 0, y: 0 }, { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start' }, [
      node('div', { width: 100, height: 40, x: 0, y: 0 }, { 'flex-grow': '1' })
    ])
    const { node: result } = convertElement(parent)
    expect(result.children![0]!.layout!.heightSizing).toBe('fill')
    expect(result.children![0]!.layout!.widthSizing).toBe('fixed')
  })

  it('flex-grow:0 (default) stays fixed on the main axis', () => {
    const parent = node('div', { width: 300, height: 100, x: 0, y: 0 }, { display: 'flex', 'align-items': 'flex-start' }, [
      node('div', { width: 100, height: 40, x: 0, y: 0 }, {})
    ])
    const { node: result } = convertElement(parent)
    expect(result.children![0]!.layout!.widthSizing).toBe('fixed')
  })
})

describe('fill sizing — cross axis (align-items:stretch, the CSS default)', () => {
  it('CSS default align-items (unset -> stretch) fills the cross axis: a column flex parent stretches child width', () => {
    const parent = node('div', { width: 300, height: 100, x: 0, y: 0 }, { display: 'flex', 'flex-direction': 'column' }, [
      node('p', { width: 300, height: 20, x: 0, y: 0 }, {}, undefined, 'Some paragraph text')
    ])
    const { node: result } = convertElement(parent)
    // the real bug this fixes: text leaves (h3/p/a) inside a flex-column card
    // should stretch to the card's content width, matching the browser default.
    expect(result.children![0]!.type).toBe('text')
    expect(result.children![0]!.layout!.widthSizing).toBe('fill')
  })

  it('explicit align-items:flex-start does NOT stretch the cross axis', () => {
    const parent = node('div', { width: 300, height: 100, x: 0, y: 0 }, { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start' }, [
      node('div', { width: 100, height: 20, x: 0, y: 0 }, {})
    ])
    const { node: result } = convertElement(parent)
    expect(result.children![0]!.layout!.widthSizing).toBe('fixed')
  })

  it('align-self overrides the parent align-items for that one child', () => {
    const parent = node('div', { width: 300, height: 100, x: 0, y: 0 }, { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start' }, [
      node('div', { width: 100, height: 20, x: 0, y: 0 }, { 'align-self': 'stretch' }),
      node('div', { width: 100, height: 20, x: 0, y: 20 }, { 'align-self': 'flex-start' })
    ])
    const { node: result } = convertElement(parent)
    expect(result.children![0]!.layout!.widthSizing).toBe('fill')
    expect(result.children![1]!.layout!.widthSizing).toBe('fixed')
  })
})

describe('fill sizing — scoping', () => {
  it('root node always stays fixed/fixed regardless of its own align-items/flex-grow (no parent to fill relative to)', () => {
    const { node: result } = convertElement(node('div', { width: 300, height: 100, x: 0, y: 0 }, { display: 'flex', 'flex-grow': '1' }))
    expect(result.layout!.widthSizing).toBe('fixed')
    expect(result.layout!.heightSizing).toBe('fixed')
  })

  it('children of a non-flex (block-layout-approximated) parent stay fixed -- fill only applies under a real Auto Layout parent', () => {
    const parent = node('div', { width: 300, height: 100, x: 0, y: 0 }, { display: 'block' }, [
      node('div', { width: 100, height: 20, x: 0, y: 0 }, { 'flex-grow': '1' })
    ])
    const { node: result } = convertElement(parent)
    expect(result.children![0]!.layout!.widthSizing).toBe('fixed')
    expect(result.children![0]!.layout!.heightSizing).toBe('fixed')
  })
})

describe('hug sizing — authored CSS (CSS.getMatchedStylesForNode)', () => {
  it('width not authored by any rule (no fill on that axis) -> widthSizing:hug', () => {
    const parent = node('div', { width: 300, height: 100, x: 0, y: 0 }, { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start' }, [
      node('div', { width: 80, height: 20, x: 0, y: 0 }, {}, undefined, undefined, { width: false, height: true })
    ])
    const { node: result } = convertElement(parent)
    expect(result.children![0]!.layout!.widthSizing).toBe('hug')
    expect(result.children![0]!.layout!.heightSizing).toBe('fixed')
  })

  it('fill takes precedence over hug on the same axis', () => {
    const parent = node('div', { width: 300, height: 100, x: 0, y: 0 }, { display: 'flex', 'flex-direction': 'row', 'align-items': 'flex-start' }, [
      node('div', { width: 100, height: 40, x: 0, y: 0 }, { 'flex-grow': '1' }, undefined, undefined, { width: false, height: false })
    ])
    const { node: result } = convertElement(parent)
    expect(result.children![0]!.layout!.widthSizing).toBe('fill')
  })

  it('authoredSizing absent (unknown, e.g. from a caller that never collected it) stays fixed, not hug', () => {
    const parent = node('div', { width: 300, height: 100, x: 0, y: 0 }, { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start' }, [
      node('div', { width: 80, height: 20, x: 0, y: 0 }, {})
    ])
    const { node: result } = convertElement(parent)
    expect(result.children![0]!.layout!.widthSizing).toBe('fixed')
  })

  it('width authored explicitly -> stays fixed, not hug', () => {
    const parent = node('div', { width: 300, height: 100, x: 0, y: 0 }, { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start' }, [
      node('div', { width: 80, height: 20, x: 0, y: 0 }, {}, undefined, undefined, { width: true, height: true })
    ])
    const { node: result } = convertElement(parent)
    expect(result.children![0]!.layout!.widthSizing).toBe('fixed')
  })
})
