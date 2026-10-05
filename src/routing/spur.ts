import type { RoutingConfig } from './config.js'
import { haversineDistance, polylineLength } from './geo.js'
import type { LatLng, OtpStep } from './types.js'

/**
 * Remove the out-and-back stub a via point can cause: when the waypoint sits off the
 * natural path, the route rides to it and returns the same way. The stub shows up as the
 * end of leg 1 matching the start of leg 2 in reverse. Returns the trimmed legs and steps
 * (the steps either side of the via point lose the stub's length) and the removed length
 * (one direction), or null when the stub is longer than `spur.maxM`, since such a route is
 * just a detour to an arbitrary point.
 */
export function trimSpur(
  legs: LatLng[][],
  legSteps: OtpStep[][],
  cfg: RoutingConfig,
): { legs: LatLng[][]; legSteps: OtpStep[][]; trimmedM: number } | null {
  if (legs.length < 2) return { legs, legSteps, trimmedM: 0 }
  const [first, second, ...rest] = legs
  const { matchM, maxM } = cfg.spur

  // j = 0 is the shared via point; count how far the reversed match continues.
  let matched = 0
  while (
    matched + 1 < first.length &&
    matched + 1 < second.length &&
    haversineDistance(first[first.length - 1 - (matched + 1)], second[matched + 1]) <= matchM
  ) {
    matched++
  }
  if (matched === 0) return { legs, legSteps, trimmedM: 0 }

  const trimmedM = polylineLength(second.slice(0, matched + 1))
  if (trimmedM > maxM) return null
  return {
    legs: [first.slice(0, first.length - matched), second.slice(matched), ...rest],
    legSteps: legSteps.map((steps, i) => shortenStep(steps, i === 0 ? steps.length - 1 : i === 1 ? 0 : -1, trimmedM)),
    trimmedM,
  }
}

/** Copy of `steps` with step `index` shortened by `byM` (no-op for index −1). */
function shortenStep(steps: OtpStep[], index: number, byM: number): OtpStep[] {
  if (index < 0 || index >= steps.length) return steps
  return steps.map((s, i) => (i === index ? { ...s, distance: Math.max(0, s.distance - byM) } : s))
}
