/// <reference types="@figma/plugin-typings" />
import { describe, expect, it } from 'vitest'
import { matchNearestSolidPaintStyle, matchNearestTextStyle } from './styleMatching'

function textStyle(fontSize: number, id = fontSize.toString()): TextStyle {
  return { id, fontSize } as unknown as TextStyle
}

function solidPaintStyle(r: number, g: number, b: number, opacity = 1, id = `${r},${g},${b}`): PaintStyle {
  return { id, paints: [{ type: 'SOLID', color: { r, g, b }, opacity }] } as unknown as PaintStyle
}

describe('matchNearestTextStyle', () => {
  it('picks the style with the closest fontSize', () => {
    const styles = [textStyle(12), textStyle(16), textStyle(24)]
    expect(matchNearestTextStyle(15, styles)?.fontSize).toBe(16)
    expect(matchNearestTextStyle(13, styles)?.fontSize).toBe(12)
    expect(matchNearestTextStyle(24, styles)?.fontSize).toBe(24)
  })

  it('returns null when there are no local text styles', () => {
    expect(matchNearestTextStyle(16, [])).toBeNull()
  })

  it('ties resolve to the first style encountered (stable, not random)', () => {
    const styles = [textStyle(10), textStyle(20)]
    expect(matchNearestTextStyle(15, styles)?.fontSize).toBe(10)
  })
})

describe('matchNearestSolidPaintStyle', () => {
  it('picks the style with the smallest RGBA distance', () => {
    const styles = [solidPaintStyle(1, 0, 0), solidPaintStyle(0, 1, 0), solidPaintStyle(0, 0, 1)]
    const match = matchNearestSolidPaintStyle({ r: 0.9, g: 0.05, b: 0.05, a: 1 }, styles)
    expect(match?.id).toBe('1,0,0')
  })

  it('accounts for alpha/opacity difference, not just RGB', () => {
    const styles = [solidPaintStyle(0, 0, 0, 1, 'opaque'), solidPaintStyle(0, 0, 0, 0.2, 'faint')]
    const match = matchNearestSolidPaintStyle({ r: 0, g: 0, b: 0, a: 0.25 }, styles)
    expect(match?.id).toBe('faint')
  })

  it('returns null when there are no local solid paint styles', () => {
    expect(matchNearestSolidPaintStyle({ r: 0, g: 0, b: 0, a: 1 }, [])).toBeNull()
  })
})
