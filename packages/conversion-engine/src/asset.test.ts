import { describe, expect, it } from 'vitest'
import { DesignNodeSchema } from '@web-to-figma/design-ast'
import { convertElement } from './convertElement'
import type { DomSnapshotNode } from './domSnapshot'

function style(overrides: Record<string, string> = {}): Record<string, string> {
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

describe('convertElement: asset-backed nodes (Phase 9)', () => {
  it('a snapshot with a raster asset produces type:image with the asset reference', () => {
    const snapshot: DomSnapshotNode = {
      tag: 'img',
      id: null,
      classes: [],
      box: { width: 64, height: 64, x: 0, y: 0 },
      computedStyle: style(),
      asset: { assetId: 'asset-1', kind: 'raster' }
    }
    const { node } = convertElement(snapshot)
    expect(node.type).toBe('image')
    expect(node.asset).toEqual({ assetId: 'asset-1' })
    expect(DesignNodeSchema.safeParse(node).success).toBe(true)
  })

  it('a snapshot with an svg asset produces type:vector', () => {
    const snapshot: DomSnapshotNode = {
      tag: 'svg',
      id: null,
      classes: [],
      box: { width: 24, height: 24, x: 0, y: 0 },
      computedStyle: style(),
      asset: { assetId: 'asset-2', kind: 'svg' }
    }
    const { node } = convertElement(snapshot)
    expect(node.type).toBe('vector')
    expect(node.asset).toEqual({ assetId: 'asset-2' })
  })

  it('a plain node without an asset stays type:frame with no asset field', () => {
    const snapshot: DomSnapshotNode = {
      tag: 'div',
      id: null,
      classes: [],
      box: { width: 100, height: 50, x: 0, y: 0 },
      computedStyle: style()
    }
    const { node } = convertElement(snapshot)
    expect(node.type).toBe('frame')
    expect(node.asset).toBeUndefined()
  })
})
