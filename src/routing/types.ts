/** [lat, lon] in WGS84 degrees. */
export type LatLng = [number, number]

export type LatLon = { lat: number; lon: number }

export type CyclingOptimization =
  | { triangle: { time: number; safety: number; flatness: number } }
  | { type: 'FLAT_STREETS' | 'SAFE_STREETS' | 'SHORTEST_DURATION' }

/** One OTP planConnection call: direct bicycle route, optionally through one waypoint. */
export type OtpRequest = {
  from: LatLon
  to: LatLon
  via?: LatLon
  optimization: CyclingOptimization
}

/** The subset of OTP `step` fields the engine uses. */
export type OtpStep = {
  distance: number
  streetName: string
  /** True when OTP generated the name ("bike path", "path", …) — the way has no name. */
  bogusName: boolean
  /** True when the step crosses an open area (square, plaza) rather than following a way. */
  area: boolean
  walkingBike: boolean
}

/** A route as returned by OTP, before scoring. */
export type Candidate = {
  /** Geometry hash: identical geometries from different generators share an id. */
  id: string
  /** Which generators produced this geometry, e.g. `preset:fastest`, `via:lights`. */
  generators: string[]
  durationSec: number
  distanceM: number
  /** Decoded leg geometries; a via route has two legs. */
  legs: LatLng[][]
  /** Steps of each leg, aligned with `legs`. */
  legSteps: OtpStep[][]
  /** Length of an out-and-back stub removed at a via point. */
  spurTrimmedM?: number
}

export type StressClass = 'away' | 'quiet' | 'adjacent' | 'mixedLow' | 'mixedHigh'

export type CalmBand = 'veryCalm' | 'calm' | 'mixed' | 'busy'

/**
 * Why a signal counted: `on` the route passes through the node, `cross` the route crosses
 * a major road next to one of its signals, `near` the route crosses an open area close to it.
 */
export type SignalRule = 'on' | 'cross' | 'near'

export type SignalStop = {
  at: LatLng
  alongM: number
  rule: SignalRule
}

export type RouteProfile = {
  lengthM: number
  lights: number
  signalStops: SignalStop[]
  /** Metres travelled in each traffic-stress class. */
  stressM: Record<StressClass, number>
  /** At-grade crossings of a major road without a signal nearby. */
  majorCrossings: number
  walkM: number
  /** 0–100, absolute: the same route always gets the same number. */
  calmIndex: number
  calmBand: CalmBand
}

export type ProfiledCandidate = Candidate & { profile: RouteProfile }

export type Category = 'fastest' | 'fewestLights' | 'calm'

export type RouteCard = {
  routeId: string
  primary: Category
  /** Other categories this route also wins. */
  badges: Category[]
  /** Extra travel time compared with Fastest. */
  extraSec: number
}

export type SelectionResult = {
  cards: RouteCard[]
  /** Route id that wins each category (may repeat across categories). */
  winners: Record<Category, string>
  /** Human-readable notes on why categories merged or were dropped. */
  reasons: string[]
}

export type RoutePlan = {
  routes: ProfiledCandidate[]
  selection: SelectionResult
  meta: {
    calls: number
    failed: number
    /** True when the deadline cut off optional work (round-2 candidates). */
    partial: boolean
    configVersion: string
  }
}
