import type { CalmBand, CyclingOptimization, StressClass } from './types.js'

export type PresetGenerator = { name: string; optimization: CyclingOptimization }

/**
 * Every tunable of the routing engine. Values marked *prior* are hand-set starting
 * points that the sandbox calibration replaces (see docs/routing-overhaul-todo.md).
 */
export type RoutingConfig = {
  /** Bump whenever a value changes so plans and labels can be traced to a config. */
  configVersion: string
  signals: {
    /** Rule `on`: a signal node this close to the route is passed through. */
    onM: number
    /** Rule `cross`: a signal on a crossed major road within this distance of the crossing. */
    crossM: number
    /** Rule `near`: fallback distance where the route crosses an open area. */
    nearM: number
    /** Hits closer than this along the route, from the first hit, are one stop. */
    windowM: number
  }
  stress: {
    /** Per-metre weight of each class in the calm index (prior). */
    weights: Record<StressClass, number>
    /** A separated path this close to a major road counts as `adjacent`. */
    adjacentM: number
    /** A route segment this close to a major road, running parallel, is on that road. */
    onRoadM: number
    /** Penalty per unsignalised major-road crossing, in metres of `mixedHigh` (prior). */
    crossingPenaltyM: number
    /** Lower calmIndex bound of each band, highest first (prior). */
    bands: Array<{ band: CalmBand; min: number }>
  }
  similarity: {
    /** Route points farther than this from another route count as different. */
    tolM: number
    /** A route is distinct if at least max(minDistinctM, minDistinctFrac × length) differs. */
    minDistinctM: number
    minDistinctFrac: number
  }
  caps: {
    /** Extra time allowed for a category: max(frac × Fastest, minSec). */
    fewestLights: { frac: number; minSec: number }
    calm: { frac: number; minSec: number }
  }
  /** Extra minutes accepted per light avoided (preference, prior). */
  minutesPerLight: number
  /** Calm points one extra minute must buy (preference, prior). */
  calmPointsPerMinute: number
  minLightGain: number
  minCalmGain: number
  /** A non-distinct route may still get a card if it beats the gain by this factor. */
  variantGainFactor: number
  generators: {
    round1: PresetGenerator[]
    /** Round-2 via waypoints per family; 0 disables the family. */
    lightsVias: number
    calmVias: number
    /** Snap radius from a target point to the nearest calm-network node. */
    snapM: number
  }
  spur: {
    /** Vertices closer than this are the same point when detecting an out-and-back stub. */
    matchM: number
    /** Discard via routes whose stub is longer than this. */
    maxM: number
  }
  otp: { timeoutMs: number; concurrency: number; deadlineMs: number }
}

export const DEFAULT_CONFIG: RoutingConfig = {
  configVersion: 'prior-1',
  signals: { onM: 3, crossM: 18, nearM: 12, windowM: 40 },
  stress: {
    weights: { away: 0, quiet: 0.15, adjacent: 0.35, mixedLow: 0.6, mixedHigh: 1 },
    adjacentM: 20,
    onRoadM: 4,
    crossingPenaltyM: 50,
    bands: [
      { band: 'veryCalm', min: 85 },
      { band: 'calm', min: 70 },
      { band: 'mixed', min: 50 },
      { band: 'busy', min: 0 },
    ],
  },
  similarity: { tolM: 25, minDistinctM: 400, minDistinctFrac: 0.2 },
  caps: {
    fewestLights: { frac: 0.3, minSec: 240 },
    calm: { frac: 0.4, minSec: 300 },
  },
  minutesPerLight: 1,
  calmPointsPerMinute: 3,
  minLightGain: 2,
  minCalmGain: 10,
  variantGainFactor: 1.5,
  generators: {
    round1: [
      { name: 'preset:fastest', optimization: { triangle: { time: 1, safety: 0, flatness: 0 } } },
      { name: 'preset:safety', optimization: { triangle: { time: 0, safety: 1, flatness: 0 } } },
      { name: 'preset:balanced', optimization: { triangle: { time: 0.34, safety: 0.33, flatness: 0.33 } } },
    ],
    lightsVias: 2,
    calmVias: 2,
    snapM: 250,
  },
  spur: { matchM: 3, maxM: 150 },
  otp: { timeoutMs: 4000, concurrency: 6, deadlineMs: 8000 },
}
