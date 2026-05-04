import type { LatLng } from './routeGeometry'
import type { OsmPoi } from './overpass'
import type { CandidateRoute, RouteCategory } from '../api/digitransit'
import type { ScoredRoute } from '../components/RouteCards'
import {
  haversineDistance,
  samplePolyline,
  scoreRouteDetailed,
  normalizeScores,
} from './scenicScore'

/**
 * Fraction of points in polylineA that are within thresholdM of any point in polylineB.
 */
export function computeOverlap(
  polylineA: LatLng[],
  polylineB: LatLng[],
  thresholdM: number = 50,
  step: number = 3,
): number {
  const sampledA = samplePolyline(polylineA, step)
  const sampledB = samplePolyline(polylineB, step)

  if (sampledA.length === 0) return 0

  let closeCount = 0
  for (const ptA of sampledA) {
    for (const ptB of sampledB) {
      if (haversineDistance(ptA, ptB) <= thresholdM) {
        closeCount++
        break
      }
    }
  }

  return closeCount / sampledA.length
}

/**
 * Remove near-duplicate routes from the candidate pool.
 * Two routes are duplicates if >85% of their points overlap bidirectionally.
 * Keeps the route with lower duration as tiebreak.
 */
export function deduplicateRoutes(
  candidates: CandidateRoute[],
  overlapThreshold: number = 0.85,
): CandidateRoute[] {
  // Sort by duration so we prefer faster routes when deduplicating
  const sorted = [...candidates].sort((a, b) => a.durationSec - b.durationSec)
  const kept: CandidateRoute[] = []

  for (const candidate of sorted) {
    const isDuplicate = kept.some(
      (existing) =>
        computeOverlap(candidate.polyline, existing.polyline) > overlapThreshold &&
        computeOverlap(existing.polyline, candidate.polyline) > overlapThreshold,
    )
    if (!isDuplicate) {
      kept.push(candidate)
    }
  }

  return kept
}

type ScoredCandidate = CandidateRoute & {
  scenicScore: number
  infraScore: number
  calmScore: number
  scenicPoiCount: number
  infraSegmentCount: number
  lightScore: number
  lightCount: number
}

/**
 * Score all candidates and select the best route per category.
 *
 * - Fastest: lowest duration
 * - Scenic: highest scenic POI score (parks, nature, water)
 * - Calm: highest infrastructure score (cycleways, bike lanes)
 */
export function selectRoutes(
  candidates: CandidateRoute[],
  pois: OsmPoi[],
): Record<RouteCategory, ScoredRoute> {
  if (candidates.length === 0) {
    throw new Error('No candidate routes available')
  }

  // Score all candidates
  const rawScores: Record<string, ReturnType<typeof scoreRouteDetailed>> = {}
  for (let i = 0; i < candidates.length; i++) {
    rawScores[String(i)] = scoreRouteDetailed(pois, candidates[i].polyline)
  }

  const normalized = normalizeScores(rawScores)

  const scored: ScoredCandidate[] = candidates.map((c, i) => {
    const ns = normalized[String(i)]
    return {
      ...c,
      scenicScore: ns.scenicScore,
      infraScore: ns.infraScore,
      calmScore: ns.calmScore,
      scenicPoiCount: ns.scenicPoiCount,
      infraSegmentCount: ns.infraSegmentCount,
      lightScore: ns.lightScore,
      lightCount: ns.lightCount,
    }
  })

  // Pick fastest: minimum duration
  const fastest = scored.reduce((best, c) =>
    c.durationSec < best.durationSec ? c : best,
  )

  // Pick scenic: highest scenic score, excluding fastest if possible
  const scenicPool = scored.length > 1
    ? scored.filter((c) => c !== fastest)
    : scored
  const scenic = scenicPool.reduce((best, c) =>
    c.scenicScore > best.scenicScore ? c : best,
  )

  // Pick calm: highest infra score, excluding already-picked if possible
  const calmPool = scored.length > 2
    ? scored.filter((c) => c !== fastest && c !== scenic)
    : scored.length > 1
      ? scored.filter((c) => c !== fastest)
      : scored
  const calm = calmPool.reduce((best, c) =>
    c.infraScore > best.infraScore ? c : best,
  )

  // Pick fewestLights: minimum light score, excluding already-picked if possible
  const lightsPool = scored.length > 3
    ? scored.filter((c) => c !== fastest && c !== scenic && c !== calm)
    : scored.length > 2
      ? scored.filter((c) => c !== fastest && c !== scenic)
      : scored.length > 1
        ? scored.filter((c) => c !== fastest)
        : scored
  const fewestLights = lightsPool.reduce((best, c) =>
    c.lightScore < best.lightScore ? c : best,
  )

  const toScoredRoute = (c: ScoredCandidate): ScoredRoute => ({
    response: c.response,
    durationSec: c.durationSec,
    distanceKm: c.distanceKm,
    scenicScore: c.scenicScore,
    infraScore: c.infraScore,
    calmScore: c.calmScore,
    scenicPoiCount: c.scenicPoiCount,
    infraSegmentCount: c.infraSegmentCount,
    lightScore: c.lightScore,
    lightCount: c.lightCount,
  })

  return {
    fastest: toScoredRoute(fastest),
    scenic: toScoredRoute(scenic),
    calm: toScoredRoute(calm),
    fewestLights: toScoredRoute(fewestLights),
  }
}
