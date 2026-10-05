import type { RoutingConfig } from './config.js'
import { GridIndex, haversineDistance, resample } from './geo.js'
import type { LatLng } from './types.js'

const SAMPLE_M = 10

/** A route resampled every 10 m with a spatial index, for repeated overlap checks. */
export type Shape = { points: LatLng[]; index: GridIndex<LatLng>; lengthM: number }

export function buildShape(poly: LatLng[]): Shape {
  const points = resample(poly, SAMPLE_M)
  const index = new GridIndex<LatLng>(50)
  for (const p of points) index.insert(p, [p])
  return { points, index, lengthM: Math.max(0, (points.length - 1) * SAMPLE_M) }
}

/** Metres of `route` lying farther than `tolM` from every one of `others`. */
export function distinctLengthM(route: Shape, others: Shape[], tolM: number): number {
  let distinct = 0
  for (const p of route.points) {
    const covered = others.some((o) => o.index.near(p, tolM).some((q) => haversineDistance(p, q) <= tolM))
    if (!covered) distinct += SAMPLE_M
  }
  return distinct
}

/**
 * A route is distinct from the shown routes when at least
 * max(minDistinctM, minDistinctFrac × its length) of it runs elsewhere. An absolute floor
 * keeps short trips from treating a one-block jog as a different route; the fraction keeps
 * long trips from needing kilometres of difference.
 */
export function isDistinct(route: Shape, shown: Shape[], cfg: RoutingConfig): boolean {
  if (shown.length === 0) return true
  const { tolM, minDistinctM, minDistinctFrac } = cfg.similarity
  return distinctLengthM(route, shown, tolM) >= Math.max(minDistinctM, minDistinctFrac * route.lengthM)
}
