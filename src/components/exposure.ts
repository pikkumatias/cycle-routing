import type { CalmBand, PlannedRoute } from '../api/routePlan'
import type { StressClass } from '../routing/types'

/** Traffic exposure as riders read it: the engine's five stress classes in four buckets. */
export type ExposureBucket = 'carFree' | 'quiet' | 'adjacent' | 'traffic'

/** Calmest first. */
export const EXPOSURE_BUCKETS: ExposureBucket[] = ['carFree', 'quiet', 'adjacent', 'traffic']

const BUCKET_OF: Record<StressClass, ExposureBucket> = {
  away: 'carFree',
  quiet: 'quiet',
  adjacent: 'adjacent',
  mixedLow: 'traffic',
  mixedHigh: 'traffic',
}

/** Each bucket is drawn in the calm-band colour it corresponds to. */
export const BUCKET_BAND: Record<ExposureBucket, CalmBand> = {
  carFree: 'veryCalm',
  quiet: 'calm',
  adjacent: 'mixed',
  traffic: 'busy',
}

/** Share of the route in each bucket, as whole percentages summing to 100 (empty buckets left out). */
export function exposureShares(stressM: PlannedRoute['stressM']): { bucket: ExposureBucket; percent: number }[] {
  const metres = Object.fromEntries(EXPOSURE_BUCKETS.map((b) => [b, 0])) as Record<ExposureBucket, number>
  for (const cls of Object.keys(stressM) as StressClass[]) metres[BUCKET_OF[cls]] += stressM[cls]
  const total = EXPOSURE_BUCKETS.reduce((sum, b) => sum + metres[b], 0)
  if (total <= 0) return []

  // Largest remainder, so the rounded shares still add up to 100
  const exact = EXPOSURE_BUCKETS.map((bucket) => ({ bucket, exact: (100 * metres[bucket]) / total }))
  const shares = exact.map(({ bucket, exact: e }) => ({ bucket, percent: Math.floor(e), rest: e - Math.floor(e) }))
  let missing = 100 - shares.reduce((sum, s) => sum + s.percent, 0)
  for (const s of [...shares].sort((a, b) => b.rest - a.rest)) {
    if (missing-- <= 0) break
    s.percent++
  }
  return shares.filter((s) => s.percent > 0).map(({ bucket, percent }) => ({ bucket, percent }))
}

/** The route's stress runs as bucket stretches from 0 to 1 along it, neighbours of one bucket merged. */
export function exposureRuns(stressRuns: PlannedRoute['stressRuns']): { bucket: ExposureBucket; from: number; to: number }[] {
  const length = stressRuns.length ? stressRuns[stressRuns.length - 1][0] : 0
  if (length <= 0) return []
  const out: { bucket: ExposureBucket; from: number; to: number }[] = []
  let from = 0
  for (const [endM, cls] of stressRuns) {
    const bucket = BUCKET_OF[cls]
    const to = endM / length
    const last = out[out.length - 1]
    if (last?.bucket === bucket) last.to = to
    else out.push({ bucket, from, to })
    from = to
  }
  return out
}
