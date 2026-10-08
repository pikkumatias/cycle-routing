import { readdir } from 'node:fs/promises'
import { DEFAULT_CONFIG, type RoutingConfig } from '../../src/routing/config'
import { cumulativeLengths, haversineDistance } from '../../src/routing/geo'
import type { Layers } from '../../src/routing/layers'
import { calmIndex, routePolyline } from '../../src/routing/profile'
import { findSignalStops } from '../../src/routing/signals'
import { buildShape, distinctLengthM } from '../../src/routing/similarity'
import { classifySegments, findMajorCrossings } from '../../src/routing/stress'
import type { ProfiledCandidate, StressClass } from '../../src/routing/types'
import type { ReviewData } from './dossiers'
import { LABELS_DIR, OUT_DIR, loadLayers, readJson, writeJson, type OdPair } from './env'
import { loadProfiledPool } from './evaluate'

/** The parts of a label `fit` uses — user labels and Claude labels share them. */
type Label = {
  calmRanking: string[]
  sameRoute?: Record<string, boolean> | string[][]
  ratings?: Record<string, number>
  lightCounts?: Record<string, number>
}

const STRESS: StressClass[] = ['away', 'quiet', 'adjacent', 'mixedLow', 'mixedHigh']
/** Classes whose weights are fitted; `away` is fixed at 0 and `mixedHigh` at 1 (the scale). */
const FREE: StressClass[] = ['quiet', 'adjacent', 'mixedLow']

type Features = { frac: Record<StressClass, number>; crossingsPerM: number }
type Pair = { od: string; better: Features; worse: Features }

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

function features(r: ProfiledCandidate): Features {
  const L = Math.max(1, r.profile.lengthM)
  const frac = Object.fromEntries(STRESS.map((k) => [k, r.profile.stressM[k] / L])) as Record<StressClass, number>
  return { frac, crossingsPerM: r.profile.majorCrossings / L }
}

type CalmModel = { weights: Record<StressClass, number>; penaltyM: number; slope: number }

/** Calm index under a model, unclamped (0–100 scale). */
const modelCalm = (m: CalmModel, f: Features) =>
  100 * (1 - STRESS.reduce((sum, k) => sum + m.weights[k] * f.frac[k], 0) - m.penaltyM * f.crossingsPerM)

/** Pool-adjacent-violators: closest non-decreasing sequence, then clamp to [0, 1]. */
function isotonic(values: number[]): number[] {
  const blocks = values.map((v) => ({ sum: v, n: 1 }))
  for (let i = 0; i < blocks.length - 1; ) {
    if (blocks[i].sum / blocks[i].n > blocks[i + 1].sum / blocks[i + 1].n) {
      blocks[i] = { sum: blocks[i].sum + blocks[i + 1].sum, n: blocks[i].n + blocks[i + 1].n }
      blocks.splice(i + 1, 1)
      if (i > 0) i--
    } else i++
  }
  return blocks.flatMap((b) => Array(b.n).fill(Math.max(0, Math.min(1, b.sum / b.n))))
}

/**
 * Bradley–Terry on calm: P(better ≻ worse) = σ(slope × (calm_better − calm_worse)/100),
 * fitted by projected gradient descent with monotone weights
 * (0 = away ≤ quiet ≤ adjacent ≤ mixedLow ≤ mixedHigh = 1) and a non-negative crossing
 * penalty. Small L2 pull towards the prior keeps sparse data from running away.
 */
function fitCalm(pairs: Pair[], prior: CalmModel): CalmModel {
  let w = FREE.map((k) => prior.weights[k])
  let penalty = prior.penaltyM
  let slope = prior.slope
  const lr = 0.05
  const l2 = 0.01
  for (let iter = 0; iter < 3000; iter++) {
    const gw = w.map(() => 0)
    let gp = 0
    let gs = 0
    for (const p of pairs) {
      // d = (calm_better − calm_worse)/100 = Σ w_k (f_worse − f_better) + penalty × (x_worse − x_better)
      const dk = FREE.map((k) => p.worse.frac[k] - p.better.frac[k])
      const dHigh = p.worse.frac.mixedHigh - p.better.frac.mixedHigh
      const dx = p.worse.crossingsPerM - p.better.crossingsPerM
      const d = dk.reduce((s, v, i) => s + w[i] * v, 0) + dHigh + penalty * dx
      const g = sigmoid(slope * d) - 1 // d(−log σ)/d(slope·d)
      dk.forEach((v, i) => (gw[i] += g * slope * v))
      gp += g * slope * dx
      gs += g * d
    }
    const n = Math.max(1, pairs.length)
    w = w.map((v, i) => v - lr * (gw[i] / n + l2 * (v - prior.weights[FREE[i]])))
    penalty = Math.max(0, penalty - lr * 1000 * (gp / n + l2 * (penalty - prior.penaltyM) / 1e6))
    slope = Math.max(1, slope - lr * 10 * (gs / n))
    w = isotonic(w)
  }
  return { weights: { away: 0, ...Object.fromEntries(FREE.map((k, i) => [k, w[i]])), mixedHigh: 1 } as Record<StressClass, number>, penaltyM: penalty, slope }
}

