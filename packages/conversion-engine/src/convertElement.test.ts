import { describe, expect, it } from 'vitest'
import { DesignNodeSchema } from '@web-to-figma/design-ast'
import { convertElement } from './convertElement'
import type { DomSnapshotNode } from './domSnapshot'

function snapshot(overrides: Partial<DomSnapshotNode> = {}): DomSnapshotNode {
  return {
    tag: 'div',
    id: null,
    classes: [],
    box: { width: 200, height: 40 },
    computedStyle: {
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
      ...overrides.computedStyle
    },
    ...overrides
  }
}

describe('convertElement', () => {
  it('produces a node that validates against DesignNodeSchema (fixture: basic frame)', () => {
    const { node } = convertElement(snapshot())
    expect(DesignNodeSchema.safeParse(node).success).toBe(true)
  })

  it('omits fills for a transparent background', () => {
    const { node } = convertElement(snapshot())
    expect(node.fills).toBeUndefined()
  })

  it('produces a solid fill for an opaque background (fixture: filled card)', () => {
    const { node } = convertElement(snapshot({ computedStyle: { 'background-color': 'rgb(24, 24, 27)' } }))
    expect(node.fills).toEqual([{ type: 'solid', color: { r: 24 / 255, g: 24 / 255, b: 27 / 255, a: 1 } }])
  })

  it('collapses uniform corner radius to a single number', () => {
    const { node } = convertElement(
      snapshot({
        computedStyle: {
          'border-top-left-radius': '8px',
          'border-top-right-radius': '8px',
          'border-bottom-right-radius': '8px',
          'border-bottom-left-radius': '8px'
        }
      })
    )
    expect(node.cornerRadius).toBe(8)
  })

  it('keeps per-corner radius when corners differ', () => {
    const { node } = convertElement(
      snapshot({
        computedStyle: {
          'border-top-left-radius': '8px',
          'border-top-right-radius': '0px',
          'border-bottom-right-radius': '8px',
          'border-bottom-left-radius': '0px'
        }
      })
    )
    expect(node.cornerRadius).toEqual({ topLeft: 8, topRight: 0, bottomRight: 8, bottomLeft: 0 })
  })

  it('fixture 6 (unsupported transform): flags a diagnostic but still produces a valid node, not a thrown error', () => {
    const { node, diagnostics } = convertElement(
      snapshot({ computedStyle: { transform: 'matrix(1.2, 0.3, -0.3, 1.2, 10, 5)' } })
    )
    expect(DesignNodeSchema.safeParse(node).success).toBe(true)
    expect(diagnostics.some((d) => d.code === 'transform-not-applied')).toBe(true)
  })

  it('names the node after id, then first class, then uppercase tag', () => {
    expect(convertElement(snapshot({ id: 'submit-btn' })).node.name).toBe('submit-btn')
    expect(convertElement(snapshot({ classes: ['btn-primary'] })).node.name).toBe('btn-primary')
    expect(convertElement(snapshot({ tag: 'button' })).node.name).toBe('BUTTON')
  })
})
