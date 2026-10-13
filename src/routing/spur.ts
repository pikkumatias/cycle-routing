import type { RoutingConfig } from './config.js'
import { haversineDistance, polylineLength } from './geo.js'
import type { LatLng, OtpStep } from './types.js'

/**
 * Remove the out-and-back stub a via point can cause: when the waypoint sits off the
 * natural path, the route rides to it and returns the same way. The stub shows up as the
 * end of leg 1 matching the start of leg 2 in reverse. Returns the trimmed legs and steps
 * (the stub's length comes off the steps next to the via point, across as many steps as it
 * spans, so later steps stay aligned with the geometry) and the removed length
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
    legSteps: legSteps.map((steps, i) => (i === 0 ? shorten(steps, trimmedM, 'end') : i === 1 ? shorten(steps, trimmedM, 'start') : steps)),
    trimmedM,
  }
}

/**
 * Copy of `steps` with `byM` metres removed from its `end` or `start`, step by step. Elevation
 * profiles lose the same stretch (from the start, the rest shifts to start at 0).
 */
function shorten(steps: OtpStep[], byM: number, from: 'start' | 'end'): OtpStep[] {
  const out = steps.map((s) => ({ ...s }))
  let left = byM
  for (let k = 0; k < out.length && left > 0; k++) {
    const s = out[from === 'end' ? out.length - 1 - k : k]
    const cut = Math.min(s.distance, left)
    s.distance -= cut
    if (s.elevation) {
      s.elevation =
        from === 'end'
          ? s.elevation.filter(([m]) => m <= s.distance)
          : s.elevation.filter(([m]) => m >= cut).map(([m, e]): [number, number] => [m - cut, e])
    }
    left -= cut
  }
  return out
}
