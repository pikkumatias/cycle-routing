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
  mode?: string
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

type OtpLeg = {
  legGeometry?: { points?: string }
  mode?: string
}

type OtpResponse = {
  data?: { plan?: { itineraries?: { legs?: OtpLeg[] }[] } }
}

/**
 * Extract route legs with decoded geometry from Digitransit plan response.
 */
export function getRouteLegsFromPlanResponse(response: unknown): RouteLeg[] {
  const legs = (response as OtpResponse)?.data?.plan?.itineraries?.[0]?.legs
  if (!Array.isArray(legs)) return []

  return legs
    .map((leg) => {
      const encoded = leg?.legGeometry?.points
      const positions = smoothPolyline(decodePolyline(encoded ?? ''))
      return { positions, mode: leg?.mode }
    })
    .filter((leg: RouteLeg) => leg.positions.length > 0)
}

const M_PER_DEG_LAT = 111_320

/**
 * Estimate a bounding box from just origin and destination, padded by the same distance
 * in metres on every side: `max(minPaddingM, paddingFraction × trip length)`.
 * Detours scale with trip length, not with each axis's span — a mostly north–south trip
 * still needs room east and west, or candidates that swing sideways leave the OSM data
 * area and look free of traffic lights. Used to start Overpass in parallel with routing.
 */
export function estimateBboxFromEndpoints(
  from: LatLng,
  to: LatLng,
  paddingFraction: number = 0.25,
  minPaddingM: number = 1000,
): [LatLng, LatLng] {
  const minLat = Math.min(from[0], to[0])
  const maxLat = Math.max(from[0], to[0])
  const minLon = Math.min(from[1], to[1])
  const maxLon = Math.max(from[1], to[1])

  const cosLat = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const tripM = Math.hypot((maxLat - minLat) * M_PER_DEG_LAT, (maxLon - minLon) * M_PER_DEG_LAT * cosLat)
  const padM = Math.max(minPaddingM, tripM * paddingFraction)
  const latPad = padM / M_PER_DEG_LAT
  const lonPad = padM / (M_PER_DEG_LAT * cosLat)

  return [
    [minLat - latPad, minLon - lonPad],
    [maxLat + latPad, maxLon + lonPad],
  ]
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
