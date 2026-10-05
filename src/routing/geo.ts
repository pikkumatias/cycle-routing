import type { LatLng } from './types.js'

const EARTH_RADIUS_M = 6_371_000
/** Metres per degree of latitude (and of longitude at the equator). */
export const M_PER_DEG = 111_320

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Haversine distance in metres between two [lat, lon] points. */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h = sinLat * sinLat + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * sinLon * sinLon
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/**
 * Minimum distance in metres from a point to any vertex of the polyline. Stops early once
 * a vertex within `threshold` is found. Vertex-only, so only suitable when the threshold is
 * large compared with vertex spacing.
 */
export function minDistanceToPolyline(point: LatLng, polyline: LatLng[], threshold?: number): number {
  let min = Infinity
  for (const vertex of polyline) {
    const d = haversineDistance(point, vertex)
    if (d < min) {
      min = d
      if (threshold !== undefined && min <= threshold) return min
    }
  }
  return min
}

/**
 * Flat-earth offset of `p` from `origin` in metres ([east, north]). Accurate to <0.1 % for
 * the few-hundred-metre distances the engine compares.
 */
export function toLocal(p: LatLng, origin: LatLng): [number, number] {
  const cosLat = Math.cos(toRad(origin[0]))
  return [(p[1] - origin[1]) * M_PER_DEG * cosLat, (p[0] - origin[0]) * M_PER_DEG]
}

/** The point `east` / `north` metres from `origin`. */
export function offsetPoint(origin: LatLng, east: number, north: number): LatLng {
  const cosLat = Math.cos(toRad(origin[0]))
  return [origin[0] + north / M_PER_DEG, origin[1] + east / (M_PER_DEG * cosLat)]
}

/** Distance from `p` to segment a–b, and the position `t` (0–1) of the nearest point. */
export function segmentDistance(p: LatLng, a: LatLng, b: LatLng): { distanceM: number; t: number } {
  const [ax, ay] = toLocal(a, p)
  const [bx, by] = toLocal(b, p)
  const abx = bx - ax
  const aby = by - ay
  const lenSq = abx * abx + aby * aby
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * abx - ay * aby) / lenSq))
  return { distanceM: Math.hypot(ax + t * abx, ay + t * aby), t }
}

/** Cumulative distance travelled to each vertex; the last entry is the polyline length. */
export function cumulativeLengths(poly: LatLng[]): number[] {
  const cum = [0]
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + haversineDistance(poly[i - 1], poly[i]))
  return cum
}

export function polylineLength(poly: LatLng[]): number {
  let len = 0
  for (let i = 1; i < poly.length; i++) len += haversineDistance(poly[i - 1], poly[i])
  return len
}

export type PolylineHit = {
  distanceM: number
  /** Distance travelled along the polyline to the nearest point. */
  alongM: number
  /** Index of the segment containing the nearest point. */
  segment: number
}

/** Nearest point on the polyline (segments, not just vertices). */
export function nearestOnPolyline(point: LatLng, poly: LatLng[], cum?: number[]): PolylineHit {
  if (poly.length === 0) return { distanceM: Infinity, alongM: 0, segment: -1 }
  if (poly.length === 1) return { distanceM: haversineDistance(point, poly[0]), alongM: 0, segment: 0 }
  const lengths = cum ?? cumulativeLengths(poly)
  let best: PolylineHit = { distanceM: Infinity, alongM: 0, segment: 0 }
  for (let i = 0; i < poly.length - 1; i++) {
    const { distanceM, t } = segmentDistance(point, poly[i], poly[i + 1])
    if (distanceM < best.distanceM) {
      best = { distanceM, alongM: lengths[i] + t * (lengths[i + 1] - lengths[i]), segment: i }
    }
  }
  return best
}

/** Points every `stepM` metres along the polyline, including both ends. */
export function resample(poly: LatLng[], stepM: number): LatLng[] {
  if (poly.length < 2) return [...poly]
  const out: LatLng[] = [poly[0]]
  let carried = 0 // distance since the last emitted point
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]
    const b = poly[i]
    const segLen = haversineDistance(a, b)
    let next = stepM - carried
    while (next <= segLen) {
      const f = next / segLen
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
      next += stepM
    }
    carried = segLen - (next - stepM)
  }
  const last = poly[poly.length - 1]
  if (haversineDistance(out[out.length - 1], last) > 0.01) out.push(last)
  return out
}

