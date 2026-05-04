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

/** Tighter threshold for traffic signals — they sit exactly at intersections. */
export const LIGHT_THRESHOLD_M = 50

const LIGHT_WEIGHTS: Partial<Record<PoiCategory, number>> = {
  traffic_signal: 1,
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
  /** Raw count of traffic signals within LIGHT_THRESHOLD_M of route */
  lightCount: number
  /** Weighted light score (count × weight) */
  lightScore: number
  nearbyPois: OsmPoi[]
}

/**
 * Score a route polyline against POIs with weighted categories.
 *
 * For each POI within `thresholdMeters` of the (sampled) route polyline,
 * add its category weight to the appropriate score bucket.
 *
 * calmScore is set to 0 here — use `normalizeScores()` to compute it
 * across all route variants.
 */
function deduplicateByProximity(pois: OsmPoi[], radiusM: number): OsmPoi[] {
  const kept: OsmPoi[] = []
  for (const poi of pois) {
    const tooClose = kept.some(
      (k) => haversineDistance([poi.lat, poi.lon], [k.lat, k.lon]) <= radiusM,
    )
    if (!tooClose) kept.push(poi)
  }
  return kept
}

const SIGNAL_DEDUP_RADIUS_M = 25

export function scoreRouteDetailed(
  pois: OsmPoi[],
  routePolyline: LatLng[],
  thresholdMeters: number = 150,
  sampleStep: number = 3,
  lightThresholdMeters: number = LIGHT_THRESHOLD_M,
): RouteScores {
  const signals = deduplicateByProximity(
    pois.filter((p) => p.category === 'traffic_signal'),
    SIGNAL_DEDUP_RADIUS_M,
  )
  const workingPois = [...pois.filter((p) => p.category !== 'traffic_signal'), ...signals]

  const sampled = samplePolyline(routePolyline, sampleStep)
  const nearbyPois: OsmPoi[] = []
  let scenicScore = 0
  let infraScore = 0
  let scenicPoiCount = 0
  let infraSegmentCount = 0
  let lightScore = 0
  let lightCount = 0

  for (const poi of workingPois) {
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
    if (poi.category === 'traffic_signal' && d <= lightThresholdMeters) {
      lightScore += LIGHT_WEIGHTS.traffic_signal!
      lightCount++
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