const pairAccuracy = (m: CalmModel, pairs: Pair[]) =>
  pairs.length === 0 ? NaN : pairs.filter((p) => modelCalm(m, p.better) > modelCalm(m, p.worse)).length / pairs.length

type LabelledTrip = { od: OdPair; review: ReviewData; label: Label; routes: Map<string, ProfiledCandidate> }

async function loadLabelled(ods: OdPair[], source: 'user' | 'claude', layers: Layers, cfg: RoutingConfig): Promise<LabelledTrip[]> {
  const files = new Set(await readdir(`${LABELS_DIR}/${source}`).catch(() => [] as string[]))
  const trips: LabelledTrip[] = []
  for (const od of ods) {
    if (!files.has(`${od.id}.json`)) continue
    const label = await readJson<Label>(`${LABELS_DIR}/${source}/${od.id}.json`)
    const review = await readJson<ReviewData>(`${OUT_DIR}/review/${od.id}.json`)
    const { routes } = await loadProfiledPool(od, layers, cfg)
    const byId = new Map(routes.map((r) => [r.id, r]))
    const byLetter = new Map(review.candidates.map((c) => [c.letter, byId.get(c.id)!]))
    trips.push({ od, review, label, routes: byLetter })
  }
  return trips
}

function rankingPairs(trip: LabelledTrip): Pair[] {
  const ranked = trip.label.calmRanking.filter((l) => trip.routes.has(l))
  const pairs: Pair[] = []
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      pairs.push({ od: trip.od.id, better: features(trip.routes.get(ranked[i])!), worse: features(trip.routes.get(ranked[j])!) })
    }
  }
  return pairs
}

/** Light counts under alternative signal rules, reusing the expensive per-route work. */
function lightGrid(trips: LabelledTrip[], layers: Layers, cfg: RoutingConfig) {
  const cases: Array<{ truth: number; run: (signals: RoutingConfig['signals']) => number }> = []
  for (const t of trips) {
    for (const [letter, truth] of Object.entries(t.label.lightCounts ?? {})) {
      const r = t.routes.get(letter)
      if (!r) continue
      const poly = routePolyline(r.legs)
      const cum = cumulativeLengths(poly)
      const segments = classifySegments(poly, r.legSteps.flat(), layers, cfg)
      const crossings = findMajorCrossings(poly, cum, segments, layers, { ...cfg, signals: { ...cfg.signals, crossM: 40 } })
      cases.push({
        truth,
        run: (signals) => {
          const withSignals = crossings.map((c) => {
            const near = c.road.signals.filter((s) => haversineDistance(s, c.at) <= signals.crossM)
            return { ...c, signal: near[0] ?? null }
          })
          return findSignalStops(poly, cum, segments, withSignals, layers, { ...cfg, signals }).length
        },
      })
    }
  }
  const results = []
  for (const onM of [2, 3, 5, 8, 12])
    for (const crossM of [10, 18, 25, 35])
      for (const nearM of [8, 12, 20])
        for (const windowM of [25, 40, 60]) {
          const signals = { onM, crossM, nearM, windowM }
          const errors = cases.map((c) => c.run(signals) - c.truth)
          results.push({
            signals,
            exact: errors.filter((e) => e === 0).length / Math.max(1, errors.length),
            mae: errors.reduce((s, e) => s + Math.abs(e), 0) / Math.max(1, errors.length),
          })
        }
  results.sort((a, b) => b.exact - a.exact || a.mae - b.mae)
  const current = results.find((r) => JSON.stringify(r.signals) === JSON.stringify(cfg.signals))
  return { cases: cases.length, best: results.slice(0, 5), current }
}

/** Same-route answers vs the distinctness rule for a grid of thresholds. */
function similarityGrid(trips: LabelledTrip[]) {
  const pairs: Array<{ later: ProfiledCandidate; earlier: ProfiledCandidate; same: boolean }> = []
  for (const t of trips) {
    const answers = t.label.sameRoute
    if (!answers || Array.isArray(answers)) continue
    for (const [key, same] of Object.entries(answers)) {
      const [a, b] = key.split('-')
      if (t.routes.has(a) && t.routes.has(b)) pairs.push({ earlier: t.routes.get(a)!, later: t.routes.get(b)!, same })
    }
  }
  const shapes = new Map(pairs.flatMap((p) => [p.earlier, p.later]).map((r) => [r.id, buildShape(routePolyline(r.legs))]))
  const results = []
  for (const tolM of [15, 25, 40])
    for (const minDistinctM of [250, 400, 600])
      for (const minDistinctFrac of [0.1, 0.2, 0.3]) {
        const correct = pairs.filter((p) => {
          const later = shapes.get(p.later.id)!
          const distinct = distinctLengthM(later, [shapes.get(p.earlier.id)!], tolM) >= Math.max(minDistinctM, minDistinctFrac * later.lengthM)
          return distinct === !p.same
        }).length
        results.push({ similarity: { tolM, minDistinctM, minDistinctFrac }, accuracy: correct / Math.max(1, pairs.length) })
      }
  results.sort((a, b) => b.accuracy - a.accuracy)
  return { pairs: pairs.length, best: results.slice(0, 3) }
}

