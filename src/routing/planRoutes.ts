import { DEFAULT_CONFIG, type RoutingConfig } from './config.js'
import { hashGeometry } from './geo.js'
import { calmVias, lightsVias, type GeneratorRequest } from './generators.js'
import type { Layers } from './layers.js'
import type { OtpCall } from './otpClient.js'
import { profileRoute } from './profile.js'
import { selectCards } from './select.js'
import { trimSpur } from './spur.js'
import type { Candidate, LatLng, LatLon, ProfiledCandidate, RoutePlan } from './types.js'

export type PlanDeps = {
  otp: OtpCall
  layers: Layers
  cfg?: RoutingConfig
  /** Clock in ms, injectable for tests. */
  now?: () => number
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Plan bicycle routes from `from` to `to` and pick the cards to show.
 *
 * Round 1 runs the preset generators in parallel. Round 2 adds via-waypoint routes aimed at
 * avoiding the fastest route's signal clusters and at nearby car-free paths; it is skipped
 * (and the plan marked partial) when round 1 used more than half of the deadline. Via routes
 * have out-and-back stubs trimmed; identical geometries from different generators merge.
 */
export async function planRoutes(from: LatLon, to: LatLon, deps: PlanDeps): Promise<RoutePlan> {
  const cfg = deps.cfg ?? DEFAULT_CONFIG
  const now = deps.now ?? (() => Date.now())
  const start = now()
  const pool = new Map<string, ProfiledCandidate>()
  let calls = 0
  let failed = 0

  const run = async (requests: GeneratorRequest[]) => {
    const results = await mapLimit(requests, cfg.otp.concurrency, async (r) => {
      calls++
      try {
        return { request: r, candidate: await deps.otp({ from, to, via: r.via, optimization: r.optimization }) }
      } catch {
        failed++
        return { request: r, candidate: null }
      }
    })
    for (const { request, candidate } of results) {
      if (!candidate) continue
      const route = request.via ? applySpurTrim(candidate, cfg) : candidate
      if (!route) continue
      const existing = pool.get(route.id)
      if (existing) {
        if (!existing.generators.includes(request.name)) existing.generators.push(request.name)
        continue
      }
      pool.set(route.id, { ...route, generators: [request.name], profile: profileRoute(route, deps.layers, cfg) })
    }
  }

  await run(cfg.generators.round1)
  if (pool.size === 0) throw new Error('No route found')

  let partial = false
  if (now() - start <= cfg.otp.deadlineMs / 2) {
    const fastest = [...pool.values()].reduce((best, c) => (c.durationSec < best.durationSec ? c : best))
    const fromLL: LatLng = [from.lat, from.lon]
    const toLL: LatLng = [to.lat, to.lon]
    await run([...lightsVias(fastest, deps.layers, cfg), ...calmVias(fromLL, toLL, fastest, deps.layers, cfg)])
  } else {
    partial = true
  }

  const routes = [...pool.values()]
  return {
    routes,
    selection: selectCards(routes, cfg),
    meta: { calls, failed, partial, configVersion: cfg.configVersion },
  }
}

/** Trim a via route's out-and-back stub and scale its duration; null if the stub is too long. */
function applySpurTrim(candidate: Candidate, cfg: RoutingConfig): Candidate | null {
  const trimmed = trimSpur(candidate.legs, candidate.legSteps, cfg)
  if (!trimmed) return null
  if (trimmed.trimmedM === 0) return candidate
  const removedM = 2 * trimmed.trimmedM
  const scale = candidate.distanceM > removedM ? (candidate.distanceM - removedM) / candidate.distanceM : 1
  return {
    ...candidate,
    id: hashGeometry(trimmed.legs),
    legs: trimmed.legs,
    legSteps: trimmed.legSteps,
    distanceM: candidate.distanceM - removedM,
    durationSec: Math.round(candidate.durationSec * scale),
    spurTrimmedM: trimmed.trimmedM,
  }
}
