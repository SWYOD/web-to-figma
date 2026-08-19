import { describe, expect, it } from 'vitest'
import { toFigmaPaint, toFigmaPaints } from './paint'

describe('toFigmaPaint', () => {
  it('maps a solid AST paint to a Figma SOLID paint, splitting alpha into opacity', () => {
    const result = toFigmaPaint({ type: 'solid', color: { r: 1, g: 0, b: 0, a: 0.5 } })
    expect(result).toEqual({ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: 0.5 })
  })

  it('returns null for paint kinds conversion-engine does not produce yet', () => {
    expect(toFigmaPaint({ type: 'linear-gradient', angleDeg: 0, stops: [] })).toBeNull()
    expect(toFigmaPaint({ type: 'radial-gradient', stops: [] })).toBeNull()
    expect(toFigmaPaint({ type: 'image', assetId: 'x', fit: 'fill' })).toBeNull()
  })
})

describe('toFigmaPaints', () => {
  it('drops unsupported paints instead of throwing', () => {
    const result = toFigmaPaints([
      { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } },
      { type: 'image', assetId: 'x', fit: 'fill' }
    ])
    expect(result).toHaveLength(1)
  })
})
