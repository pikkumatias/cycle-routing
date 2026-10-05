import type { RoutingConfig } from './config.js'
import { haversineDistance, bearingDeg, lineAngleDiff, segmentDistance, toLocal } from './geo.js'
import type { Layers, Road, RoadSegment } from './layers.js'
import type { LatLng, OtpStep, StressClass } from './types.js'

/** One segment of the route polyline with what it was matched to. */
export type RouteSegment = {
  a: LatLng
  b: LatLng
  startM: number
  lengthM: number
  /** The major road the route rides on along this segment, if any. */
  onRoad: Road | null
  step: OtpStep | null
  stress: StressClass
  /** On a bridge or in a tunnel: nothing at ground level is crossed or passed. */
  gradeSeparated: boolean
}

export type MajorCrossing = {
  alongM: number
  at: LatLng
  road: Road
  /** Nearest signal of the crossed road within `signals.crossM`, if any. */
  signal: LatLng | null
}

/** Route segments run parallel to a road within this angle to count as riding on it. */
const PARALLEL_DEG = 20
const CAR_FREE_NAMES = new Set(['bike path', 'path', 'cycleway', 'footway', 'open area', 'track'])

/** Assign each route segment the OTP step it belongs to, by distance travelled. */
function stepAt(steps: OtpStep[], stepEnds: number[], alongM: number): OtpStep | null {
  for (let i = 0; i < steps.length; i++) if (alongM < stepEnds[i]) return steps[i]
  return steps.length > 0 ? steps[steps.length - 1] : null
}

function isCarFree(step: OtpStep | null): boolean {
  if (!step) return false
  return step.walkingBike || step.area || (step.bogusName && CAR_FREE_NAMES.has(step.streetName.toLowerCase()))
}

/**
 * Split the route into segments and classify each one's traffic stress:
 * - on a major road → `mixedHigh`, or `mixedLow` with a painted lane or ≤30 km/h (tram rails
 *   always `mixedHigh`);
 * - car-free (unnamed path, open area, walking) → `adjacent` within `adjacentM` of a major
 *   road, else `away`;
 * - a named street that carries the name of a nearby major road is a sidewalk track OTP
 *   named after it → `adjacent`;
 * - any other named street → `quiet`.
 */
export function classifySegments(
  poly: LatLng[],
  steps: OtpStep[],
  layers: Layers,
  cfg: RoutingConfig,
): RouteSegment[] {
  const stepEnds: number[] = []
  let acc = 0
  for (const s of steps) stepEnds.push((acc += s.distance))

  const { onRoadM, adjacentM } = cfg.stress
  const segments: RouteSegment[] = []
  let startM = 0
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]
    const b = poly[i + 1]
    const lengthM = haversineDistance(a, b)
    if (lengthM === 0) continue
    const mid: LatLng = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const bearing = bearingDeg(a, b)
    const step = stepAt(steps, stepEnds, startM + lengthM / 2)

    let onRoad: Road | null = null
    let onRoadDist = Infinity
    let nearestRoadDist = Infinity
    let nearestNamedRoad: Road | null = null
    for (const seg of layers.roadSegments.near(mid, adjacentM)) {
      if (seg.road.grade === 'tunnel') continue
      const { distanceM } = segmentDistance(mid, seg.a, seg.b)
      if (distanceM < nearestRoadDist) nearestRoadDist = distanceM
      if (distanceM <= adjacentM && seg.road.name && seg.road.name === step?.streetName) {
        nearestNamedRoad = seg.road
      }
      if (
        distanceM <= onRoadM &&
        distanceM < onRoadDist &&
        lineAngleDiff(bearing, bearingDeg(seg.a, seg.b)) <= PARALLEL_DEG
      ) {
        onRoad = seg.road
        onRoadDist = distanceM
      }
    }

    const gradeSeparated =
      onRoad?.grade !== undefined ||
      layers.gradeSeparated
        .near(mid, onRoadM)
        .some(
          (g) =>
            segmentDistance(mid, g.a, g.b).distanceM <= onRoadM &&
            lineAngleDiff(bearing, bearingDeg(g.a, g.b)) <= PARALLEL_DEG,
        )

    let stress: StressClass
    if (onRoad && !isCarFree(step)) {
      const calmer = !onRoad.tram && (onRoad.bikeLane || (onRoad.maxspeed !== undefined && onRoad.maxspeed <= 30))
      stress = calmer ? 'mixedLow' : 'mixedHigh'
    } else if (isCarFree(step)) {
      stress = nearestRoadDist <= adjacentM ? 'adjacent' : 'away'
    } else if (nearestNamedRoad) {
      stress = 'adjacent'
    } else {
      stress = 'quiet'
    }

    segments.push({ a, b, startM, lengthM, onRoad: isCarFree(step) ? null : onRoad, step, stress, gradeSeparated })
    startM += lengthM
  }
  return segments
}

