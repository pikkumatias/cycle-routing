// Shared fixtures for the routing engine's unit tests (not imported by production code).
import polyline from '@mapbox/polyline'
import { DEFAULT_CONFIG } from './config.js'
import { offsetPoint } from './geo.js'
import { buildLayers, type Layers, type RoadRecord } from './layers.js'
import { profileRoute } from './profile.js'
import type { Candidate, LatLng, OtpStep, ProfiledCandidate, RouteProfile } from './types.js'

const ORIGIN: LatLng = [60.17, 24.93]

/** Point `east` / `north` metres from a fixed origin in central Helsinki. */
export const at = (east: number, north: number): LatLng => offsetPoint(ORIGIN, east, north)

/** Polyline through the given metre coordinates, with a vertex every `stepM` metres. */
export function line(points: Array<[number, number]>, stepM = 10): LatLng[] {
  const out: LatLng[] = [at(...points[0])]
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]
    const [x1, y1] = points[i]
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / stepM))
    for (let k = 1; k <= n; k++) out.push(at(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n))
  }
  return out
}

export type TestRoad = Omit<RoadRecord, 'geom' | 'signals'> & {
  points: Array<[number, number]>
  /** Signals on this road, in metres; they are also added to the global signal layer. */
  signals?: Array<[number, number]>
}

export function makeLayers(opts: {
  signals?: Array<[number, number]>
  roads?: TestRoad[]
  calmNodes?: Array<[number, number]>
  gradeSeparated?: Array<Array<[number, number]>>
}): Layers {
  const signals: LatLng[] = (opts.signals ?? []).map((p) => at(...p))
  const roads: RoadRecord[] = (opts.roads ?? []).map(({ points, signals: roadSignals, ...rest }) => {
    const indices = (roadSignals ?? []).map((p) => signals.push(at(...p)) - 1)
    return { ...rest, geom: polyline.encode(line(points), 6), signals: indices }
  })
  return buildLayers({
    version: 1,
    generatedAt: 'test',
    osmTimestamp: 'test-data',
    bbox: [60, 24, 61, 26],
    signals,
    roads,
    calmNodes: (opts.calmNodes ?? []).map((p) => at(...p)),
    gradeSeparated: (opts.gradeSeparated ?? []).map((g) => polyline.encode(line(g), 6)),
  })
}

export const step = (distance: number, streetName = 'Testikatu', extra: Partial<OtpStep> = {}): OtpStep => ({
  distance,
  streetName,
  bogusName: false,
  area: false,
  walkingBike: false,
  ...extra,
})

/** A car-free step as OTP reports an unnamed cycleway. */
export const pathStep = (distance: number, extra: Partial<OtpStep> = {}) =>
  step(distance, 'bike path', { bogusName: true, ...extra })

export function makeCandidate(
  id: string,
  legs: LatLng[][],
  durationSec: number,
  legSteps?: OtpStep[][],
): Candidate {
  return {
    id,
    generators: ['test'],
    durationSec,
    distanceM: 0,
    legs,
    legSteps: legSteps ?? legs.map(() => [pathStep(1e6)]),
  }
}

export function profiled(candidate: Candidate, layers: Layers, cfg = DEFAULT_CONFIG): ProfiledCandidate {
  return { ...candidate, profile: profileRoute(candidate, layers, cfg) }
}

/** A candidate with a hand-written profile, for selection tests. */
export function withProfile(
  id: string,
  points: Array<[number, number]>,
  durationSec: number,
  profile: Partial<RouteProfile>,
): ProfiledCandidate {
  return {
    ...makeCandidate(id, [line(points)], durationSec),
    profile: {
      lengthM: 0,
      lights: 0,
      signalStops: [],
      stressM: { away: 0, quiet: 0, adjacent: 0, mixedLow: 0, mixedHigh: 0 },
      majorCrossings: 0,
      walkM: 0,
      calmIndex: 50,
      calmBand: 'mixed',
      ...profile,
    },
  }
}
