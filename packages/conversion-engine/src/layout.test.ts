import { describe, expect, it } from 'vitest'
import { parseLayout } from './layout'

function style(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    display: 'block',
    'padding-top': '0px',
    'padding-right': '0px',
    'padding-bottom': '0px',
    'padding-left': '0px',
    ...overrides
  }
}

describe('parseLayout', () => {
  it('stays mode: none for non-flex containers', () => {
    expect(parseLayout(style(), 'n1', []).mode).toBe('none')
  })

  it('fixture 1: horizontal flex row -> layoutMode HORIZONTAL, gap from column-gap', () => {
    const layout = parseLayout(
      style({ display: 'flex', 'flex-direction': 'row', 'column-gap': '16px', 'row-gap': '4px' }),
      'n1',
      []
    )
    expect(layout.mode).toBe('horizontal')
    expect(layout.gap).toBe(16)
  })

  it('vertical flex column -> layoutMode VERTICAL, gap from row-gap', () => {
    const layout = parseLayout(
      style({ display: 'flex', 'flex-direction': 'column', 'column-gap': '4px', 'row-gap': '16px' }),
      'n1',
      []
    )
    expect(layout.mode).toBe('vertical')
    expect(layout.gap).toBe(16)
  })

  it('defaults flex-direction to row when unset', () => {
    expect(parseLayout(style({ display: 'flex' }), 'n1', []).mode).toBe('horizontal')
  })

  it('maps justify-content directly for start/center/end/space-between', () => {
    const j = (v: string) => parseLayout(style({ display: 'flex', 'justify-content': v }), 'n1', []).justify
    expect(j('flex-start')).toBe('start')
    expect(j('center')).toBe('center')
    expect(j('flex-end')).toBe('end')
    expect(j('space-between')).toBe('space-between')
  })

  it('approximates space-around/space-evenly to start with a diagnostic (no Figma equivalent)', () => {
    const diagnostics: import('@web-to-figma/design-ast').ConversionWarning[] = []
    const layout = parseLayout(style({ display: 'flex', 'justify-content': 'space-around' }), 'n1', diagnostics)
    expect(layout.justify).toBe('start')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('justify-content-approximated')

    const diagnostics2: import('@web-to-figma/design-ast').ConversionWarning[] = []
    parseLayout(style({ display: 'flex', 'justify-content': 'space-evenly' }), 'n1', diagnostics2)
    expect(diagnostics2).toHaveLength(1)
  })

  it('maps align-items, defaulting to stretch', () => {
    const a = (v?: string) => parseLayout(style({ display: 'flex', ...(v ? { 'align-items': v } : {}) }), 'n1', []).align
    expect(a('flex-start')).toBe('start')
    expect(a('center')).toBe('center')
    expect(a('flex-end')).toBe('end')
    expect(a('baseline')).toBe('baseline')
    expect(a(undefined)).toBe('stretch')
  })

  it('does not flag a diagnostic for plain space-between', () => {
    const diagnostics: import('@web-to-figma/design-ast').ConversionWarning[] = []
    parseLayout(style({ display: 'flex', 'justify-content': 'space-between' }), 'n1', diagnostics)
    expect(diagnostics).toHaveLength(0)
  })
})
