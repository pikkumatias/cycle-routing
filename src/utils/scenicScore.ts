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

/** Tighter threshold for traffic signals — segment-based distance, so 15m cleanly excludes parallel streets. */
export const LIGHT_THRESHOLD_M = 15

const LIGHT_WEIGHTS: Partial<Record<PoiCategory, number>> = {
  traffic_signal: 1,
}

/** Radius for collapsing multiple OSM nodes of the same intersection into one centroid. */
const SIGNAL_DEDUP_RADIUS_M = 10

const DEG_TO_M = 111_320

/**
 * Minimum perpendicular distance in meters from a point to any segment of the polyline.
 * Uses flat-earth Cartesian projection — accurate to <0.1% for distances under 200m.
 * More reliable than vertex-only checking for tight thresholds (<30m).
 */
function minDistanceToPolylineSegments(point: LatLng, poly: LatLng[]): number {
  if (poly.length === 0) return Infinity
  if (poly.length === 1) return haversineDistance(point, poly[0])
  const cosLat = Math.cos((point[0] * Math.PI) / 180)
  let minDist = Infinity
  for (let i = 0; i < poly.length - 1; i++) {
    const ax = (poly[i][1] - point[1]) * DEG_TO_M * cosLat
    const ay = (poly[i][0] - point[0]) * DEG_TO_M
    const bx = (poly[i + 1][1] - point[1]) * DEG_TO_M * cosLat
    const by = (poly[i + 1][0] - point[0]) * DEG_TO_M
    const abx = bx - ax, aby = by - ay
    const lenSq = abx * abx + aby * aby
    let dist: number
    if (lenSq === 0) {
      dist = Math.sqrt(ax * ax + ay * ay)
    } else {
      const t = Math.max(0, Math.min(1, (-ax * abx - ay * aby) / lenSq))
      const cx = ax + t * abx, cy = ay + t * aby
      dist = Math.sqrt(cx * cx + cy * cy)
    }
    if (dist < minDist) minDist = dist
  }
  return minDist
}

/** Groups POIs into proximity clusters and returns one centroid POI per cluster. */
function clusterToCentroids(pois: OsmPoi[], radiusM: number): OsmPoi[] {
  const clusters: OsmPoi[][] = []
  for (const poi of pois) {
    const match = clusters.find((c) =>
      c.some((k) => haversineDistance([poi.lat, poi.lon], [k.lat, k.lon]) <= radiusM),
    )
    if (match) {
      match.push(poi)
    } else {
      clusters.push([poi])
    }
  }
  return clusters.map((c) => ({
    ...c[0],
    lat: c.reduce((sum, p) => sum + p.lat, 0) / c.length,
    lon: c.reduce((sum, p) => sum + p.lon, 0) / c.length,
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
  /** Raw count of traffic signals within LIGHT_THRESHOLD_M of route */
  lightCount: number
  /** Weighted light score (count × weight) */
  lightScore: number
  nearbyPois: OsmPoi[]
}

/**
 * Score a route polyline against POIs with weighted categories.
 *
 * Traffic signals are handled separately: proximity is measured to segments
 * (not vertices) for precision, nearby signals are clustered into intersection
 * centroids before counting, and only those centroids appear in nearbyPois.
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

  // Filter signals by segment-based proximity first, then cluster into intersection centroids.
  // This ensures off-route signals are excluded before clustering, and each intersection
  // produces exactly one icon at the centroid of its nearby nodes.
  const nearbyRawSignals = pois.filter(
    (p) =>
      p.category === 'traffic_signal' &&
      minDistanceToPolylineSegments([p.lat, p.lon], sampled) <= lightThresholdMeters,
  )
  const clusteredSignals = clusterToCentroids(nearbyRawSignals, SIGNAL_DEDUP_RADIUS_M)
  const lightCount = clusteredSignals.length
  const lightScore = lightCount * LIGHT_WEIGHTS.traffic_signal!

  const nearbyPois: OsmPoi[] = [...clusteredSignals]
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
