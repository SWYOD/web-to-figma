import { describe, expect, it } from 'vitest'
import type { LayoutInfo } from '@web-to-figma/design-ast'
import { applyLayout } from './layout'

/** Достаточно полей FrameNode, которые трогает applyLayout — не весь Figma API. */
function mockFrame(): Record<string, unknown> {
  return {}
}

const baseLayout: LayoutInfo = {
  mode: 'horizontal',
  gap: 16,
  padding: { top: 8, right: 12, bottom: 8, left: 12 },
  align: 'center',
  justify: 'space-between',
  widthSizing: 'fixed',
  heightSizing: 'fixed',
  positioning: 'auto'
}

describe('applyLayout', () => {
  it('leaves a mode:none layout untouched (plain frame, no Auto Layout properties set)', () => {
    const frame = mockFrame()
    applyLayout(frame as never, { ...baseLayout, mode: 'none' })
    expect(frame).toEqual({})
  })

  it('fixture 1 (horizontal flex): maps mode/gap/padding/align/justify onto the Figma frame', () => {
    const frame = mockFrame()
    applyLayout(frame as never, baseLayout)
    expect(frame).toMatchObject({
      layoutMode: 'HORIZONTAL',
      layoutWrap: 'NO_WRAP',
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
      itemSpacing: 16,
      paddingTop: 8,
      paddingRight: 12,
      paddingBottom: 8,
      paddingLeft: 12,
      primaryAxisAlignItems: 'SPACE_BETWEEN',
      counterAxisAlignItems: 'CENTER'
    })
  })

  it('maps vertical mode to VERTICAL', () => {
    const frame = mockFrame()
    applyLayout(frame as never, { ...baseLayout, mode: 'vertical' })
    expect(frame.layoutMode).toBe('VERTICAL')
  })

  it('maps horizontal flex-wrap and row-gap to Figma WRAP/counterAxisSpacing', () => {
    const frame = mockFrame()
    applyLayout(frame as never, { ...baseLayout, wrap: true, rowGap: 7, columnGap: 12 })
    expect(frame.layoutWrap).toBe('WRAP')
    expect(frame.counterAxisSpacing).toBe(7)
  })

  it('maps justify start/end to Figma MIN/MAX', () => {
    const frameMin = mockFrame()
    applyLayout(frameMin as never, { ...baseLayout, justify: 'start' })
    expect(frameMin.primaryAxisAlignItems).toBe('MIN')

    const frameMax = mockFrame()
    applyLayout(frameMax as never, { ...baseLayout, justify: 'end' })
    expect(frameMax.primaryAxisAlignItems).toBe('MAX')
  })

  it('only allows BASELINE counter-axis alignment on horizontal layouts (Figma constraint)', () => {
    const horizontal = mockFrame()
    applyLayout(horizontal as never, { ...baseLayout, mode: 'horizontal', align: 'baseline' })
    expect(horizontal.counterAxisAlignItems).toBe('BASELINE')

    const vertical = mockFrame()
    applyLayout(vertical as never, { ...baseLayout, mode: 'vertical', align: 'baseline' })
    expect(vertical.counterAxisAlignItems).toBe('MIN')
  })

  it('falls back stretch/start align to MIN (no container-level STRETCH in Figma)', () => {
    const frame = mockFrame()
    applyLayout(frame as never, { ...baseLayout, align: 'stretch' })
    expect(frame.counterAxisAlignItems).toBe('MIN')
  })

  it('defaults gap to 0 when unset', () => {
    const frame = mockFrame()
    applyLayout(frame as never, { ...baseLayout, gap: undefined })
    expect(frame.itemSpacing).toBe(0)
  })
})
