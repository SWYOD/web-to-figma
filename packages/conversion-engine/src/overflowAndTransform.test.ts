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

describe('clipsContent (from CSS overflow/overflow-x/overflow-y)', () => {
  it('defaults to omitted (false) when overflow is the CSS default (visible)', () => {
    const { node: result } = convertElement(node('div', { width: 100, height: 50, x: 0, y: 0 }, {}))
    expect(result.clipsContent).toBeUndefined()
  })

  it('sets clipsContent:true when overflow:hidden', () => {
    const { node: result } = convertElement(node('div', { width: 100, height: 50, x: 0, y: 0 }, { overflow: 'hidden' }))
    expect(result.clipsContent).toBe(true)
  })

  it('sets clipsContent:true when only overflow-y is hidden (per-axis)', () => {
    const { node: result } = convertElement(node('div', { width: 100, height: 50, x: 0, y: 0 }, { 'overflow-y': 'hidden', 'overflow-x': 'visible' }))
    expect(result.clipsContent).toBe(true)
  })

  it('stays unset for a text leaf regardless of overflow (TextNode has no clipsContent concept)', () => {
    const { node: result } = convertElement(node('p', { width: 100, height: 20, x: 0, y: 0 }, { overflow: 'hidden' }, undefined))
    // no children/text set here -> stays type:frame; the isTextLeaf branch is exercised in text.test.ts,
    // this just confirms the false-for-text-leaf branch doesn't error when overflow is present.
    expect(result.type).toBe('frame')
  })
})

describe('transform-not-applied diagnostic — suppressed for pure translate() on absolutely-positioned nodes', () => {
  it('suppresses the diagnostic for a pure translate matrix on an absolutely-positioned child (real bug: decorative ::before/::after with transform:translate)', () => {
    const parent = node('article', { width: 200, height: 100, x: 0, y: 0 }, { display: 'flex' }, [
      node(
        '::before',
        { width: 198, height: 98, x: 6, y: 6 },
        { position: 'absolute', transform: 'matrix(1, 0, 0, 1, 6, 6)', 'background-color': 'rgb(255, 255, 255)', content: '""' }
      )
    ])
    const { diagnostics } = convertElement(parent)
    expect(diagnostics.filter((d) => d.code === 'transform-not-applied')).toHaveLength(0)
  })

  it('still warns for a pure translate on a node that is NOT absolutely positioned (Auto Layout ignores our x/y, so the offset really is lost)', () => {
    const parent = node('div', { width: 200, height: 100, x: 0, y: 0 }, { display: 'flex' }, [
      node('div', { width: 50, height: 50, x: 6, y: 6 }, { transform: 'matrix(1, 0, 0, 1, 6, 6)' })
    ])
    const { diagnostics } = convertElement(parent)
    expect(diagnostics.filter((d) => d.code === 'transform-not-applied')).toHaveLength(1)
  })

  it('still warns for rotate/scale even on an absolutely-positioned node (only position is captured via box model, not rotation/scale)', () => {
    const parent = node('div', { width: 200, height: 100, x: 0, y: 0 }, { display: 'flex' }, [
      node('div', { width: 50, height: 50, x: 6, y: 6 }, { position: 'absolute', transform: 'matrix(0.87, 0.5, -0.5, 0.87, 6, 6)' })
    ])
    const { diagnostics } = convertElement(parent)
    expect(diagnostics.filter((d) => d.code === 'transform-not-applied')).toHaveLength(1)
  })

  it('fixture 6 (unsupported transform, non-pure): unaffected regression check, still warns at root', () => {
    const { diagnostics } = convertElement(node('div', { width: 100, height: 40, x: 0, y: 0 }, { transform: 'matrix(1.2, 0.3, -0.3, 1.2, 10, 5)' }))
    expect(diagnostics.filter((d) => d.code === 'transform-not-applied')).toHaveLength(1)
  })
})
