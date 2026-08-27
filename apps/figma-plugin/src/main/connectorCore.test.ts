import { describe, expect, it } from 'vitest'
import { pointAtRoute, resolveAutoSides, routeConnector, stableLaneOffsets } from './connectorCore'

const base = {
  sideA: 'AUTO' as const,
  sideB: 'AUTO' as const,
  offsetA: 0.5,
  offsetB: 0.5,
  marginA: 16,
  marginB: 16,
  routingPadding: 48,
  lineShape: 'ORTHOGONAL' as const
}

describe('connector routing', () => {
  it('uses the geometric center of facing edges by default', () => {
    const route = routeConnector({ x: 10, y: 20, width: 100, height: 100 }, { x: 310, y: 20, width: 100, height: 100 }, base)
    expect(resolveAutoSides({ x: 10, y: 20, width: 100, height: 100 }, { x: 310, y: 20, width: 100, height: 100 })).toEqual(['RIGHT', 'LEFT'])
    expect(route.points[0]).toEqual({ x: 110, y: 70 })
    expect(route.points.at(-1)).toEqual({ x: 310, y: 70 })
  })

  it('creates stable symmetric lanes for parallel and opposite connectors', () => {
    expect(stableLaneOffsets(1, 24)).toEqual([0])
    expect(stableLaneOffsets(2, 24)).toEqual([-12, 12])
    expect(stableLaneOffsets(3, 24)).toEqual([-24, 0, 24])
    const upper = routeConnector({ x: 0, y: 0, width: 100, height: 100 }, { x: 300, y: 0, width: 100, height: 100 }, base, -12)
    const lower = routeConnector({ x: 300, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 }, base, 12)
    expect(upper.points[0]?.y).toBe(38)
    expect(lower.points[0]?.y).toBe(62)
  })

  it('supports straight and curved shapes and label points', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 }
    const b = { x: 300, y: 100, width: 100, height: 100 }
    const straight = routeConnector(a, b, { ...base, lineShape: 'STRAIGHT' })
    const curved = routeConnector(a, b, { ...base, lineShape: 'CURVED' })
    expect(straight.points).toHaveLength(2)
    expect(curved.curve).toBeDefined()
    expect(pointAtRoute(straight, 0.5)).toEqual({ x: 200, y: 100 })
  })
})
