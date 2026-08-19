import { describe, expect, it } from 'vitest'
import { DesignNodeSchema } from '@web-to-figma/design-ast'
import { convertElement } from './convertElement'
import type { DomSnapshotNode } from './domSnapshot'

function snapshot(overrides: Partial<DomSnapshotNode> = {}): DomSnapshotNode {
  return {
    tag: 'p',
    id: null,
    classes: [],
    box: { width: 200, height: 24, x: 0, y: 0 },
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

describe('convertElement — text leaves (fixture: pure-text leaf, e.g. <h3>/<p>/<a>)', () => {
  it('produces type:text with the captured text', () => {
    const { node } = convertElement(snapshot({ text: 'Hello heading' }))
    expect(node.type).toBe('text')
    expect(node.text).toBe('Hello heading')
  })

  it('validates against DesignNodeSchema', () => {
    const { node } = convertElement(snapshot({ text: 'Some text' }))
    expect(DesignNodeSchema.safeParse(node).success).toBe(true)
  })

  it('uses CSS color (not background-color) as fills — Figma TextNode.fills is glyph color', () => {
    const { node } = convertElement(
      snapshot({ text: 'Colored text', computedStyle: { color: 'rgb(200, 10, 10)', 'background-color': 'rgba(0,0,0,0)' } })
    )
    expect(node.fills).toEqual([{ type: 'solid', color: { r: 200 / 255, g: 10 / 255, b: 10 / 255, a: 1 } }])
  })

  it('flags a diagnostic (not silent loss) when a text leaf also has an opaque background-color', () => {
    const { diagnostics } = convertElement(snapshot({ text: 'Badge', computedStyle: { 'background-color': 'rgb(30, 30, 30)' } }))
    expect(diagnostics.some((d) => d.code === 'text-background-dropped')).toBe(true)
  })

  it('never produces children for a text node, even if the snapshot carried some (defensive)', () => {
    const { node } = convertElement(
      snapshot({ text: 'leaf', children: [snapshot({ tag: 'span', text: 'nested' })] })
    )
    expect(node.children).toBeUndefined()
  })

  it('stays type:frame (no text field) when snapshot.text is absent — no regression for non-text elements', () => {
    const { node } = convertElement(snapshot({ text: undefined }))
    expect(node.type).toBe('frame')
    expect(node.text).toBeUndefined()
  })
})

describe('convertElement — mixed inline content (fixture: <p>Some <b>x</b> text</p>)', () => {
  it('flags mixed-inline-text-not-captured when droppedInlineText is set, and does not become type:text', () => {
    const { node, diagnostics } = convertElement(
      snapshot({
        text: undefined,
        droppedInlineText: true,
        children: [snapshot({ tag: 'b', text: 'x' })]
      })
    )
    expect(node.type).toBe('frame')
    expect(diagnostics.some((d) => d.code === 'mixed-inline-text-not-captured')).toBe(true)
    // The nested pure-text <b> still converts normally as its own text child.
    expect(node.children?.[0]?.type).toBe('text')
    expect(node.children?.[0]?.text).toBe('x')
  })
})
