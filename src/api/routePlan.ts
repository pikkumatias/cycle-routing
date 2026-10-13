import type { LatLonPair } from './digitransit'
import { decodePolyline, type LatLng } from '../utils/routeGeometry'
import type { CalmBand, Category, RouteCard, RoutePlanErrorCode, SignalRule, StressClass } from '../routing/types'

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
}

export type RoutePlan = {
  routes: PlannedRoute[]
  cards: RouteCard[]
  meta: { calls: number; failed: number; partial: boolean; configVersion: string; dataVersion: string }
}

type WireRoute = Omit<PlannedRoute, 'legs'> & { legs: string[] }

const MAX_PLAN_CACHE = 20
const planCache = new Map<string, RoutePlan>()

function cacheKey(from: LatLonPair, to: LatLonPair): string {
  const q = (n: number) => Math.round(n / 0.0001) * 0.0001
  return `${q(from.lat)},${q(from.lon)}->${q(to.lat)},${q(to.lon)}`
}

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
 * origin/destination (rounded to ~10 m) for the session.
 *
 * Fails with a `RoutePlanError` carrying a `PlanFailure` code, or with the caller's
 * `AbortError` when `signal` aborts.
 */
export async function fetchRoutePlan(from: LatLonPair, to: LatLonPair, signal?: AbortSignal): Promise<RoutePlan> {
  const key = cacheKey(from, to)
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
    const res = await fetch('/api/route-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
      signal: controller.signal,
    })
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
    routes: data.routes.map((r) => ({ ...r, legs: r.legs.map(decodePolyline) })),
  }

  if (planCache.size >= MAX_PLAN_CACHE) planCache.delete(planCache.keys().next().value!)
  planCache.set(key, plan)
  return plan
}

/** The card that starts selected: the one carrying Fewest lights, else the first. */
export function defaultCard(cards: RouteCard[]): RouteCard | undefined {
  return cards.find((c) => c.primary === 'fewestLights' || c.badges.includes('fewestLights')) ?? cards[0]
}
