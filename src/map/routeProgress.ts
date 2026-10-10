import { cumulativeLengths, nearestOnPolyline, resample, haversineDistance } from '../routing/geo'
import type { LatLng } from '../utils/routeGeometry'

/**
 * Where each point lies along the route, as a fraction 0–1 of its length.
 * Used to place traffic-light pips on the ride ribbon.
 */
export function fractionsAlongRoute(legs: LatLng[][], points: LatLng[]): number[] {
  const line = legs.flat()
  if (line.length < 2 || points.length === 0) return []
  const cum = cumulativeLengths(line)
  const total = cum[cum.length - 1]
  if (total === 0) return points.map(() => 0)
  return points.map((p) => Math.min(1, Math.max(0, nearestOnPolyline(p, line, cum).alongM / total)))
}

/**
 * The point on `route` farthest from `reference`: where an alternative route is
 * most clearly its own line on the map, so its label is easy to attribute.
 * Falls back to the route's midpoint when the two routes overlap.
 */
export function mostDistinctPoint(route: LatLng[][], reference: LatLng[][]): LatLng | null {
  const line = route.flat()
  if (line.length === 0) return null
  const ref = reference.flat()
  const samples = resample(line, 50)
  const refSamples = resample(ref, 25)
  if (refSamples.length === 0) return samples[Math.floor(samples.length / 2)]

  let best: LatLng = samples[Math.floor(samples.length / 2)]
  let bestDist = 30 // metres; closer than this counts as overlapping
  // Skip the first and last 15 %: routes share their ends at the endpoints.
  const start = Math.floor(samples.length * 0.15)
  const end = Math.ceil(samples.length * 0.85)
  for (let i = start; i < end; i++) {
    let min = Infinity
    for (const r of refSamples) {
      const d = haversineDistance(samples[i], r)
      if (d < min) min = d
      if (min < bestDist) break
    }
    if (min > bestDist) {
      bestDist = min
      best = samples[i]
    }
  }
  return best
}
