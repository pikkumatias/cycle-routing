import type { RoutingConfig } from './config.js'
import { bearingDeg, cumulativeLengths, haversineDistance, minDistanceToPolyline, offsetPoint } from './geo.js'
import type { Layers } from './layers.js'
import { routePolyline } from './profile.js'
import type { CyclingOptimization, LatLng, LatLon, ProfiledCandidate } from './types.js'

export type GeneratorRequest = { name: string; via?: LatLon; optimization: CyclingOptimization }

/** Via routes balance time and safety so the detour itself follows reasonable streets. */
export const VIA_OPTIMIZATION: CyclingOptimization = { triangle: { time: 0.5, safety: 0.5, flatness: 0 } }

/** A via point must leave the fastest route by at least this much to produce a new route. */
const MIN_VIA_OFFSET_M = 150
/** Via points closer than this to each other produce near-identical routes. */
const MIN_VIA_SPACING_M = 200
/** Length of the stretch searched for the densest cluster of signal stops. */
const SIGNAL_WINDOW_M = 800

const toLatLon = ([lat, lon]: LatLng): LatLon => ({ lat, lon })

/** Point and travel bearing at `alongM` metres along the polyline. */
function pointAlong(poly: LatLng[], cum: number[], alongM: number): { point: LatLng; bearing: number } {
  let i = 1
  while (i < poly.length - 1 && cum[i] < alongM) i++
  const a = poly[i - 1]
  const b = poly[i]
  const span = cum[i] - cum[i - 1]
  const f = span > 0 ? Math.max(0, Math.min(1, (alongM - cum[i - 1]) / span)) : 0
  return { point: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], bearing: bearingDeg(a, b) }
}

/** `distanceM` to the left (side −1) or right (side 1) of a travel bearing. */
function sideways(point: LatLng, bearing: number, side: 1 | -1, distanceM: number): LatLng {
  const rad = ((bearing + side * 90) * Math.PI) / 180
  return offsetPoint(point, Math.sin(rad) * distanceM, Math.cos(rad) * distanceM)
}

/** Nearest calm-network node within `snapM` that is far enough off the fastest route. */
function snapToCalmNode(target: LatLng, fastestPoly: LatLng[], layers: Layers, snapM: number): LatLng | null {
  let best: LatLng | null = null
  let bestDist = snapM
  for (const n of layers.calmNodes.near(target, snapM)) {
    const d = haversineDistance(n, target)
    if (d <= bestDist && minDistanceToPolyline(n, fastestPoly) >= MIN_VIA_OFFSET_M) {
      best = n
      bestDist = d
    }
  }
  return best
}

function pickSpaced(points: LatLng[], count: number): LatLng[] {
  const picked: LatLng[] = []
  for (const p of points) {
    if (picked.length >= count) break
    if (picked.every((q) => haversineDistance(p, q) >= MIN_VIA_SPACING_M)) picked.push(p)
  }
  return picked
}

/**
 * Waypoints that steer around the densest cluster of signal stops on the fastest route:
 * 300 m and 600 m to either side of the middle of the 800 m stretch with the most stops,
 * snapped onto car-free paths. None when the fastest route has fewer than two stops there.
 */
export function lightsVias(fastest: ProfiledCandidate, layers: Layers, cfg: RoutingConfig): GeneratorRequest[] {
  const count = cfg.generators.lightsVias
  const stops = fastest.profile.signalStops.map((s) => s.alongM)
  if (count === 0 || stops.length < 2) return []

  // Most stops within SIGNAL_WINDOW_M; among equally dense stretches the tightest one.
  let bestStart = 0
  let bestCount = 0
  let bestSpan = Infinity
  for (let i = 0; i < stops.length; i++) {
    let j = i
    while (j < stops.length && stops[j] - stops[i] <= SIGNAL_WINDOW_M) j++
    const span = stops[j - 1] - stops[i]
    if (j - i > bestCount || (j - i === bestCount && span < bestSpan)) {
      bestCount = j - i
      bestStart = i
      bestSpan = span
    }
  }
  if (bestCount < 2) return []

  const poly = routePolyline(fastest.legs)
  const cum = cumulativeLengths(poly)
  const centreM = (stops[bestStart] + stops[bestStart + bestCount - 1]) / 2
  const { point, bearing } = pointAlong(poly, cum, centreM)

  const snapped: LatLng[] = []
  for (const offset of [300, 600]) {
    for (const side of [1, -1] as const) {
      const node = snapToCalmNode(sideways(point, bearing, side, offset), poly, layers, cfg.generators.snapM)
      if (node) snapped.push(node)
    }
  }
  return pickSpaced(snapped, count).map((p) => ({ name: 'via:lights', via: toLatLon(p), optimization: VIA_OPTIMIZATION }))
}

/** Raw lateral targets: ⅓, ½, ⅔ of the way, 15 % and 30 % of the trip to either side. */
function lateralTargets(from: LatLng, to: LatLng): LatLng[] {
  const tripM = haversineDistance(from, to)
  const bearing = bearingDeg(from, to)
  const targets: LatLng[] = []
  for (const frac of [0.5, 0.33, 0.67]) {
    const base: LatLng = [from[0] + (to[0] - from[0]) * frac, from[1] + (to[1] - from[1]) * frac]
    for (const share of [0.15, 0.3]) {
      const offset = Math.max(250, Math.min(2000, share * tripM))
      for (const side of [1, -1] as const) targets.push(sideways(base, bearing, side, offset))
    }
  }
  return targets
}

/**
 * Waypoints pulling the route onto nearby car-free paths: lateral targets snapped onto the
 * calm network, keeping only those whose straight-line detour fits the calm cap.
 */
export function calmVias(
  from: LatLng,
  to: LatLng,
  fastest: ProfiledCandidate,
  layers: Layers,
  cfg: RoutingConfig,
): GeneratorRequest[] {
  const count = cfg.generators.calmVias
  if (count === 0) return []
  const poly = routePolyline(fastest.legs)
  const tripM = haversineDistance(from, to)
  const maxDetourM = tripM * (1 + cfg.caps.calm.frac)

  const snapped: LatLng[] = []
  for (const target of lateralTargets(from, to)) {
    const node = snapToCalmNode(target, poly, layers, cfg.generators.snapM)
    if (node && haversineDistance(from, node) + haversineDistance(node, to) <= maxDetourM) snapped.push(node)
  }
  return pickSpaced(snapped, count).map((p) => ({ name: 'via:calm', via: toLatLon(p), optimization: VIA_OPTIMIZATION }))
}

/** Unsnapped lateral waypoints — a sandbox-only baseline family to compare against. */
export function geometricVias(from: LatLng, to: LatLng): GeneratorRequest[] {
  return lateralTargets(from, to).map((p) => ({ name: 'via:geo', via: toLatLon(p), optimization: VIA_OPTIMIZATION }))
}

