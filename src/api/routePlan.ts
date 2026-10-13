import type { LatLonPair } from './digitransit'
import { decodePolyline, type LatLng } from '../utils/routeGeometry'
import type { CalmBand, Category, RouteCard, RoutePlanErrorCode, SignalRule, StressClass } from '../routing/types'
import { RIDING_SPEED_KMH, type RidingSpeed } from '../settings/ridingSpeed'

export type { CalmBand, Category, RouteCard }

/** Why planning failed: the server's code, or the request never got an answer. */
export type PlanFailure = RoutePlanErrorCode | 'NETWORK' | 'OFFLINE'

const SERVER_CODES = new Set<string>([
  'BAD_REQUEST', 'OUT_OF_AREA', 'TOO_SHORT', 'TOO_LONG', 'NO_ROUTE', 'UPSTREAM_UNAVAILABLE', 'TIMEOUT', 'SERVER_ERROR',
] satisfies RoutePlanErrorCode[])

export class RoutePlanError extends Error {
  readonly code: PlanFailure
  constructor(code: PlanFailure) {
    super(`Route planning failed: ${code}`)
    this.name = 'RoutePlanError'
    this.code = code
  }
}

/** Failures worth retrying as-is; the rest need a different trip. */
export const RETRYABLE: ReadonlySet<PlanFailure> = new Set(['NETWORK', 'OFFLINE', 'TIMEOUT', 'UPSTREAM_UNAVAILABLE', 'SERVER_ERROR'])

/** The server's own deadline is ~15 s; past this something between us and it has hung. */
const CLIENT_TIMEOUT_MS = 20_000

/** Where a trip goes from and to. */
export type Endpoints = { from: LatLng; to: LatLng }

/** A route as shown in the app: one per card, decoded and ready to draw. */
export type PlannedRoute = {
  id: string
  durationSec: number
  distanceM: number
  legs: LatLng[][]
  signalStops: { at: LatLng; rule: SignalRule }[]
  lights: number
  calmIndex: number
  calmBand: CalmBand
  stressM: Record<StressClass, number>
  majorCrossings: number
  /** Metres climbed (smoothed elevation model). */
  climbM: number
  /** [metres along the route where a run ends, its stress class], in order. */
  stressRuns: Array<[number, StressClass]>
}

export type RoutePlan = {
  routes: PlannedRoute[]
  cards: RouteCard[]
  meta: { calls: number; failed: number; partial: boolean; configVersion: string; dataVersion: string }
}

/** Plans from before climb and traffic runs were added lack them (old edge-cached answers). */
type WireRoute = Omit<PlannedRoute, 'legs' | 'climbM' | 'stressRuns'> &
  Partial<Pick<PlannedRoute, 'climbM' | 'stressRuns'>> & { legs: string[] }

const MAX_PLAN_CACHE = 20
const planCache = new Map<string, RoutePlan>()

/** A point rounded to 4 decimals (~10 m): the same trip asks the same URL, which the edge caches. */
const point = ({ lat, lon }: LatLonPair) => `${lat.toFixed(4)},${lon.toFixed(4)}`

/** Code for a non-OK response: the server's own code, else one inferred from the status (e.g. a platform 504 page). */
async function failureFor(res: Response): Promise<PlanFailure> {
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null
  if (typeof body?.code === 'string' && SERVER_CODES.has(body.code)) return body.code as RoutePlanErrorCode
  if (res.status === 504) return 'TIMEOUT'
  // 429 is the Vercel Firewall rate limit (README, Deployment)
  if (res.status === 429 || res.status === 502 || res.status === 503) return 'UPSTREAM_UNAVAILABLE'
  return 'SERVER_ERROR'
}

/**
 * Plan routes between two points via `/api/route-plan`. Plans are cached per
 * origin/destination (rounded to ~10 m) for the session, and at the edge.
 *
 * Fails with a `RoutePlanError` carrying a `PlanFailure` code, or with the caller's
 * `AbortError` when `signal` aborts.
 */
export async function fetchRoutePlan(
  from: LatLonPair,
  to: LatLonPair,
  signal?: AbortSignal,
  speed: RidingSpeed = 'normal',
): Promise<RoutePlan> {
  const query = new URLSearchParams({ from: point(from), to: point(to) })
  // Normal is the server's default; leaving it out keeps those URLs (and their edge cache) as they were
  if (speed !== 'normal') query.set('speed', String(RIDING_SPEED_KMH[speed]))
  const key = query.toString()
  const cached = planCache.get(key)
  if (cached) {
    // Least recently used goes first
    planCache.delete(key)
    planCache.set(key, cached)
    return cached
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, CLIENT_TIMEOUT_MS)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort)

  let data: Omit<RoutePlan, 'routes'> & { routes: WireRoute[] }
  try {
    const res = await fetch(`/api/route-plan?${query}`, { signal: controller.signal })
    if (!res.ok) throw new RoutePlanError(await failureFor(res))
    if (!res.headers.get('Content-Type')?.includes('application/json')) throw new RoutePlanError('SERVER_ERROR')
    data = (await res.json()) as typeof data
  } catch (error) {
    if (error instanceof RoutePlanError) throw error
    if (timedOut) throw new RoutePlanError('TIMEOUT')
    if (signal?.aborted) throw error
    if (error instanceof SyntaxError) throw new RoutePlanError('SERVER_ERROR')
    throw new RoutePlanError(navigator.onLine === false ? 'OFFLINE' : 'NETWORK')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  const plan: RoutePlan = {
    ...data,
    routes: data.routes.map((r) => ({
      ...r,
      legs: r.legs.map(decodePolyline),
      climbM: r.climbM ?? 0,
      stressRuns: r.stressRuns ?? [],
    })),
  }

  if (planCache.size >= MAX_PLAN_CACHE) planCache.delete(planCache.keys().next().value!)
  planCache.set(key, plan)
  return plan
}

/** The card that starts selected: the one carrying Fewest lights, else the first. */
export function defaultCard(cards: RouteCard[]): RouteCard | undefined {
  return cards.find((c) => c.primary === 'fewestLights' || c.badges.includes('fewestLights')) ?? cards[0]
}
