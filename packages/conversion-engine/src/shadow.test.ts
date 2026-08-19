import { describe, expect, it } from 'vitest'
import { parseBoxShadow } from './shadow'

describe('parseBoxShadow', () => {
  it('returns [] for "none"', () => {
    expect(parseBoxShadow('none')).toEqual([])
  })

  it('parses a single drop shadow', () => {
    const effects = parseBoxShadow('rgba(0, 0, 0, 0.1) 0px 1px 2px 0px')
    expect(effects).toEqual([
      { type: 'drop-shadow', color: { r: 0, g: 0, b: 0, a: 0.1 }, offsetX: 0, offsetY: 1, blur: 2, spread: 0 }
    ])
  })

  it('parses inset shadow (prefix form)', () => {
    const effects = parseBoxShadow('inset rgba(0, 0, 0, 0.2) 0px 2px 4px 0px')
    expect(effects[0]?.type).toBe('inner-shadow')
  })

  it('parses multiple comma-separated shadows without splitting inside rgba()', () => {
    const effects = parseBoxShadow('rgba(0, 0, 0, 0.1) 0px 1px 2px 0px, rgba(0, 0, 0, 0.2) 0px 4px 8px 0px')
    expect(effects).toHaveLength(2)
  })

  it('skips unparseable segments instead of throwing', () => {
    expect(() => parseBoxShadow('garbage, still garbage')).not.toThrow()
    expect(parseBoxShadow('garbage')).toEqual([])
  })
})