/** Band cut-offs: midpoints between the mean calm index of adjacent 1–5 rating groups. */
function bandFit(trips: LabelledTrip[], cfg: RoutingConfig) {
  const byRating = new Map<number, number[]>()
  for (const t of trips) {
    for (const [letter, rating] of Object.entries(t.label.ratings ?? {})) {
      const r = t.routes.get(letter)
      if (r) byRating.set(rating, [...(byRating.get(rating) ?? []), calmIndex(r.profile.stressM, r.profile.majorCrossings, r.profile.lengthM, cfg)])
    }
  }
  const mean = (r: number) => {
    const xs = byRating.get(r) ?? []
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
  }
  const means = Object.fromEntries([1, 2, 3, 4, 5].map((r) => [r, +mean(r).toFixed(1)]))
  const cut = (lo: number, hi: number) => Math.round((mean(lo) + mean(hi)) / 2)
  return { ratings: [...byRating.values()].reduce((s, x) => s + x.length, 0), meanCalmByRating: means, proposed: { veryCalm: cut(4, 5), calm: cut(3, 4), mixed: cut(2, 3) } }
}

/** Preferences from the trade-off questionnaire (see sandbox/review/main.ts). */
async function preferenceFit() {
  const answers = (await readJson<{ answers?: Record<string, string> }>(`${LABELS_DIR}/user/_tradeoffs.json`).catch(() => null))?.answers
  if (!answers) return null
  // [id, lights saved, extra minutes]; yes ⇒ minutesPerLight ≥ min/saved, no ⇒ <
  const light: Array<[string, number, number]> = [['l1', 2, 2], ['l2', 3, 5], ['l3', 6, 6], ['l4', 2, 4], ['l5', 1, 1]]
  let lo = 0
  let hi = Infinity
  for (const [id, saved, min] of light) {
    if (answers[id] === 'yes') lo = Math.max(lo, min / saved)
    if (answers[id] === 'no' && saved > 1) hi = Math.min(hi, min / saved)
  }
  // [id, approx calm points gained under the prior weights, extra minutes]
  const calm: Array<[string, number, number]> = [['c1', 30, 3], ['c2', 30, 8], ['c3', 20, 2], ['c4', 7, 2], ['c5', 9, 6]]
  let cLo = 0
  let cHi = Infinity
  for (const [id, pts, min] of calm) {
    if (answers[id] === 'yes') cHi = Math.min(cHi, pts / min)
    if (answers[id] === 'no') cLo = Math.max(cLo, pts / min)
  }
  return {
    answers,
    minutesPerLight: { feasible: [lo, hi], proposed: hi === Infinity ? lo : +((lo + hi) / 2).toFixed(2) },
    minLightGain: answers.l5 === 'yes' ? 1 : 2,
    calmPointsPerMinute: { feasible: [cLo, cHi], proposed: cHi === Infinity ? cLo : +((cLo + cHi) / 2).toFixed(2) },
  }
}

export async function fitAll(ods: OdPair[], source: 'user' | 'claude', cfg: RoutingConfig = DEFAULT_CONFIG) {
  const layers = await loadLayers()
  const trips = await loadLabelled(ods, source, layers, cfg)
  const pairs = trips.flatMap(rankingPairs)
  const prior: CalmModel = { weights: cfg.stress.weights, penaltyM: cfg.stress.crossingPenaltyM, slope: 20 }

  // Leave-one-trip-out accuracy of the fitted model vs the prior
  let held = 0
  let heldCorrect = 0
  let priorCorrect = 0
  for (const t of trips) {
    const test = pairs.filter((p) => p.od === t.od.id)
    if (test.length === 0) continue
    const model = fitCalm(pairs.filter((p) => p.od !== t.od.id), prior)
    held += test.length
    heldCorrect += pairAccuracy(model, test) * test.length
    priorCorrect += pairAccuracy(prior, test) * test.length
  }
  const fitted = fitCalm(pairs, prior)
  const result = {
    source,
    configVersion: cfg.configVersion,
    trips: trips.length,
    calm: {
      pairs: pairs.length,
      priorAccuracy: +(priorCorrect / Math.max(1, held)).toFixed(3),
      fittedHeldOutAccuracy: +(heldCorrect / Math.max(1, held)).toFixed(3),
      fitted: {
        weights: Object.fromEntries(Object.entries(fitted.weights).map(([k, v]) => [k, +v.toFixed(3)])),
        crossingPenaltyM: Math.round(fitted.penaltyM),
      },
    },
    lights: lightGrid(trips, layers, cfg),
    similarity: similarityGrid(trips),
    bands: bandFit(trips, cfg),
    preferences: source === 'user' ? await preferenceFit() : null,
  }
  await writeJson(`${OUT_DIR}/fit-${source}.json`, result)
  return result
}
