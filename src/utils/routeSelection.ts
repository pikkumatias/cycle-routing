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
  nearbyPois: OsmPoi[]
}

/** Score every candidate against the POI set and normalize scores across the pool. */
function scoreCandidates(
  candidates: CandidateRoute[],
  pois: OsmPoi[],
): ScoredCandidate[] {
  const rawScores: Record<string, ReturnType<typeof scoreRouteDetailed>> = {}
  for (let i = 0; i < candidates.length; i++) {
    rawScores[String(i)] = scoreRouteDetailed(pois, candidates[i].polyline)
  }

  const normalized = normalizeScores(rawScores)

  return candidates.map((c, i) => {
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
      nearbyPois: ns.nearbyPois,
    }
  })
}

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
  nearbyPois: c.nearbyPois,
})

/** Fewest lights may cost at most this share of Fastest's duration… */
export const FEWEST_LIGHTS_MAX_EXTRA_FRACTION = 0.3
/** …but short trips may always spend at least this many extra seconds. */
export const FEWEST_LIGHTS_MIN_EXTRA_SEC = 240
/** A route must avoid at least this many lights to be shown instead of Fastest. */
export const MIN_LIGHTS_SAVED = 2

/**
 * Select the two default categories shown up front:
 * - Fastest: lowest duration
 * - FewestLights: fewest signal stops among routes within the detour cap
 *   (ties → faster). It must save at least MIN_LIGHTS_SAVED lights over Fastest;
 *   otherwise Fastest is returned for both, since a ±1 difference is within counting
 *   noise and not worth a slower route. Callers detect the merge by identity.
 */
export function selectDefaultRoutes(
  candidates: CandidateRoute[],
  pois: OsmPoi[],
): Pick<Record<RouteCategory, ScoredRoute>, 'fewestLights' | 'fastest'> {
  if (candidates.length === 0) {
    throw new Error('No candidate routes available')
  }

  const scored = scoreCandidates(candidates, pois)

  const fastest = scored.reduce((best, c) =>
    c.durationSec < best.durationSec ? c : best,
  )
  const maxDurationSec =
    fastest.durationSec +
    Math.max(fastest.durationSec * FEWEST_LIGHTS_MAX_EXTRA_FRACTION, FEWEST_LIGHTS_MIN_EXTRA_SEC)
  const fewestLights = scored
    .filter((c) => c.durationSec <= maxDurationSec)
    .reduce((best, c) =>
      c.lightCount < best.lightCount ||
      (c.lightCount === best.lightCount && c.durationSec < best.durationSec)
        ? c
        : best,
    )

  const fastestRoute = toScoredRoute(fastest)
  const savesEnough = fastest.lightCount - fewestLights.lightCount >= MIN_LIGHTS_SAVED
  return {
    fastest: fastestRoute,
    fewestLights: savesEnough ? toScoredRoute(fewestLights) : fastestRoute,
  }
}

/**
 * Pick the Calm route (highest cycling-infrastructure score) from the pool, skipping
 * routes already shown as other cards so it never duplicates them. Returns null when
 * every candidate is already shown.
 */
export function selectCalmRoute(
  candidates: CandidateRoute[],
  pois: OsmPoi[],
  shownResponses: unknown[],
): ScoredRoute | null {
  const shown = new Set(shownResponses)
  // Score the whole pool so normalised scores stay comparable, then skip shown routes.
  const remaining = scoreCandidates(candidates, pois).filter((c) => !shown.has(c.response))
  if (remaining.length === 0) return null

  return toScoredRoute(
    remaining.reduce((best, c) => (c.infraScore > best.infraScore ? c : best)),
  )
}
