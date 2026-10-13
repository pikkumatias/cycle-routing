import { DEFAULT_CONFIG, type RoutingConfig } from './config.js'
import { hashGeometry } from './geo.js'
import { calmVias, lightsVias, type GeneratorRequest } from './generators.js'
import type { Layers } from './layers.js'
import type { OtpCall } from './otpClient.js'
import { profileRoute } from './profile.js'
import { selectCards } from './select.js'
import { trimSpur } from './spur.js'
import type { Candidate, LatLng, LatLon, PlanErrorCode, ProfiledCandidate, RoutePlan } from './types.js'

export class PlanError extends Error {
  readonly code: PlanErrorCode
  constructor(code: PlanErrorCode, message: string) {
    super(message)
    this.name = 'PlanError'
    this.code = code
  }
}

const isTimeout = (error: unknown) => error instanceof Error && error.name === 'TimeoutError'

export type PlanDeps = {
  otp: OtpCall
  layers: Layers
  cfg?: RoutingConfig
  /** Clock in ms, injectable for tests. */
  now?: () => number
}

/** One OTP answer, tagged with the order its request was made in. */
type Answer = { seq: number; request: GeneratorRequest; candidate: Candidate }

/** A gate that lets at most `limit` tasks run at once. */
function limiter(limit: number) {
  let active = 0
  const queue: (() => void)[] = []
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve))
    active++
    try {
      return await task()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}

/**
 * Plan bicycle routes from `from` to `to` and pick the cards to show.
 *
 * Round 1 runs the preset generators in parallel. Round 2 adds via-waypoint routes aimed at
 * avoiding the fastest route's signal clusters and at nearby car-free paths; it starts as soon
 * as the fastest preset is back, without waiting for the other presets. Round 2 is optional: it is skipped when round 1 used more than half of the deadline, and
 * calls still running at the deadline are aborted; either way the plan is marked partial.
 * Via routes have out-and-back stubs trimmed; identical geometries from different generators
 * merge, listed in request order whatever order OTP answers in.
 */
export async function planRoutes(from: LatLon, to: LatLon, deps: PlanDeps): Promise<RoutePlan> {
  const cfg = deps.cfg ?? DEFAULT_CONFIG
  const now = deps.now ?? (() => Date.now())
  const start = now()
  const withinHalfDeadline = () => now() - start <= cfg.otp.deadlineMs / 2
  const gate = limiter(cfg.otp.concurrency)
  const fromLL: LatLng = [from.lat, from.lon]
  const toLL: LatLng = [to.lat, to.lon]

  let seq = 0
  let calls = 0
  let failed = 0
  let timedOut = 0
  let partial = false
  const answers: Answer[] = []
  const round2 = new AbortController()

  /** Ask OTP for one generator's route; resolves to its candidate, or null on no route or failure. */
  const ask = (request: GeneratorRequest, signal?: AbortSignal): Promise<Candidate | null> => {
    const order = seq++
    return gate(async () => {
      if (signal?.aborted) return null
      calls++
      try {
        const answer = await deps.otp({ from, to, via: request.via, optimization: request.optimization }, signal)
        const candidate = answer && request.via ? applySpurTrim(answer, cfg) : answer
        if (candidate) answers.push({ seq: order, request, candidate })
        return candidate
      } catch (error) {
        // A deadline abort isn't a failure of the service
        if (signal?.aborted) return null
        failed++
        if (isTimeout(error)) timedOut++
        return null
      }
    })
  }

  // Round 2 works from the fastest route, so it goes out as soon as the fastest preset is back
  // rather than waiting for the slower presets
  let round2Started: Promise<unknown> | null = null
  const startRound2 = (fastest: ProfiledCandidate): Promise<unknown> => {
    if (round2Started) return round2Started
    if (!withinHalfDeadline()) {
      partial = true
      round2Started = Promise.resolve()
    } else {
      const requests = [...lightsVias(fastest, deps.layers, cfg), ...calmVias(fromLL, toLL, fastest, deps.layers, cfg)]
      round2Started = Promise.all(requests.map((r) => ask(r, round2.signal)))
    }
    return round2Started
  }

  const round1 = cfg.generators.round1.map((r) => ask(r))
  const fastestIndex = cfg.generators.round1.findIndex((r) => r.name === 'preset:fastest')
  if (fastestIndex >= 0) {
    void round1[fastestIndex].then((c) => {
      if (c) startRound2({ ...c, generators: [], profile: profileRoute(c, deps.layers, cfg) })
    })
  }

  await Promise.all(round1)
  // Round 1 is scored on its own; round-2 answers that are already in wait for the end
  const pool = new Map<string, ProfiledCandidate>()
  const presetCount = round1.length
  addToPool(pool, answers.filter((a) => a.seq < presetCount), deps.layers, cfg)
  const early = answers.filter((a) => a.seq >= presetCount)
  answers.length = 0
  answers.push(...early)
  if (pool.size === 0) {
    round2.abort()
    // OTP answered at least once and found nothing: a real "no route". Every call failing is an outage.
    if (failed < calls) throw new PlanError('NO_ROUTE', 'No route found')
    if (timedOut === failed) throw new PlanError('TIMEOUT', 'Route planning timed out')
    throw new PlanError('UPSTREAM_UNAVAILABLE', 'Route planning service unavailable')
  }

  // Without the fastest preset's answer, round 2 starts from the fastest of round 1
  const round2Done = startRound2([...pool.values()].reduce((best, c) => (c.durationSec < best.durationSec ? c : best)))

  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => resolve('deadline'), Math.max(0, start + cfg.otp.deadlineMs - now()))
  })
  if ((await Promise.race([round2Done, deadline])) === 'deadline') {
    partial = true
    round2.abort()
  }
  clearTimeout(timer)
  addToPool(pool, answers.splice(0), deps.layers, cfg)

  const routes = [...pool.values()]
  return {
    routes,
    selection: selectCards(routes, cfg),
    meta: { calls, failed, partial, configVersion: cfg.configVersion },
  }
}

/** Profile new answers into the pool in request order; a known geometry only gains a generator. */
function addToPool(pool: Map<string, ProfiledCandidate>, answers: Answer[], layers: Layers, cfg: RoutingConfig) {
  for (const { request, candidate } of answers.sort((a, b) => a.seq - b.seq)) {
    const existing = pool.get(candidate.id)
    if (existing) {
      if (!existing.generators.includes(request.name)) existing.generators.push(request.name)
      continue
    }
    pool.set(candidate.id, { ...candidate, generators: [request.name], profile: profileRoute(candidate, layers, cfg) })
  }
}

/** Trim a via route's out-and-back stub and scale its duration; null if the stub is too long. */
export function applySpurTrim(candidate: Candidate, cfg: RoutingConfig): Candidate | null {
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
