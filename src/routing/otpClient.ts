import polyline from '@mapbox/polyline'
import { hashGeometry } from './geo.js'
import type { Candidate, CyclingOptimization, LatLon, OtpRequest, OtpStep } from './types.js'

export const DIGITRANSIT_ROUTING_ENDPOINT = 'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1'

/**
 * One OTP call. Resolves null when OTP finds no route; rejects on transport/API errors,
 * on its own timeout, or when `signal` aborts.
 */
export type OtpCall = (req: OtpRequest, signal?: AbortSignal) => Promise<Candidate | null>

function num(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Invalid number in OTP request: ${n}`)
  return String(Math.round(n * 1e6) / 1e6)
}

function coordinate({ lat, lon }: LatLon): string {
  return `{ latitude: ${num(lat)}, longitude: ${num(lon)} }`
}

function optimizationInput(o: CyclingOptimization): string {
  if ('type' in o) return `{ type: ${o.type} }`
  const { time, safety, flatness } = o.triangle
  return `{ triangle: { time: ${num(time)}, safety: ${num(safety)}, flatness: ${num(flatness)} } }`
}

/**
 * GraphQL for one direct bicycle plan. Values are inlined (all numbers or enum literals,
 * validated above) so the request is a single self-describing string that caches well.
 */
export function buildPlanQuery(req: OtpRequest): string {
  const via = req.via ? `via: [{ visit: { coordinate: ${coordinate(req.via)} } }]` : ''
  return `{
  planConnection(
    origin: { location: { coordinate: ${coordinate(req.from)} } }
    destination: { location: { coordinate: ${coordinate(req.to)} } }
    first: 1
    modes: { directOnly: true, direct: [BICYCLE] }
    ${via}
    preferences: { street: { bicycle: { ${req.speedMps !== undefined ? `speed: ${num(req.speedMps)}, ` : ''}optimization: ${optimizationInput(req.optimization)} } } }
  ) {
    edges { node { duration legs { distance legGeometry { points } steps { distance streetName bogusName area walkingBike elevationProfile { distance elevation } } } } }
    routingErrors { code description }
  }
}`
}

type RawStep = {
  distance?: number
  streetName?: string
  bogusName?: boolean
  area?: boolean
  walkingBike?: boolean
  elevationProfile?: { distance?: number; elevation?: number }[] | null
}
type RawLeg = { distance?: number; legGeometry?: { points?: string }; steps?: RawStep[] }
type RawPlan = {
  data?: { planConnection?: { edges?: { node?: { duration?: number; legs?: RawLeg[] } }[] } }
  errors?: { message?: string }[]
}

/** Turn a planConnection response into a candidate (no generators yet), or null. */
export function parsePlanResponse(json: unknown): Candidate | null {
  const raw = json as RawPlan
  const node = raw.data?.planConnection?.edges?.[0]?.node
  // GraphQL errors only matter when they cost us the plan; OTP's own `routingErrors`
  // (e.g. NO_DIRECT_MODE_CONNECTION) arrive with empty edges and mean "no route".
  if (!node && raw.errors?.length) throw new Error(`OTP error: ${raw.errors.map((e) => e.message).join('; ')}`)
  if (!node?.legs?.length || typeof node.duration !== 'number') return null

  const legs = node.legs.map((l) => polyline.decode(l.legGeometry?.points ?? ''))
  if (legs.every((l) => l.length < 2)) return null
  const legSteps: OtpStep[][] = node.legs.map((l) =>
    (l.steps ?? []).map((s) => ({
      distance: s.distance ?? 0,
      streetName: s.streetName ?? '',
      bogusName: s.bogusName ?? false,
      area: s.area ?? false,
      walkingBike: s.walkingBike ?? false,
      elevation: (s.elevationProfile ?? [])
        .filter((p) => typeof p.distance === 'number' && typeof p.elevation === 'number')
        .map((p): [number, number] => [p.distance!, p.elevation!]),
    })),
  )
  return {
    id: hashGeometry(legs),
    generators: [],
    durationSec: node.duration,
    distanceM: node.legs.reduce((sum, l) => sum + (l.distance ?? 0), 0),
    legs,
    legSteps,
  }
}

export function createOtpClient(options: {
  apiKey: string
  timeoutMs: number
  endpoint?: string
  fetchFn?: typeof fetch
}): OtpCall {
  const { apiKey, timeoutMs, endpoint = DIGITRANSIT_ROUTING_ENDPOINT, fetchFn = fetch } = options
  return async (req, signal) => {
    const timeout = AbortSignal.timeout(timeoutMs)
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'digitransit-subscription-key': apiKey },
      body: JSON.stringify({ query: buildPlanQuery(req) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (!res.ok) throw new Error(`OTP HTTP ${res.status}`)
    return parsePlanResponse(await res.json())
  }
}
