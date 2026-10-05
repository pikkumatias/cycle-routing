import type { LatLng } from './routeGeometry'
import type { OsmPoi, PoiCategory } from './overpass'

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
  threshold?: number,
): number {
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
 * Sample every Nth vertex from a polyline, always including the first and last.
 * Reduces haversine calculations ~66% at step=3 with negligible accuracy loss.
 */
export function samplePolyline(polyline: LatLng[], step: number): LatLng[] {
  if (step <= 1 || polyline.length <= step) return polyline
  const sampled: LatLng[] = [polyline[0]]
  for (let i = step; i < polyline.length - 1; i += step) {
    sampled.push(polyline[i])
  }
  if (polyline.length > 1) {
    sampled.push(polyline[polyline.length - 1])
  }
  return sampled
}

// ── Weighted scoring ──────────────────────────────────────────────────

/** Scenic POI weights — nature, green spaces, water features. */
const SCENIC_WEIGHTS: Partial<Record<PoiCategory, number>> = {
  nature_reserve: 4,
  park: 3,
  garden: 3,
  forest: 3,
  wood: 3,
  meadow: 2,
  water: 2,
  river_stream: 2,
  fountain: 1,
  grass: 1,
}

/** Infrastructure weights — cycling path quality. */
const INFRA_WEIGHTS: Partial<Record<PoiCategory, number>> = {
  cycleway_separated: 4,
  cycleway_designated: 2,
  cycleway_lane: 1,
}

/**
 * A signal node counts as on the route when it lies within this distance of the
 * full-resolution polyline. Wide enough for crossing nodes on a parallel cycle track,
 * tight enough to skip parallel streets.
 */
export const LIGHT_THRESHOLD_M = 12

/**
 * One junction has many signal nodes (one per crossing arm). Hits closer than this
 * along the route, measured from the first hit of a group, count as a single stop.
 */
export const LIGHT_WINDOW_M = 40

const DEG_TO_M = 111_320

type PolylineHit = { distanceM: number; alongM: number }

/**
 * Nearest point on the polyline: perpendicular distance in meters plus the distance
 * travelled along the route to reach it. Flat-earth projection around the point —
 * accurate to <0.1% for distances under 200m.
 */
function nearestOnPolyline(point: LatLng, poly: LatLng[]): PolylineHit {
  if (poly.length === 0) return { distanceM: Infinity, alongM: 0 }
  if (poly.length === 1) return { distanceM: haversineDistance(point, poly[0]), alongM: 0 }
  const cosLat = Math.cos((point[0] * Math.PI) / 180)
  let best: PolylineHit = { distanceM: Infinity, alongM: 0 }
  let travelled = 0
  for (let i = 0; i < poly.length - 1; i++) {
    const ax = (poly[i][1] - point[1]) * DEG_TO_M * cosLat
    const ay = (poly[i][0] - point[0]) * DEG_TO_M
    const bx = (poly[i + 1][1] - point[1]) * DEG_TO_M * cosLat
    const by = (poly[i + 1][0] - point[0]) * DEG_TO_M
    const abx = bx - ax, aby = by - ay
    const lenSq = abx * abx + aby * aby
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * abx - ay * aby) / lenSq))
    const cx = ax + t * abx, cy = ay + t * aby
    const dist = Math.sqrt(cx * cx + cy * cy)
    const segLen = Math.sqrt(lenSq)
    if (dist < best.distanceM) best = { distanceM: dist, alongM: travelled + t * segLen }
    travelled += segLen
  }
  return best
}

/**
 * Signal stops along a route. Every signal node within `thresholdM` of the
 * full-resolution polyline is a hit; hits are ordered along the route and grouped so
 * a group spans at most `windowM` from its first hit. Each group is one stop, returned
 * as the centroid of its nodes (used for the map markers).
 */
export function findSignalStops(
  signals: OsmPoi[],
  routePolyline: LatLng[],
  thresholdM: number = LIGHT_THRESHOLD_M,
  windowM: number = LIGHT_WINDOW_M,
): OsmPoi[] {
  if (routePolyline.length === 0) return []

  // Cheap bbox pre-filter before the per-segment distance scan.
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
  for (const [lat, lon] of routePolyline) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
  }
  const padLat = thresholdM / DEG_TO_M
  const padLon = padLat / Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)

  const hits: Array<{ poi: OsmPoi; alongM: number }> = []
  for (const poi of signals) {
    if (
      poi.lat < minLat - padLat || poi.lat > maxLat + padLat ||
      poi.lon < minLon - padLon || poi.lon > maxLon + padLon
    ) continue
    const hit = nearestOnPolyline([poi.lat, poi.lon], routePolyline)
    if (hit.distanceM <= thresholdM) hits.push({ poi, alongM: hit.alongM })
  }
  hits.sort((a, b) => a.alongM - b.alongM)

  const groups: OsmPoi[][] = []
  let groupStart = -Infinity
  for (const { poi, alongM } of hits) {
    if (alongM - groupStart > windowM) {
      groups.push([poi])
      groupStart = alongM
    } else {
      groups[groups.length - 1].push(poi)
    }
  }
  return groups.map((g) => ({
    ...g[0],
    lat: g.reduce((sum, p) => sum + p.lat, 0) / g.length,
    lon: g.reduce((sum, p) => sum + p.lon, 0) / g.length,
  }))
}

