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

  it('marks actually single-line text as nowrap so Figma metrics cannot stack its glyphs', () => {
    const { node } = convertElement(
      snapshot({
        text: '45',
        box: { width: 29, height: 29, x: 0, y: 0 },
        computedStyle: { 'font-size': '25px', 'line-height': '36px' }
      })
    )
    expect(node.textWrap).toBe('nowrap')
  })

  it('keeps genuinely multi-line browser text constrained and wrappable', () => {
    const { node } = convertElement(
      snapshot({
        text: 'Занятия в удобное время',
        box: { width: 113, height: 39, x: 0, y: 0 },
        computedStyle: { 'font-size': '15px', 'line-height': '22px' }
      })
    )
    expect(node.textWrap).toBe('wrap')
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

  it('preserves an opaque text background by promoting the element to a frame', () => {
    const { node, diagnostics } = convertElement(
      snapshot({ text: 'Badge', computedStyle: { 'background-color': 'rgb(30, 30, 30)' } })
    )
    expect(node.type).toBe('frame')
    expect(node.children?.[0]).toMatchObject({ type: 'text', text: 'Badge' })
    expect(diagnostics.some((d) => d.code === 'text-background-dropped')).toBe(false)
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

describe('convertElement — mixed inline content, extraction failed (fixture: <p>text <img> text</p>)', () => {
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

describe('convertElement — mixed inline content, extraction succeeded (fixture: <p>Some <b>x</b> text</p> → textRuns)', () => {
  it('produces type:text with textRuns (not the plain text field) when snapshot.textRuns is present', () => {
    const { node } = convertElement(
      snapshot({
        text: undefined,
        textRuns: [
          { text: 'Some ', style: { color: 'rgb(0, 0, 0)', 'font-weight': '400' } },
          { text: 'x', style: { color: 'rgb(0, 0, 0)', 'font-weight': '700' } },
          { text: ' text', style: { color: 'rgb(0, 0, 0)', 'font-weight': '400' } }
        ]
      })
    )
    expect(node.type).toBe('text')
    expect(node.text).toBeUndefined()
    expect(node.textRuns).toHaveLength(3)
    expect(node.textRuns?.map((r) => r.text)).toEqual(['Some ', 'x', ' text'])
  })

  it('does NOT flag mixed-inline-text-not-captured — the content was actually captured, not dropped', () => {
    const { diagnostics } = convertElement(
      snapshot({
        text: undefined,
        textRuns: [{ text: 'x', style: {} }]
      })
    )
    expect(diagnostics.some((d) => d.code === 'mixed-inline-text-not-captured')).toBe(false)
  })

  it('parses each run typography/color independently from its OWN style, not the container style', () => {
    const { node } = convertElement(
      snapshot({
        text: undefined,
        computedStyle: { 'font-weight': '400', color: 'rgb(0, 0, 0)' },
        textRuns: [
          { text: 'bold red ', style: { 'font-weight': '700', color: 'rgb(255, 0, 0)', 'font-family': 'Inter, sans-serif', 'font-size': '14px' } },
          { text: 'plain', style: { 'font-weight': '400', color: 'rgb(0, 0, 0)', 'font-family': 'Inter, sans-serif', 'font-size': '14px' } }
        ]
      })
    )
    expect(node.textRuns?.[0]?.typography.fontWeight).toBe(700)
    expect(node.textRuns?.[0]?.color).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(node.textRuns?.[1]?.typography.fontWeight).toBe(400)
    expect(node.textRuns?.[1]?.color).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  })

  it('validates against DesignNodeSchema', () => {
    const { node } = convertElement(snapshot({ text: undefined, textRuns: [{ text: 'x', style: {} }] }))
    expect(DesignNodeSchema.safeParse(node).success).toBe(true)
  })

  it('never produces children — the flattened inline elements are already inside textRuns, not separate nodes', () => {
    const { node } = convertElement(
      snapshot({
        text: undefined,
        textRuns: [{ text: 'x', style: {} }],
        children: [snapshot({ tag: 'b', text: 'nested' })]
      })
    )
    expect(node.children).toBeUndefined()
  })
})

describe('convertElement — visually styled text containers', () => {
  it('keeps a text-only button as a frame and moves its label into a text child', () => {
    const { node, diagnostics } = convertElement(
      snapshot({
        tag: 'a',
        text: 'Подать заявку',
        box: { width: 191, height: 52, x: 20, y: 30 },
        textBox: { width: 113, height: 18, x: 59, y: 47 },
        computedStyle: {
          display: 'flex',
          'justify-content': 'center',
          'align-items': 'center',
          'padding-top': '0px',
          'padding-right': '25px',
          'padding-bottom': '0px',
          'padding-left': '25px',
          'background-color': 'rgb(0, 108, 150)',
          'border-top-width': '1px',
          'border-top-style': 'solid',
          'border-top-color': 'rgb(0, 108, 150)',
          'border-top-left-radius': '10px',
          'border-top-right-radius': '10px',
          'border-bottom-right-radius': '10px',
          'border-bottom-left-radius': '10px',
          color: 'rgb(255, 255, 255)',
          'font-size': '15px',
          'font-weight': '600'
        }
      })
    )

    expect(node.type).toBe('frame')
    expect(node.fills).toEqual([{ type: 'solid', color: { r: 0, g: 108 / 255, b: 150 / 255, a: 1 } }])
    expect(node.strokes?.weight).toBe(1)
    expect(node.cornerRadius).toBe(10)
    expect(node.children).toHaveLength(1)
    expect(node.children?.[0]).toMatchObject({
      type: 'text',
      text: 'Подать заявку',
      size: { width: 113, height: 18 },
      layout: { widthSizing: 'hug', heightSizing: 'hug' }
    })
    expect(diagnostics.some((d) => d.code === 'text-background-dropped')).toBe(false)
    expect(DesignNodeSchema.safeParse(node).success).toBe(true)
  })

  it('preserves a materialized direct text node next to an element child', () => {
    const { node } = convertElement(
      snapshot({
        tag: 'div',
        children: [
          snapshot({ tag: 'div', text: '45', box: { width: 64, height: 64, x: 0, y: 0 } }),
          snapshot({ tag: '#text', text: 'Выпускные документы', box: { width: 180, height: 18, x: 0, y: 78 } })
        ]
      })
    )

    expect(node.type).toBe('frame')
    expect(node.children?.map((child) => child.text)).toEqual(['45', 'Выпускные документы'])
  })
})