/** Ignore route points this close to a road's centre line when looking for a side change. */
const ON_LINE_M = 0.5
/** Look for crossings among route points this close to a road segment. */
const CROSS_SEARCH_M = 30
/** Crossings closer than this along the route (dual carriageways, junction arms) merge. */
const CROSSING_MERGE_M = 30

/**
 * At-grade crossings of major roads. OTP routes usually cross a road *through* the shared
 * OSM node, so a crossing is detected as the route changing sides of a road segment's line
 * (points on the line are skipped), not as a proper segment intersection. Riding along the
 * road, grade-separated roads, and passing over/under while on a bridge or in a tunnel never
 * count.
 */
export function findMajorCrossings(
  poly: LatLng[],
  cum: number[],
  segments: RouteSegment[],
  layers: Layers,
  cfg: RoutingConfig,
): MajorCrossing[] {
  const nearby = new Set<RoadSegment>()
  for (const p of poly) for (const seg of layers.roadSegments.near(p, CROSS_SEARCH_M)) nearby.add(seg)

  const overlapping = (fromM: number, toM: number) =>
    segments.filter((s) => s.startM + s.lengthM >= fromM - 5 && s.startM <= toM + 5)
  const ridingOnOrAbove = (road: Road, fromM: number, toM: number) =>
    overlapping(fromM, toM).some((s) => s.onRoad === road || s.gradeSeparated)

  const found: MajorCrossing[] = []
  for (const seg of nearby) {
    if (seg.road.grade) continue
    const [ex, ey] = toLocal(seg.b, seg.a)
    const segLen = Math.hypot(ex, ey)
    if (segLen === 0) continue
    let lastSide = 0
    let lastIdx = -1
    let lastDist = 0
    for (let i = 0; i < poly.length; i++) {
      const [px, py] = toLocal(poly[i], seg.a)
      const along = (px * ex + py * ey) / segLen // position along the road segment, metres
      const offset = (ex * py - ey * px) / segLen // signed distance from the road line
      const inRange = along >= -2 && along <= segLen + 2 && Math.abs(offset) <= CROSS_SEARCH_M
      if (!inRange) {
        lastSide = 0
        continue
      }
      if (Math.abs(offset) <= ON_LINE_M) continue
      const side = Math.sign(offset)
      if (lastSide !== 0 && side !== lastSide && cum[i] - cum[lastIdx] <= 2 * CROSS_SEARCH_M) {
        const f = lastDist / (lastDist + Math.abs(offset))
        const alongM = cum[lastIdx] + (cum[i] - cum[lastIdx]) * f
        const at: LatLng = [
          poly[lastIdx][0] + (poly[i][0] - poly[lastIdx][0]) * f,
          poly[lastIdx][1] + (poly[i][1] - poly[lastIdx][1]) * f,
        ]
        if (!ridingOnOrAbove(seg.road, cum[lastIdx], cum[i])) {
          let signal: LatLng | null = null
          let best = cfg.signals.crossM
          for (const s of seg.road.signals) {
            const d = haversineDistance(s, at)
            if (d <= best) {
              best = d
              signal = s
            }
          }
          found.push({ alongM, at, road: seg.road, signal })
        }
      }
      lastSide = side
      lastIdx = i
      lastDist = Math.abs(offset)
    }
  }

  found.sort((x, y) => x.alongM - y.alongM)
  const merged: MajorCrossing[] = []
  for (const c of found) {
    const prev = merged[merged.length - 1]
    if (prev && c.alongM - prev.alongM <= CROSSING_MERGE_M) {
      if (!prev.signal && c.signal) prev.signal = c.signal
      continue
    }
    merged.push({ ...c })
  }
  return merged
}
