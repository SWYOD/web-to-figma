import { describe, expect, it } from 'vitest'
import { DesignNodeSchema } from '@web-to-figma/design-ast'
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

function node(tag: string, box: DomSnapshotNode['box'], style: Record<string, string>, children?: DomSnapshotNode[]): DomSnapshotNode {
  return { tag, id: null, classes: [], box, computedStyle: baseStyle(style), ...(children ? { children } : {}) }
}

describe('convertElement: nested trees (Phase 8)', () => {
  it('fixture 4 (nested flex): recurses into children and preserves each level', () => {
    const outer = node(
      'div',
      { width: 300, height: 100, x: 0, y: 0 },
      { display: 'flex', 'flex-direction': 'row' },
      [
        node('div', { width: 100, height: 40, x: 10, y: 10 }, { display: 'flex', 'flex-direction': 'column' }, [
          node('span', { width: 50, height: 20, x: 0, y: 0 }, {})
        ])
      ]
    )
    const { node: result } = convertElement(outer)
    expect(result.layout!.mode).toBe('horizontal')
    expect(result.children).toHaveLength(1)
    const inner = result.children![0]!
    expect(inner.layout!.mode).toBe('vertical')
    expect(inner.children).toHaveLength(1)
    expect(DesignNodeSchema.safeParse(result).success).toBe(true)
  })

  it('fixture 3 (absolute badge): position:absolute child inside an Auto Layout parent keeps positioning:auto for the parent but gets explicit coordinates', () => {
    const parent = node('div', { width: 200, height: 80, x: 0, y: 0 }, { display: 'flex' }, [
      node('div', { width: 20, height: 20, x: 170, y: 5 }, { position: 'absolute' })
    ])
    const { node: result, diagnostics } = convertElement(parent)
    const badge = result.children![0]!
    expect(badge.layout!.positioning).toBe('absolute')
    expect(badge.layout!.absolute).toEqual({ x: 170, y: 5 })
    // Абсолютный ребёнок — не приближение, это ровно то, что просит CSS; никакого warning.
    expect(diagnostics.filter((d) => d.code === 'block-layout-approximated')).toHaveLength(0)
  })

  it('block-flow parent (no Auto Layout): children fall back to absolute placement with a diagnostic', () => {
    const parent = node('div', { width: 200, height: 100, x: 0, y: 0 }, { display: 'block' }, [
      node('p', { width: 180, height: 20, x: 10, y: 10 }, {}),
      node('p', { width: 180, height: 20, x: 10, y: 40 }, {})
    ])
    const { node: result, diagnostics } = convertElement(parent)
    expect(result.children).toHaveLength(2)
    for (const child of result.children!) {
      expect(child.layout!.positioning).toBe('absolute')
    }
    expect(diagnostics.filter((d) => d.code === 'block-layout-approximated')).toHaveLength(2)
  })

  it('does not approximate the root itself even though it has no parent (mode:none is not "approximated")', () => {
    const root = node('div', { width: 100, height: 50, x: 0, y: 0 }, { display: 'block' })
    const { diagnostics } = convertElement(root)
    expect(diagnostics).toHaveLength(0)
  })

  it('fixture 5 (pseudo-element): a materialized ::before is a regular child node', () => {
    const button = node('button', { width: 120, height: 40, x: 0, y: 0 }, { display: 'flex' }, [
      node(
        '::before',
        { width: 16, height: 16, x: 8, y: 12 },
        { 'background-color': 'rgb(255, 0, 0)', content: '""' }
      )
    ])
    const { node: result } = convertElement(button)
    expect(result.children).toHaveLength(1)
    const before = result.children![0]!
    expect(before.name).toBe('::BEFORE')
    expect(before.source?.cssSelector).toBe('::before')
    expect(before.fills).toEqual([{ type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } }])
  })

  it('fully recursive output still validates against DesignNodeSchema at every depth', () => {
    const tree = node('div', { width: 300, height: 200, x: 0, y: 0 }, { display: 'flex', 'flex-direction': 'column' }, [
      node('div', { width: 280, height: 60, x: 10, y: 10 }, { display: 'flex' }, [
        node('span', { width: 100, height: 20, x: 0, y: 0 }, {}),
        node('span', { width: 100, height: 20, x: 110, y: 0 }, { position: 'absolute' })
      ])
    ])
    const { node: result } = convertElement(tree)
    expect(DesignNodeSchema.safeParse(result).success).toBe(true)
  })
})
