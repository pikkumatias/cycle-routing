import type { RoutingConfig } from './config.js'
import { bearingDeg, lineAngleDiff, segmentDistance } from './geo.js'
import type { Layers, WinterKind } from './layers.js'
import type { LatLng } from './types.js'

/**
 * Metres of the route on priority winter-maintained routes, per kind. A route segment counts
 * when its midpoint lies within `matchM` of a winter route running the same way; crossing one
 * does not count. Where both kinds match, brush-salting (the higher standard) wins.
 */
export function winterMetres(
  segments: Array<{ a: LatLng; b: LatLng; lengthM: number }>,
  layers: Layers,
  cfg: RoutingConfig,
): Record<WinterKind, number> {
  const { matchM, parallelDeg } = cfg.winter
  const out: Record<WinterKind, number> = { brush: 0, plough: 0 }
  for (const { a, b, lengthM } of segments) {
    const mid: LatLng = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const bearing = bearingDeg(a, b)
    let kind: WinterKind | null = null
    for (const w of layers.winter.near(mid, matchM)) {
      if (kind === 'brush') break
      if (
        segmentDistance(mid, w.a, w.b).distanceM <= matchM &&
        lineAngleDiff(bearing, bearingDeg(w.a, w.b)) <= parallelDeg
      ) {
        kind = w.kind
      }
    }
    if (kind) out[kind] += lengthM
  }
  return out
}
