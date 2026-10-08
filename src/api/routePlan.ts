import type { LatLonPair } from './digitransit'
import { decodePolyline, type LatLng } from '../utils/routeGeometry'
import type { CalmBand, Category, RouteCard, SignalRule, StressClass } from '../routing/types'

export type { CalmBand, Category, RouteCard }

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

/**
 * Plan routes between two points via `/api/route-plan`. Plans are cached per
 * origin/destination (rounded to ~10 m) for the session.
 */
export async function fetchRoutePlan(from: LatLonPair, to: LatLonPair): Promise<RoutePlan> {
  const key = cacheKey(from, to)
  const cached = planCache.get(key)
  if (cached) return cached

  const res = await fetch('/api/route-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Route planning failed: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as Omit<RoutePlan, 'routes'> & { routes: WireRoute[] }
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
