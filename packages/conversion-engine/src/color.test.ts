import { describe, expect, it } from 'vitest'
import { isTransparent, parseColor } from './color'

describe('parseColor', () => {
  it('parses rgb()', () => {
    expect(parseColor('rgb(24, 24, 27)')).toEqual({ r: 24 / 255, g: 24 / 255, b: 27 / 255, a: 1 })
  })

  it('parses rgba() with alpha', () => {
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
  })

  it('falls back to transparent black on garbage input', () => {
    expect(parseColor('not-a-color')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('detects transparency', () => {
    expect(isTransparent(parseColor('rgba(0, 0, 0, 0)'))).toBe(true)
    expect(isTransparent(parseColor('rgb(255, 255, 255)'))).toBe(false)
  })
})
