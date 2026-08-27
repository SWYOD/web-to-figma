export type ConnectorSide = 'AUTO' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM'
export type ResolvedSide = Exclude<ConnectorSide, 'AUTO'>
export type ConnectorLineShape = 'ORTHOGONAL' | 'CURVED' | 'STRAIGHT'

export interface Point {
  x: number
  y: number
}

export interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

export interface RouteConfig {
  sideA: ConnectorSide
  sideB: ConnectorSide
  offsetA: number
  offsetB: number
  marginA: number
  marginB: number
  routingPadding: number
  lineShape: ConnectorLineShape
}

export interface CurveHandles {
  tangentStart: Point
  tangentEnd: Point
}

export interface RouteGeometry {
  points: Point[]
  curve?: CurveHandles
  sideA: ResolvedSide
  sideB: ResolvedSide
  offsetA: number
  offsetB: number
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))

export function center(box: RectLike): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export function resolveAutoSides(aBox: RectLike, bBox: RectLike): [ResolvedSide, ResolvedSide] {
  const a = center(aBox)
  const b = center(bBox)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? ['RIGHT', 'LEFT'] : ['LEFT', 'RIGHT']
  }
  return dy >= 0 ? ['BOTTOM', 'TOP'] : ['TOP', 'BOTTOM']
}

export function stableLaneOffsets(count: number, gap: number): number[] {
  if (count <= 0) return []
  const safeGap = Math.max(0, gap)
  const middle = (count - 1) / 2
  return Array.from({ length: count }, (_, index) => (index - middle) * safeGap)
}

function resolvedSide(side: ConnectorSide, auto: ResolvedSide): ResolvedSide {
  return side === 'AUTO' ? auto : side
}

function edgeLength(box: RectLike, side: ResolvedSide): number {
  return side === 'LEFT' || side === 'RIGHT' ? box.height : box.width
}

function laneOffset(base: number, lanePx: number, box: RectLike, side: ResolvedSide, automatic: boolean): number {
  if (!automatic) return clamp(base, 0, 1)
  return clamp(0.5 + lanePx / Math.max(1, edgeLength(box, side)), 0.05, 0.95)
}

export function edgePoint(box: RectLike, side: ResolvedSide, offset: number): Point {
  if (side === 'LEFT') return { x: box.x, y: box.y + box.height * offset }
  if (side === 'RIGHT') return { x: box.x + box.width, y: box.y + box.height * offset }
  if (side === 'TOP') return { x: box.x + box.width * offset, y: box.y }
  return { x: box.x + box.width * offset, y: box.y + box.height }
}

export function sideNormal(side: ResolvedSide): Point {
  if (side === 'LEFT') return { x: -1, y: 0 }
  if (side === 'RIGHT') return { x: 1, y: 0 }
  if (side === 'TOP') return { x: 0, y: -1 }
  return { x: 0, y: 1 }
}

function lead(point: Point, side: ResolvedSide, distance: number): Point {
  const normal = sideNormal(side)
  return { x: point.x + normal.x * distance, y: point.y + normal.y * distance }
}

function isHorizontal(side: ResolvedSide): boolean {
  return side === 'LEFT' || side === 'RIGHT'
}

export function simplify(points: Point[]): Point[] {
  const unique = points.filter((point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y)
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true
    const before = unique[index - 1]!
    const after = unique[index + 1]!
    return !((before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y))
  })
}

