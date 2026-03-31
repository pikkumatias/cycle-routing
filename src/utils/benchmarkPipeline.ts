import type { LatLng } from './routeGeometry'
import type { OsmPoi } from './overpass'
import { haversineDistance, samplePolyline, scoreRouteDetailed, normalizeScores } from './scenicScore'

export type LabeledCandidate = {
  presetLabel: string
  durationSec: number
  distanceKm: number
  polyline: LatLng[]
}

export type DeduplicateResult = {
  kept: LabeledCandidate[]
  dropped: Array<{ candidate: LabeledCandidate; duplicateOf: LabeledCandidate }>
}

export type ScoredLabeledCandidate = LabeledCandidate & {
  scenicScore: number
  infraScore: number
  calmScore: number
}

export type SelectedRoutes = {
  fastest: ScoredLabeledCandidate
  scenic: ScoredLabeledCandidate
  calm: ScoredLabeledCandidate
}

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
 * N×N matrix where matrix[i][j] is the fraction of candidate i's points
 * within thresholdM of candidate j's polyline.
 */
export function buildOverlapMatrix(
  candidates: LabeledCandidate[],
  thresholdM: number = 50,
  step: number = 3,
): number[][] {
  return candidates.map((a, i) =>
    candidates.map((b, j) =>
      i === j ? 1 : computeOverlap(a.polyline, b.polyline, thresholdM, step),
    ),
  )
}

/**
 * Remove near-duplicate candidates (bidirectional overlap > threshold).
 * Sorted by duration first so the faster route always survives.
 */
export function deduplicateWithTracking(
  candidates: LabeledCandidate[],
  overlapThreshold: number = 0.85,
): DeduplicateResult {
  const sorted = [...candidates].sort((a, b) => a.durationSec - b.durationSec)
  const kept: LabeledCandidate[] = []
  const dropped: DeduplicateResult['dropped'] = []

  for (const candidate of sorted) {
    const duplicateOf = kept.find(
      (existing) =>
        computeOverlap(candidate.polyline, existing.polyline) > overlapThreshold &&
        computeOverlap(existing.polyline, candidate.polyline) > overlapThreshold,
    )
    if (duplicateOf) {
      dropped.push({ candidate, duplicateOf })
    } else {
      kept.push(candidate)
    }
  }

  return { kept, dropped }
}

/** Format seconds as "Xm Ys". */
export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${s}s`
}

/**
 * Score all candidates against POIs and select the best per category.
 * Uses the same logic as the app's selectRoutes — fastest by duration,
 * scenic by highest scenic score, calm by highest infra score.
 */
export function selectWithLabels(
  candidates: LabeledCandidate[],
  pois: OsmPoi[],
): SelectedRoutes {
  if (candidates.length === 0) throw new Error('No candidates to select from')

  const rawScores: Record<string, ReturnType<typeof scoreRouteDetailed>> = {}
  for (let i = 0; i < candidates.length; i++) {
    rawScores[String(i)] = scoreRouteDetailed(pois, candidates[i].polyline)
  }
  const normalized = normalizeScores(rawScores)

  const scored: ScoredLabeledCandidate[] = candidates.map((c, i) => ({
    ...c,
    scenicScore: normalized[String(i)].scenicScore,
    infraScore: normalized[String(i)].infraScore,
    calmScore: normalized[String(i)].calmScore,
  }))

  const fastest = scored.reduce((best, c) => (c.durationSec < best.durationSec ? c : best))

  const scenicPool = scored.length > 1 ? scored.filter((c) => c !== fastest) : scored
  const scenic = scenicPool.reduce((best, c) => (c.scenicScore > best.scenicScore ? c : best))

  const calmPool =
    scored.length > 2
      ? scored.filter((c) => c !== fastest && c !== scenic)
      : scored.length > 1
        ? scored.filter((c) => c !== fastest)
        : scored
  const calm = calmPool.reduce((best, c) => (c.infraScore > best.infraScore ? c : best))

  return { fastest, scenic, calm }
}
