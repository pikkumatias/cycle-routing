import { DEFAULT_CONFIG, type RoutingConfig } from '../../src/routing/config'
import { selectCards } from '../../src/routing/select'
import type { ProfiledCandidate } from '../../src/routing/types'
import { OUT_DIR, loadLayers, writeJson, type OdPair } from './env'
import { loadProfiledPool } from './evaluate'
import { PRODUCTION_PRESETS } from './generate'

type TripPool = { od: OdPair; routes: ProfiledCandidate[]; oracle: { lights: number; calm: number } }

/** Metrics of the Fewest-lights and Calm winners a pool produces. */
function winners(routes: ProfiledCandidate[], cfg: RoutingConfig) {
  const sel = selectCards(routes, cfg)
  const byId = new Map(routes.map((r) => [r.id, r]))
  return { lights: byId.get(sel.winners.fewestLights)!.profile.lights, calm: byId.get(sel.winners.calm)!.profile.calmIndex }
}

/** Regret of a generator subset on one trip: extra lights + lost calm points / 10. */
function regret(trip: TripPool, generators: Set<string>, cfg: RoutingConfig): number {
  const routes = trip.routes.filter((r) => r.generators.some((g) => generators.has(g)))
  if (routes.length === 0) return Infinity
  const w = winners(routes, cfg)
  return Math.max(0, w.lights - trip.oracle.lights) + Math.max(0, trip.oracle.calm - w.calm) / 10
}

/**
 * Greedy forward selection over individual generators, starting from the production
 * presets: each step adds the generator that most reduces mean regret against the full
 * pool. Every generator is one OTP call, so the result is a quality-vs-calls curve.
 */
export async function generatorYield(ods: OdPair[], cfg: RoutingConfig = DEFAULT_CONFIG, maxCalls = 16) {
  const layers = await loadLayers()
  const trips: TripPool[] = []
  for (const od of ods) {
    const { routes } = await loadProfiledPool(od, layers, cfg)
    trips.push({ od, routes, oracle: winners(routes, cfg) })
  }
  const all = new Set(trips.flatMap((t) => t.routes.flatMap((r) => r.generators)))
  const chosen = new Set(PRODUCTION_PRESETS)
  const meanRegret = (set: Set<string>) => trips.reduce((sum, t) => sum + regret(t, set, cfg), 0) / trips.length
  const curve = [{ calls: chosen.size, added: [...chosen].join(' + '), meanRegret: +meanRegret(chosen).toFixed(3) }]

  while (chosen.size < maxCalls) {
    let best: { gen: string; value: number } | null = null
    for (const gen of all) {
      if (chosen.has(gen)) continue
      const value = meanRegret(new Set([...chosen, gen]))
      if (!best || value < best.value) best = { gen, value }
    }
    if (!best) break
    chosen.add(best.gen)
    curve.push({ calls: chosen.size, added: best.gen, meanRegret: +best.value.toFixed(3) })
    if (best.value === 0) break
  }

  // Reference points: today's production set and the full pool's call count.
  const production = new Set([...PRODUCTION_PRESETS, 'via:lights#1', 'via:lights#2', 'via:calm#1', 'via:calm#2'])
  const reference = { productionCalls: production.size, productionMeanRegret: +meanRegret(production).toFixed(3), fullPoolCalls: all.size }
  await writeJson(`${OUT_DIR}/yield.json`, { configVersion: cfg.configVersion, trips: trips.length, curve, reference })
  return { curve, reference }
}