/** Compass bearing a→b in degrees (0 = north, 90 = east). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const [x, y] = toLocal(b, a)
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
}

/** Smallest angle between two lines with these bearings, ignoring direction (0–90°). */
export function lineAngleDiff(b1: number, b2: number): number {
  const d = Math.abs(b1 - b2) % 180
  return d > 90 ? 180 - d : d
}

/**
 * Proper intersection of segments a1–a2 and b1–b2 (touching endpoints excluded), as the
 * intersection point and its position `t` along a1–a2.
 */
export function segmentIntersection(
  a1: LatLng,
  a2: LatLng,
  b1: LatLng,
  b2: LatLng,
): { point: LatLng; t: number } | null {
  const [p2x, p2y] = toLocal(a2, a1)
  const [q1x, q1y] = toLocal(b1, a1)
  const [q2x, q2y] = toLocal(b2, a1)
  const rx = p2x
  const ry = p2y
  const sx = q2x - q1x
  const sy = q2y - q1y
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-9) return null
  const t = (q1x * sy - q1y * sx) / denom
  const u = (q1x * ry - q1y * rx) / denom
  const eps = 1e-6
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null
  return { point: [a1[0] + (a2[0] - a1[0]) * t, a1[1] + (a2[1] - a1[1]) * t], t }
}

/**
 * Uniform-grid spatial index over lat/lon. Items are registered in every cell their
 * bounding box touches; `near` returns candidates within roughly `radiusM` (callers do
 * the exact distance test).
 */
export class GridIndex<T> {
  private readonly cells = new Map<string, T[]>()
  private readonly latStep: number
  private readonly lonStep: number

  constructor(cellM: number, refLat: number = 60.2) {
    this.latStep = cellM / M_PER_DEG
    this.lonStep = cellM / (M_PER_DEG * Math.cos(toRad(refLat)))
  }

  /** Register an item covering the box spanned by `points` (one point for a node). */
  insert(item: T, points: LatLng[]): void {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
    for (const [lat, lon] of points) {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
    }
    for (let y = Math.floor(minLat / this.latStep); y <= Math.floor(maxLat / this.latStep); y++) {
      for (let x = Math.floor(minLon / this.lonStep); x <= Math.floor(maxLon / this.lonStep); x++) {
        const key = `${y}:${x}`
        const cell = this.cells.get(key)
        if (cell) cell.push(item)
        else this.cells.set(key, [item])
      }
    }
  }

  /** Items whose cells lie within `radiusM` of the point (deduplicated). */
  near(point: LatLng, radiusM: number): T[] {
    const dy = Math.ceil(radiusM / M_PER_DEG / this.latStep)
    const dx = Math.ceil(radiusM / (M_PER_DEG * Math.cos(toRad(point[0]))) / this.lonStep)
    const cy = Math.floor(point[0] / this.latStep)
    const cx = Math.floor(point[1] / this.lonStep)
    const seen = new Set<T>()
    for (let y = cy - dy; y <= cy + dy; y++) {
      for (let x = cx - dx; x <= cx + dx; x++) {
        const cell = this.cells.get(`${y}:${x}`)
        if (cell) for (const item of cell) seen.add(item)
      }
    }
    return [...seen]
  }
}

/**
 * Stable id for a geometry: FNV-1a over coordinates rounded to ~1 m. Leg boundaries and
 * repeated points are ignored, so a two-leg via route along the same path as a one-leg
 * route gets the same id.
 */
export function hashGeometry(legs: LatLng[][]): string {
  let h = 0x811c9dc5
  let prevLat = NaN
  let prevLon = NaN
  for (const leg of legs) {
    for (const [lat, lon] of leg) {
      const rLat = Math.round(lat * 1e5)
      const rLon = Math.round(lon * 1e5)
      if (rLat === prevLat && rLon === prevLon) continue
      prevLat = rLat
      prevLon = rLon
      for (const n of [rLat, rLon]) {
        h ^= n & 0xffff
        h = Math.imul(h, 0x01000193)
        h ^= (n >>> 16) & 0xffff
        h = Math.imul(h, 0x01000193)
      }
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
