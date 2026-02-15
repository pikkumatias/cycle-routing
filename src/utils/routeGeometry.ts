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

/**
 * Extract route legs with decoded geometry from Digitransit plan response.
 */
export function getRouteLegsFromPlanResponse(response: any): RouteLeg[] {
  const legs = response?.data?.plan?.itineraries?.[0]?.legs
  if (!Array.isArray(legs)) return []

  return legs
    .map((leg: any) => {
      const encoded = leg?.legGeometry?.points
      const positions = decodePolyline(encoded)
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
  const all: LatLng[] = []
  legs.forEach((leg) => leg.positions.forEach((p) => all.push(p)))
  if (from) all.push(from)
  if (to) all.push(to)
  if (all.length === 0) return []
  const lats = all.map((p) => p[0])
  const lngs = all.map((p) => p[1])
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ]
}
