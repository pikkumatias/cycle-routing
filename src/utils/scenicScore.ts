import type { LatLng } from './routeGeometry'
import type { OsmPoi } from './overpass'

const EARTH_RADIUS_M = 6_371_000

/** Haversine distance in meters between two [lat, lon] points. */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * sinLon * sinLon
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/**
 * Minimum distance in meters from a point to any vertex on the polyline.
 * Vertex-only check is accurate enough — Digitransit polylines have vertices
 * roughly every 10-50 m.
 */
export function minDistanceToPolyline(
  point: LatLng,
  polyline: LatLng[],
): number {
  let min = Infinity
  for (const vertex of polyline) {
    const d = haversineDistance(point, vertex)
    if (d < min) min = d
  }
  return min
}

/**
 * Count POIs within `thresholdMeters` of the route polyline.
 * Returns the count and the list of nearby POIs.
 */
export function scorePoisNearRoute(
  pois: OsmPoi[],
  routePolyline: LatLng[],
  thresholdMeters: number = 150,
): { count: number; nearbyPois: OsmPoi[] } {
  const nearbyPois: OsmPoi[] = []
  for (const poi of pois) {
    const d = minDistanceToPolyline([poi.lat, poi.lon], routePolyline)
    if (d <= thresholdMeters) {
      nearbyPois.push(poi)
    }
  }
  return { count: nearbyPois.length, nearbyPois }
}