export type RouteScores = {
  /** Weighted scenic score (sum of category weights for nearby scenic POIs) */
  scenicScore: number
  /** Weighted infrastructure score (sum of category weights for nearby infra) */
  infraScore: number
  /** Combined calm score, normalized 0-100 across route variants */
  calmScore: number
  /** Raw count of scenic POIs near route */
  scenicPoiCount: number
  /** Raw count of infrastructure segments near route */
  infraSegmentCount: number
  /** Number of signal stops along the route (see findSignalStops) */
  lightCount: number
  /** Weighted light score (count × weight) */
  lightScore: number
  nearbyPois: OsmPoi[]
}

/**
 * Score a route polyline against POIs with weighted categories.
 *
 * Traffic signals are handled separately by findSignalStops on the full-resolution
 * polyline; only the stop centroids appear in nearbyPois.
 *
 * calmScore is set to 0 here — use `normalizeScores()` to compute it
 * across all route variants.
 */
export function scoreRouteDetailed(
  pois: OsmPoi[],
  routePolyline: LatLng[],
  thresholdMeters: number = 150,
  sampleStep: number = 3,
  lightThresholdMeters: number = LIGHT_THRESHOLD_M,
): RouteScores {
  const sampled = samplePolyline(routePolyline, sampleStep)

  const signalStops = findSignalStops(
    pois.filter((p) => p.category === 'traffic_signal'),
    routePolyline,
    lightThresholdMeters,
  )
  const lightCount = signalStops.length
  const lightScore = lightCount

  const nearbyPois: OsmPoi[] = [...signalStops]
  let scenicScore = 0
  let infraScore = 0
  let scenicPoiCount = 0
  let infraSegmentCount = 0

  for (const poi of pois) {
    if (poi.category === 'traffic_signal') continue
    const d = minDistanceToPolyline([poi.lat, poi.lon], sampled)
    if (d <= thresholdMeters) {
      nearbyPois.push(poi)
      const cat = poi.category
      if (cat && cat in SCENIC_WEIGHTS) {
        scenicScore += SCENIC_WEIGHTS[cat]!
        scenicPoiCount++
      }
      if (cat && cat in INFRA_WEIGHTS) {
        infraScore += INFRA_WEIGHTS[cat]!
        infraSegmentCount++
      }
    }
  }

  return {
    scenicScore,
    infraScore,
    calmScore: 0,
    scenicPoiCount,
    infraSegmentCount,
    lightScore,
    lightCount,
    nearbyPois,
  }
}

/**
 * Normalize scores across multiple routes and compute calm score.
 *
 * calmScore = 0.5 × (scenicScore / maxScenic) + 0.5 × (infraScore / maxInfra)
 * Scaled to 0-100. The route with the best combined score gets 100.
 */
export function normalizeScores(
  scores: Record<string, RouteScores>,
): Record<string, RouteScores> {
  const maxScenic = Math.max(...Object.values(scores).map((s) => s.scenicScore), 1)
  const maxInfra = Math.max(...Object.values(scores).map((s) => s.infraScore), 1)

  const result: Record<string, RouteScores> = {}
  for (const [key, s] of Object.entries(scores)) {
    const normalizedScenic = s.scenicScore / maxScenic
    const normalizedInfra = s.infraScore / maxInfra
    result[key] = {
      ...s,
      calmScore: Math.round((0.5 * normalizedScenic + 0.5 * normalizedInfra) * 100),
    }
  }
  return result
}

/**
 * Legacy scoring function — counts scenic POIs within threshold of the route.
 * Kept for backward compatibility with existing tests.
 */
export function scorePoisNearRoute(
  pois: OsmPoi[],
  routePolyline: LatLng[],
  thresholdMeters: number = 150,
): { count: number; nearbyPois: OsmPoi[] } {
  const { scenicPoiCount, nearbyPois } = scoreRouteDetailed(pois, routePolyline, thresholdMeters)
  return { count: scenicPoiCount, nearbyPois }
}
