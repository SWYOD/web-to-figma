import { describe, expect, it } from 'vitest'
import { toFigmaEffect, toFigmaEffects } from './effects'

describe('toFigmaEffect', () => {
  it('maps drop-shadow', () => {
    const result = toFigmaEffect({
      type: 'drop-shadow',
      color: { r: 0, g: 0, b: 0, a: 0.2 },
      offsetX: 0,
      offsetY: 2,
      blur: 4,
      spread: 0
    })
    expect(result).toEqual({
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.2 },
      offset: { x: 0, y: 2 },
      radius: 4,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL'
    })
  })

  it('maps inner-shadow', () => {
    const result = toFigmaEffect({
      type: 'inner-shadow',
      color: { r: 0, g: 0, b: 0, a: 0.2 },
      offsetX: 0,
      offsetY: 1,
      blur: 2
    })
    expect(result.type).toBe('INNER_SHADOW')
  })

  it('maps blur effects with the blurType Figma now requires', () => {
    expect(toFigmaEffect({ type: 'layer-blur', radius: 8 })).toEqual({
      type: 'LAYER_BLUR',
      blurType: 'NORMAL',
      radius: 8,
      visible: true
    })
    expect(toFigmaEffect({ type: 'background-blur', radius: 8 }).type).toBe('BACKGROUND_BLUR')
  })
})

describe('toFigmaEffects', () => {
  it('maps a list preserving order', () => {
    const result = toFigmaEffects([
      { type: 'layer-blur', radius: 4 },
      { type: 'background-blur', radius: 8 }
    ])
    expect(result.map((e) => e.type)).toEqual(['LAYER_BLUR', 'BACKGROUND_BLUR'])
  })
})
