import type { RoutingConfig } from './config.js'
import { cumulativeLengths } from './geo.js'
import type { Layers } from './layers.js'
import { findSignalStops } from './signals.js'
import { classifySegments, findMajorCrossings } from './stress.js'
import type { CalmBand, Candidate, LatLng, RouteProfile, StressClass } from './types.js'

/** The whole route as one polyline; the shared point where two legs meet appears once. */
export function routePolyline(legs: LatLng[][]): LatLng[] {
  const out: LatLng[] = []
  for (const leg of legs) {
    for (const p of leg) {
      const last = out[out.length - 1]
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
    }
  }
  return out
}

/**
 * Calm index 0–100 from metres per stress class and unsignalised major crossings:
 * `100 × (1 − (Σ w_class × metres + penalty × crossings) / length)`, clamped. Absolute — it
 * depends only on the route, never on which other routes are in the pool.
 */
export function calmIndex(
  stressM: Record<StressClass, number>,
  majorCrossings: number,
  lengthM: number,
  cfg: RoutingConfig,
): number {
  if (lengthM <= 0) return 100
  let weighted = majorCrossings * cfg.stress.crossingPenaltyM
  for (const cls of Object.keys(stressM) as StressClass[]) weighted += stressM[cls] * cfg.stress.weights[cls]
  return Math.round(100 * Math.max(0, Math.min(1, 1 - weighted / lengthM)))
}

export function calmBand(index: number, cfg: RoutingConfig): CalmBand {
  return (cfg.stress.bands.find((b) => index >= b.min) ?? cfg.stress.bands[cfg.stress.bands.length - 1]).band
}

export function profileRoute(candidate: Candidate, layers: Layers, cfg: RoutingConfig): RouteProfile {
  const poly = routePolyline(candidate.legs)
  const cum = cumulativeLengths(poly)
  const lengthM = cum[cum.length - 1] ?? 0

  const segments = classifySegments(poly, candidate.legSteps.flat(), layers, cfg)
  const crossings = findMajorCrossings(poly, cum, segments, layers, cfg)
  const signalStops = findSignalStops(poly, cum, segments, crossings, layers, cfg)

  const stressM: Record<StressClass, number> = { away: 0, quiet: 0, adjacent: 0, mixedLow: 0, mixedHigh: 0 }
  let walkM = 0
  for (const s of segments) {
    stressM[s.stress] += s.lengthM
    if (s.step?.walkingBike) walkM += s.lengthM
  }
  const majorCrossings = crossings.filter((c) => !c.signal).length
  const index = calmIndex(stressM, majorCrossings, lengthM, cfg)

  return {
    lengthM,
    lights: signalStops.length,
    signalStops,
    stressM,
    majorCrossings,
    walkM,
    calmIndex: index,
    calmBand: calmBand(index, cfg),
  }
}
