import { describe, expect, it } from 'vitest'
import { pointAtRoute, resolveAutoSides, routeConnector, stableLaneOffsets, type RectLike } from './connectorCore'

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

/** True if the open segment between p1/p2 passes through box's interior (touching an edge is fine). */
function segmentEntersBox(p1: { x: number; y: number }, p2: { x: number; y: number }, box: RectLike): boolean {
  const steps = 50
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps
    const x = p1.x + (p2.x - p1.x) * t
    const y = p1.y + (p2.y - p1.y) * t
    if (x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height) return true
  }
  return false
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

  it('routes around the source frame when the two sides have mixed orientation (TOP + LEFT)', () => {
    const a = { x: 0, y: 0, width: 150, height: 150 }
    const b = { x: 400, y: 0, width: 150, height: 150 }
    const route = routeConnector(a, b, { ...base, sideA: 'TOP', sideB: 'LEFT', offsetA: 0.35 })
    for (let i = 0; i < route.points.length - 1; i += 1) {
      expect(segmentEntersBox(route.points[i]!, route.points[i + 1]!, a)).toBe(false)
      expect(segmentEntersBox(route.points[i]!, route.points[i + 1]!, b)).toBe(false)
    }
  })

  it('routes around the source frame when the two sides have mixed orientation (LEFT + TOP, mirrored)', () => {
    const a = { x: 400, y: 0, width: 150, height: 150 }
    const b = { x: 0, y: 0, width: 150, height: 150 }
    const route = routeConnector(a, b, { ...base, sideA: 'LEFT', sideB: 'TOP', offsetB: 0.35 })
    for (let i = 0; i < route.points.length - 1; i += 1) {
      expect(segmentEntersBox(route.points[i]!, route.points[i + 1]!, a)).toBe(false)
      expect(segmentEntersBox(route.points[i]!, route.points[i + 1]!, b)).toBe(false)
    }
  })
})
