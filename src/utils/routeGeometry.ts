import polyline from '@mapbox/polyline'

export type LatLng = [number, number]

/**
 * Decode a Google encoded polyline string to an array of [lat, lng] pairs.
 */
export function decodePolyline(encoded: string): LatLng[] {
  if (!encoded || typeof encoded !== 'string') return []
  try {
    return polyline.decode(encoded)
  } catch {
    return []
  }
}

export type RouteLeg = {
  positions: LatLng[]
}

function smoothPolyline(points: LatLng[], iterations = 2): LatLng[] {
  if (points.length < 3) return points
  let pts = points
  for (let iter = 0; iter < iterations; iter++) {
    const out: LatLng[] = [pts[0]]
    for (let i = 0; i < pts.length - 1; i++) {
      const [lat0, lng0] = pts[i]
      const [lat1, lng1] = pts[i + 1]
      out.push([lat0 * 0.75 + lat1 * 0.25, lng0 * 0.75 + lng1 * 0.25])
      out.push([lat0 * 0.25 + lat1 * 0.75, lng0 * 0.25 + lng1 * 0.75])
    }
    out.push(pts[pts.length - 1])
    pts = out
  }
  return pts
}

/** Route legs as drawn on the map: smoothed, empty legs dropped. */
export function toDisplayLegs(legs: LatLng[][]): RouteLeg[] {
  return legs.filter((leg) => leg.length > 0).map((leg) => ({ positions: smoothPolyline(leg) }))
}

/**
 * Get combined bounds [[south, west], [north, east]] from legs and optional points.
 */
export function getBoundsFromLegsAndPoints(
  legs: RouteLeg[],
  from?: LatLng,
  to?: LatLng,
): LatLng[] {
  let minLat = Infinity
  let minLng = Infinity
  let maxLat = -Infinity
  let maxLng = -Infinity
  let count = 0

  const visit = (p: LatLng) => {
    if (p[0] < minLat) minLat = p[0]
    if (p[0] > maxLat) maxLat = p[0]
    if (p[1] < minLng) minLng = p[1]
    if (p[1] > maxLng) maxLng = p[1]
    count++
  }

  // Loop instead of Math.min(...spread): smoothed routes can have tens of
  // thousands of vertices, which overflows the call stack when spread as args.
  for (const leg of legs) {
    for (const p of leg.positions) visit(p)
  }
  if (from) visit(from)
  if (to) visit(to)
  if (count === 0) return []
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ]
}
