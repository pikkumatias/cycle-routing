import { DEFAULT_CONFIG, type RoutingConfig } from '../../src/routing/config'
import { calmVias, geometricVias, lightsVias, type GeneratorRequest } from '../../src/routing/generators'
import type { OtpCall } from '../../src/routing/otpClient'
import { applySpurTrim } from '../../src/routing/planRoutes'
import { profileRoute } from '../../src/routing/profile'
import type { Candidate, CyclingOptimization } from '../../src/routing/types'
import { OUT_DIR, cachedOtp, loadLayers, writeJson, type CallStats, type OdPair } from './env'

const tri = (time: number, safety: number, flatness: number): CyclingOptimization => ({ triangle: { time, safety, flatness } })

/** Production round 1 — must match DEFAULT_CONFIG.generators.round1. */
export const PRODUCTION_PRESETS = DEFAULT_CONFIG.generators.round1.map((g) => g.name)
/** Presets the pre-overhaul app used (default pool + "more options"). */
export const LEGACY_DEFAULT = ['preset:fastest', 'preset:safety']
export const LEGACY_EXTRA = ['legacy:flat', 'legacy:balanced', 'legacy:safeflat', 'legacy:timesafety']

function presetRequests(): GeneratorRequest[] {
  const requests: GeneratorRequest[] = [
    ...DEFAULT_CONFIG.generators.round1,
    { name: 'legacy:flat', optimization: tri(0, 0, 1) },
    { name: 'legacy:balanced', optimization: tri(0.33, 0.34, 0.33) },
    { name: 'legacy:safeflat', optimization: tri(0.1, 0.6, 0.3) },
    { name: 'legacy:timesafety', optimization: tri(0.5, 0.5, 0) },
    { name: 'opt:FLAT_STREETS', optimization: { type: 'FLAT_STREETS' } },
    { name: 'opt:SAFE_STREETS', optimization: { type: 'SAFE_STREETS' } },
  ]
  // Triangle grid in quarters (15 points on the simplex)
  for (let t = 0; t <= 4; t++) {
    for (let s = 0; s <= 4 - t; s++) {
      const f = 4 - t - s
      requests.push({ name: `tri:${t / 4},${s / 4},${f / 4}`, optimization: tri(t / 4, s / 4, f / 4) })
    }
  }
  return requests
}

/** Number the requests of a family so production-sized subsets can be cut later (`via:calm#1`). */
const numbered = (requests: GeneratorRequest[]) => requests.map((r, i) => ({ ...r, name: `${r.name}#${i + 1}` }))

export type Pool = { od: OdPair; generatedAt: string; routes: Candidate[] }

/**
 * Every candidate the sandbox knows how to make for one trip, merged by geometry: presets
 * (production, legacy, triangle grid, optimization types), then via routes built from the
 * production fastest route (lights- and calm-targeted, wider than production uses) and raw
 * geometric offsets for comparison.
 */
export async function generatePool(od: OdPair, otp: OtpCall, cfg: RoutingConfig = DEFAULT_CONFIG): Promise<Pool> {
  const layers = await loadLayers()
  const from = { lat: od.from[0], lon: od.from[1] }
  const to = { lat: od.to[0], lon: od.to[1] }
  const pool = new Map<string, Candidate>()

  const run = async (requests: GeneratorRequest[]) => {
    for (const r of requests) {
      let candidate: Candidate | null
      try {
        candidate = await otp({ from, to, via: r.via, optimization: r.optimization })
      } catch (err) {
        console.warn(`  ${r.name} failed: ${(err as Error).message}`)
        continue
      }
      if (!candidate) continue
      const route = r.via ? applySpurTrim(candidate, cfg) : candidate
      if (!route) continue
      const existing = pool.get(route.id)
      if (existing) existing.generators.push(r.name)
      else pool.set(route.id, { ...route, generators: [r.name] })
    }
  }

  await run(presetRequests())
  const productionFastest = [...pool.values()]
    .filter((c) => c.generators.some((g) => PRODUCTION_PRESETS.includes(g)))
    .reduce((best, c) => (c.durationSec < best.durationSec ? c : best))
  const fastest = { ...productionFastest, profile: profileRoute(productionFastest, layers, cfg) }
  const wide: RoutingConfig = { ...cfg, generators: { ...cfg.generators, lightsVias: 4, calmVias: 6 } }
  await run([
    ...numbered(lightsVias(fastest, layers, wide)),
    ...numbered(calmVias(od.from, od.to, fastest, layers, wide)),
    ...numbered(geometricVias(od.from, od.to)),
  ])

  return { od, generatedAt: new Date().toISOString(), routes: [...pool.values()] }
}

export async function generateAll(ods: OdPair[]): Promise<void> {
  const stats: CallStats = { live: 0, cached: 0, failed: 0 }
  const otp = cachedOtp(stats)
  for (const [i, od] of ods.entries()) {
    const pool = await generatePool(od, otp)
    await writeJson(`${OUT_DIR}/pools/${od.id}.json`, pool)
    console.log(`${i + 1}/${ods.length} ${od.name}: ${pool.routes.length} unique routes (calls live ${stats.live}, cached ${stats.cached}, failed ${stats.failed})`)
  }
}
