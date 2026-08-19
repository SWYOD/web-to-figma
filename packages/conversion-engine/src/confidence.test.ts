import { describe, expect, it } from 'vitest'
import type { ConversionWarning } from '@web-to-figma/design-ast'
import { computeConfidenceScore, confidenceLevel } from './confidence'

function diag(severity: ConversionWarning['severity']): ConversionWarning {
  return { nodeId: 'n1', code: 'test-code', severity, message: 'test' }
}

describe('computeConfidenceScore', () => {
  it('is 100 with no diagnostics', () => {
    expect(computeConfidenceScore([])).toBe(100)
  })

  it('penalizes info the least, error the most', () => {
    expect(computeConfidenceScore([diag('info')])).toBe(98)
    expect(computeConfidenceScore([diag('warning')])).toBe(92)
    expect(computeConfidenceScore([diag('error')])).toBe(80)
  })

  it('clamps to 0, never negative', () => {
    const many = Array.from({ length: 10 }, () => diag('error'))
    expect(computeConfidenceScore(many)).toBe(0)
  })

  it('sums penalties across mixed severities', () => {
    expect(computeConfidenceScore([diag('info'), diag('warning'), diag('error')])).toBe(100 - 2 - 8 - 20)
  })
})

describe('confidenceLevel', () => {
  it('maps score ranges to high/medium/low', () => {
    expect(confidenceLevel(100)).toBe('high')
    expect(confidenceLevel(80)).toBe('high')
    expect(confidenceLevel(79)).toBe('medium')
    expect(confidenceLevel(50)).toBe('medium')
    expect(confidenceLevel(49)).toBe('low')
    expect(confidenceLevel(0)).toBe('low')
  })
})