function orthogonalPoints(a: Point, b: Point, sideA: ResolvedSide, sideB: ResolvedSide, marginA: number, marginB: number, padding: number, aBox: RectLike, bBox: RectLike): Point[] {
  const aLead = lead(a, sideA, marginA)
  const bLead = lead(b, sideB, marginB)
  const points: Point[] = [a, aLead]
  const horizontalA = isHorizontal(sideA)
  const horizontalB = isHorizontal(sideB)

  if (horizontalA && horizontalB && sideA === sideB) {
    const outsideX = sideA === 'RIGHT'
      ? Math.max(aBox.x + aBox.width, bBox.x + bBox.width) + Math.max(marginA, marginB, padding)
      : Math.min(aBox.x, bBox.x) - Math.max(marginA, marginB, padding)
    points.push({ x: outsideX, y: aLead.y }, { x: outsideX, y: bLead.y })
  } else if (!horizontalA && !horizontalB && sideA === sideB) {
    const outsideY = sideA === 'BOTTOM'
      ? Math.max(aBox.y + aBox.height, bBox.y + bBox.height) + Math.max(marginA, marginB, padding)
      : Math.min(aBox.y, bBox.y) - Math.max(marginA, marginB, padding)
    points.push({ x: aLead.x, y: outsideY }, { x: bLead.x, y: outsideY })
  } else if (horizontalA && horizontalB) {
    const middleX = (aLead.x + bLead.x) / 2
    points.push({ x: middleX, y: aLead.y }, { x: middleX, y: bLead.y })
  } else if (!horizontalA && !horizontalB) {
    const middleY = (aLead.y + bLead.y) / 2
    points.push({ x: aLead.x, y: middleY }, { x: bLead.x, y: middleY })
  } else if (horizontalA) {
    // A cleared the box only along X (aLead.x is outside aBox); B cleared it only along Y.
    // Turn while still on each side's own cleared axis — (aLead.x, bLead.y) — instead of
    // combining the two UNcleared axes, which cuts back through whichever box's edge the
    // port sits on (see the mirrored branch below for the case this was flipped with).
    points.push({ x: aLead.x, y: bLead.y })
  } else {
    points.push({ x: bLead.x, y: aLead.y })
  }

  points.push(bLead, b)
  return simplify(points)
}

export function routeConnector(aBox: RectLike, bBox: RectLike, config: RouteConfig, lanePx = 0): RouteGeometry {
  const [autoA, autoB] = resolveAutoSides(aBox, bBox)
  const sideA = resolvedSide(config.sideA, autoA)
  const sideB = resolvedSide(config.sideB, autoB)
  const offsetA = laneOffset(config.offsetA, lanePx, aBox, sideA, config.sideA === 'AUTO')
  const offsetB = laneOffset(config.offsetB, lanePx, bBox, sideB, config.sideB === 'AUTO')
  const a = edgePoint(aBox, sideA, offsetA)
  const b = edgePoint(bBox, sideB, offsetB)

  if (config.lineShape === 'STRAIGHT') {
    return { points: [a, b], sideA, sideB, offsetA, offsetB }
  }

  if (config.lineShape === 'CURVED') {
    const distance = Math.hypot(b.x - a.x, b.y - a.y)
    const handleA = Math.max(config.marginA, Math.min(distance * 0.45, 240))
    const handleB = Math.max(config.marginB, Math.min(distance * 0.45, 240))
    const normalA = sideNormal(sideA)
    const normalB = sideNormal(sideB)
    return {
      points: [a, b],
      curve: {
        tangentStart: { x: normalA.x * handleA, y: normalA.y * handleA },
        tangentEnd: { x: normalB.x * handleB, y: normalB.y * handleB }
      },
      sideA,
      sideB,
      offsetA,
      offsetB
    }
  }

  return {
    points: orthogonalPoints(a, b, sideA, sideB, config.marginA, config.marginB, config.routingPadding, aBox, bBox),
    sideA,
    sideB,
    offsetA,
    offsetB
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function pointAtRoute(route: RouteGeometry, position: number): Point {
  const t = clamp(position, 0, 1)
  if (route.curve) {
    const start = route.points[0]!
    const end = route.points[1]!
    const controlA = { x: start.x + route.curve.tangentStart.x, y: start.y + route.curve.tangentStart.y }
    const controlB = { x: end.x + route.curve.tangentEnd.x, y: end.y + route.curve.tangentEnd.y }
    const mt = 1 - t
    return {
      x: mt ** 3 * start.x + 3 * mt ** 2 * t * controlA.x + 3 * mt * t ** 2 * controlB.x + t ** 3 * end.x,
      y: mt ** 3 * start.y + 3 * mt ** 2 * t * controlA.y + 3 * mt * t ** 2 * controlB.y + t ** 3 * end.y
    }
  }

  if (route.points.length === 2) {
    return { x: lerp(route.points[0]!.x, route.points[1]!.x, t), y: lerp(route.points[0]!.y, route.points[1]!.y, t) }
  }

  const lengths = route.points.slice(1).map((point, index) => Math.hypot(point.x - route.points[index]!.x, point.y - route.points[index]!.y))
  const total = lengths.reduce((sum, value) => sum + value, 0)
  let target = total * t
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!
    if (target <= length || index === lengths.length - 1) {
      const local = length === 0 ? 0 : target / length
      const start = route.points[index]!
      const end = route.points[index + 1]!
      return { x: lerp(start.x, end.x, local), y: lerp(start.y, end.y, local) }
    }
    target -= length
  }
  return route.points[route.points.length - 1]!
}
