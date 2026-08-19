/// <reference types="@figma/plugin-typings" />
import { describe, expect, it, vi } from 'vitest'
import { matchColor, matchNearestColorVariable, matchNearestSolidPaintStyle, matchNearestTextStyle, weightToStyle } from './styleMatching'
import type { ColorVariableCandidate } from './styleMatching'

function textStyle(fontSize: number, styleName = 'Regular', id = `${fontSize}-${styleName}`): TextStyle {
  return { id, fontSize, fontName: { family: 'Inter', style: styleName } } as unknown as TextStyle
}

function solidPaintStyle(r: number, g: number, b: number, opacity = 1, id = `${r},${g},${b}`): PaintStyle {
  return { id, paints: [{ type: 'SOLID', color: { r, g, b }, opacity }] } as unknown as PaintStyle
}

function colorVariable(r: number, g: number, b: number, a = 1, id = `${r},${g},${b},${a}`): ColorVariableCandidate {
  return { variable: { id } as unknown as Variable, color: { r, g, b, a } }
}

describe('weightToStyle', () => {
  it('maps common CSS font-weight numbers to Figma style names', () => {
    expect(weightToStyle(400)).toBe('Regular')
    expect(weightToStyle(700)).toBe('Bold')
    expect(weightToStyle(600)).toBe('SemiBold')
    expect(weightToStyle(300)).toBe('Light')
    expect(weightToStyle(900)).toBe('Black')
  })
})

describe('matchNearestTextStyle', () => {
  it('picks the style with the closest fontSize among same-weight candidates', () => {
    const styles = [textStyle(12, 'Regular'), textStyle(16, 'Regular'), textStyle(24, 'Regular')]
    expect(matchNearestTextStyle(15, 400, styles)?.fontSize).toBe(16)
    expect(matchNearestTextStyle(13, 400, styles)?.fontSize).toBe(12)
    expect(matchNearestTextStyle(24, 400, styles)?.fontSize).toBe(24)
  })

  it('prioritizes matching weight over closer fontSize (the real bug this fixes)', () => {
    // A bold heading (24px/700) should NOT snap to a size-closer Regular
    // style just because it's numerically nearer in fontSize.
    const styles = [textStyle(22, 'Regular'), textStyle(14, 'Bold')]
    const match = matchNearestTextStyle(24, 700, styles)
    expect(match?.fontName.style).toBe('Bold')
  })

  it('falls back to closest fontSize when NO style matches the expected weight at all', () => {
    const styles = [textStyle(12, 'Regular'), textStyle(20, 'Regular')]
    const match = matchNearestTextStyle(18, 700, styles)
    expect(match?.fontSize).toBe(20)
  })

  it('matches weight names case-insensitively and as a substring (e.g. "Bold Italic")', () => {
    const styles = [textStyle(16, 'Regular'), textStyle(16, 'bold italic')]
    const match = matchNearestTextStyle(16, 700, styles)
    expect(match?.fontName.style).toBe('bold italic')
  })

  it('returns null when there are no local text styles', () => {
    expect(matchNearestTextStyle(16, 400, [])).toBeNull()
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

describe('matchNearestColorVariable', () => {
  it('picks the variable with the smallest RGBA distance', () => {
    const candidates = [colorVariable(1, 0, 0), colorVariable(0, 1, 0), colorVariable(0, 0, 1)]
    const match = matchNearestColorVariable({ r: 0.9, g: 0.05, b: 0.05, a: 1 }, candidates)
    expect(match?.id).toBe('1,0,0,1')
  })

  it('returns null when there are no local color variables', () => {
    expect(matchNearestColorVariable({ r: 0, g: 0, b: 0, a: 1 }, [])).toBeNull()
  })
})

describe('matchColor', () => {
  const catalog = {
    textStyles: [],
    solidPaintStyles: [solidPaintStyle(1, 1, 1, 1, 'white-style')],
    colorVariables: [colorVariable(1, 1, 1, 1, 'white-variable')]
  }

  it("source:'style' returns a styleId result", () => {
    const result = matchColor({ r: 1, g: 1, b: 1, a: 1 }, catalog, 'style')
    expect(result).toEqual({ kind: 'style', styleId: 'white-style' })
  })

  it("source:'style' returns null when no solid paint styles exist", () => {
    const result = matchColor({ r: 1, g: 1, b: 1, a: 1 }, { ...catalog, solidPaintStyles: [] }, 'style')
    expect(result).toBeNull()
  })

  it("source:'variable' returns a bound-paint result via figma.variables.setBoundVariableForPaint", () => {
    const boundPaint = { type: 'SOLID', color: { r: 1, g: 1, b: 1 }, boundVariables: { color: { id: 'white-variable' } } }
    const setBoundVariableForPaint = vi.fn().mockReturnValue(boundPaint)
    // @ts-expect-error -- minimal global figma stub for this test only
    globalThis.figma = { variables: { setBoundVariableForPaint } }

    const result = matchColor({ r: 1, g: 1, b: 1, a: 1 }, catalog, 'variable')
    expect(result?.kind).toBe('variable')
    expect(result && result.kind === 'variable' ? result.paint : null).toBe(boundPaint)
    expect(setBoundVariableForPaint).toHaveBeenCalledWith(
      { type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 },
      'color',
      catalog.colorVariables[0]!.variable
    )
  })

  it("source:'variable' returns null when no color variables exist", () => {
    const result = matchColor({ r: 1, g: 1, b: 1, a: 1 }, { ...catalog, colorVariables: [] }, 'variable')
    expect(result).toBeNull()
  })
})
