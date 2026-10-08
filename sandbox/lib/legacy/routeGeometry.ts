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

/**
 * Estimate a bounding box from just origin and destination with padding.
 * Bicycle routes typically stay within ~20% beyond the endpoint bounding box.
 * Used to start Overpass fetch in parallel with route requests.
 */
export function estimateBboxFromEndpoints(
  from: LatLng,
  to: LatLng,
  paddingFraction: number = 0.2,
): [LatLng, LatLng] {
  const minLat = Math.min(from[0], to[0])
  const maxLat = Math.max(from[0], to[0])
  const minLon = Math.min(from[1], to[1])
  const maxLon = Math.max(from[1], to[1])

  const latPad = (maxLat - minLat) * paddingFraction || 0.005
  const lonPad = (maxLon - minLon) * paddingFraction || 0.005

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
