import { writeFile } from 'node:fs/promises'
import { DEFAULT_CONFIG, type RoutingConfig } from '../../src/routing/config'
import type { Layers } from '../../src/routing/layers'
import { profileRoute, routePolyline } from '../../src/routing/profile'
import { selectCards } from '../../src/routing/select'
import { buildShape, isDistinct, type Shape } from '../../src/routing/similarity'
import type { ProfiledCandidate } from '../../src/routing/types'
import { legacyCards, loadLegacyPois } from './baseline'
import { OUT_DIR, loadLayers, readJson, writeJson, type OdPair } from './env'
import { PRODUCTION_PRESETS, type Pool } from './generate'

/** Generators the live app runs: round-1 presets plus the first two of each via family. */
export const PRODUCTION_GENERATORS = [...PRODUCTION_PRESETS, 'via:lights#1', 'via:lights#2', 'via:calm#1', 'via:calm#2']

export type Card = { routeId: string; roles: string[] }
export type CardSetMetrics = {
  cards: number
  /** Pairs of cards where the later card is the same route or not distinct from the earlier. */
  duplicatePairs: number
  fastest: { routeId: string; durationSec: number; lights: number; calmIndex: number }
  lightsCard: { routeId: string; lights: number; saved: number; extraSec: number } | null
  calmCard: { routeId: string; calmIndex: number; gain: number; extraSec: number } | null
}

export type OdEvaluation = {
  od: OdPair
  poolSize: number
  productionPoolSize: number
  legacyInitial: CardSetMetrics
  legacyExpanded: CardSetMetrics | null
  production: CardSetMetrics
  oracle: CardSetMetrics
}

export async function loadProfiledPool(od: OdPair, layers: Layers, cfg: RoutingConfig): Promise<{ pool: Pool; routes: ProfiledCandidate[] }> {
  const pool = await readJson<Pool>(`${OUT_DIR}/pools/${od.id}.json`)
  return { pool, routes: pool.routes.map((r) => ({ ...r, profile: profileRoute(r, layers, cfg) })) }
}

export const isProduction = (r: { generators: string[] }) => r.generators.some((g) => PRODUCTION_GENERATORS.includes(g))

/** Metrics of a card set, all measured with the new engine so the sets are comparable. */
export function cardSetMetrics(cards: Card[], byId: Map<string, ProfiledCandidate>): CardSetMetrics {
  const shapes = new Map<string, Shape>()
  const shape = (id: string) => {
    let s = shapes.get(id)
    if (!s) shapes.set(id, (s = buildShape(routePolyline(byId.get(id)!.legs))))
    return s
  }
  let duplicatePairs = 0
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i].routeId
      const b = cards[j].routeId
      // Same rule as selection: a later card must differ from the earlier one on its own length.
      if (a === b || !isDistinct(shape(b), [shape(a)], DEFAULT_CONFIG)) {
        duplicatePairs++
      }
    }
  }
  const route = (role: string) => {
    const card = cards.find((c) => c.roles.includes(role))
    return card ? byId.get(card.routeId)! : null
  }
  const fastest = route('fastest')!
  const lights = route('fewestLights')
  const calm = route('calm')
  return {
    cards: cards.length,
    duplicatePairs,
    fastest: { routeId: fastest.id, durationSec: fastest.durationSec, lights: fastest.profile.lights, calmIndex: fastest.profile.calmIndex },
    lightsCard: lights && {
      routeId: lights.id,
      lights: lights.profile.lights,
      saved: fastest.profile.lights - lights.profile.lights,
      extraSec: lights.durationSec - fastest.durationSec,
    },
    calmCard: calm && {
      routeId: calm.id,
      calmIndex: calm.profile.calmIndex,
      gain: calm.profile.calmIndex - fastest.profile.calmIndex,
      extraSec: calm.durationSec - fastest.durationSec,
    },
  }
}

/** Cards from selectCards as role lists (primary + badges). */
const selectionCards = (routes: ProfiledCandidate[], cfg: RoutingConfig): Card[] =>
  selectCards(routes, cfg).cards.map((c) => ({ routeId: c.routeId, roles: [c.primary, ...c.badges] }))

/** Legacy card lists: one card per category, identical routes collapsed only where the old UI did. */
function legacyCardList(set: Record<string, string>, collapseFewestLights: boolean): Card[] {
  const cards: Card[] = []
  for (const [role, routeId] of Object.entries(set)) {
    if (collapseFewestLights && role === 'fewestLights' && routeId === set.fastest) {
      cards.find((c) => c.roles.includes('fastest'))?.roles.push('fewestLights')
      continue
    }
    cards.push({ routeId, roles: [role] })
  }
  return cards
}

export async function evaluateAll(ods: OdPair[], cfg: RoutingConfig = DEFAULT_CONFIG): Promise<OdEvaluation[]> {
  const layers = await loadLayers()
  const legacyPois = await loadLegacyPois()
  const results: OdEvaluation[] = []
  for (const od of ods) {
    const { pool, routes } = await loadProfiledPool(od, layers, cfg)
    const byId = new Map(routes.map((r) => [r.id, r]))
    const production = routes.filter(isProduction)
    const legacy = legacyCards(pool, legacyPois)
    results.push({
      od,
      poolSize: routes.length,
      productionPoolSize: production.length,
      legacyInitial: cardSetMetrics(legacyCardList({ fastest: legacy.initial.fastest, fewestLights: legacy.initial.fewestLights }, true), byId),
      // The old "more options" view showed all four categories without collapsing duplicates
      legacyExpanded: legacy.expanded && cardSetMetrics(legacyCardList(legacy.expanded, true), byId),
      production: cardSetMetrics(selectionCards(production, cfg), byId),
      oracle: cardSetMetrics(selectionCards(routes, cfg), byId),
    })
  }
  return results
}

// ── Summary and report ──────────────────────────────────────────────────────────────

const median = (xs: number[]) => {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)

export function summarise(results: OdEvaluation[]) {
  const sets = ['legacyInitial', 'legacyExpanded', 'production', 'oracle'] as const
  return Object.fromEntries(
    sets.map((key) => {
      const ms = results.map((r) => r[key]).filter((m): m is CardSetMetrics => m !== null)
      const lights = ms.map((m) => m.lightsCard).filter((c) => c && c.routeId !== undefined) as NonNullable<CardSetMetrics['lightsCard']>[]
      const separateLights = lights.filter((c, i) => c.routeId !== ms[i].fastest.routeId)
      const calm = ms.map((m) => m.calmCard).filter((c): c is NonNullable<CardSetMetrics['calmCard']> => c !== null)
      return [
        key,
        {
          trips: ms.length,
          meanCards: +mean(ms.map((m) => m.cards)).toFixed(2),
          tripsWithDuplicateCards: ms.filter((m) => m.duplicatePairs > 0).length,
          lightsCardSeparate: separateLights.length,
          medianLightsSavedWhenSeparate: median(separateLights.map((c) => c.saved)),
          tripsWhereLightsCardHasMoreLightsThanFastest: lights.filter((c) => c.saved < 0).length,
          medianLightsCardExtraMin: +(median(separateLights.map((c) => c.extraSec)) / 60).toFixed(1),
          meanCalmGain: +mean(calm.map((c) => c.gain)).toFixed(1),
          medianCalmCardExtraMin: +(median(calm.filter((c) => c.extraSec > 0).map((c) => c.extraSec)) / 60).toFixed(1),
        },
      ]
    }),
  )
}

function svgMap(od: OdPair, routes: ProfiledCandidate[], highlight: Array<{ id: string; color: string; dash?: string }>): string {
  const pts = routes.flatMap((r) => r.legs.flat())
  const lats = pts.map((p) => p[0])
  const lons = pts.map((p) => p[1])
  const [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)]
  const cos = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180)
  const w = (maxLon - minLon) * cos
  const h = maxLat - minLat
  const scale = 260 / Math.max(w, h)
  const xy = ([lat, lon]: [number, number]) => `${(10 + (lon - minLon) * cos * scale).toFixed(1)},${(10 + (maxLat - lat) * scale).toFixed(1)}`
  const path = (r: ProfiledCandidate, style: string) =>
    `<polyline points="${routePolyline(r.legs).map(xy).join(' ')}" fill="none" ${style}/>`
  const byId = new Map(routes.map((r) => [r.id, r]))
  return `<svg viewBox="0 0 ${20 + w * scale} ${20 + h * scale}" width="280">
${routes.map((r) => path(r, 'stroke="#cbd5e1" stroke-width="1"')).join('\n')}
${highlight.map((hl) => byId.get(hl.id) && path(byId.get(hl.id)!, `stroke="${hl.color}" stroke-width="3" stroke-opacity="0.8"${hl.dash ? ` stroke-dasharray="${hl.dash}"` : ''}`)).join('\n')}
<circle cx="${xy(od.from).split(',')[0]}" cy="${xy(od.from).split(',')[1]}" r="4" fill="#16a34a"/>
<circle cx="${xy(od.to).split(',')[0]}" cy="${xy(od.to).split(',')[1]}" r="4" fill="#dc2626"/>
</svg>`
}

const fmtSet = (m: CardSetMetrics | null) => {
  if (!m) return '–'
  const l = m.lightsCard
  const c = m.calmCard
  return `${m.cards} card${m.cards === 1 ? '' : 's'}${m.duplicatePairs ? ` · <b>${m.duplicatePairs} dup</b>` : ''}<br>
fastest ${Math.round(m.fastest.durationSec / 60)} min, ${m.fastest.lights} lights, calm ${m.fastest.calmIndex}<br>
lights: ${l ? (l.routeId === m.fastest.routeId ? '= fastest' : `${l.lights} (${l.saved >= 0 ? '−' : '+'}${Math.abs(l.saved)}) +${Math.round(l.extraSec / 60)} min`) : '–'}<br>
calm: ${c ? (c.routeId === m.fastest.routeId ? '= fastest' : `${c.calmIndex} (+${c.gain}) +${Math.round(c.extraSec / 60)} min`) : '–'}`
}

export async function writeReport(results: OdEvaluation[], cfg: RoutingConfig = DEFAULT_CONFIG): Promise<void> {
  const summary = summarise(results)
  await writeJson(`${OUT_DIR}/eval.json`, { configVersion: cfg.configVersion, summary, results })
  const layers = await loadLayers()
  const rows: string[] = []
  for (const r of results) {
    const { routes } = await loadProfiledPool(r.od, layers, cfg)
    const highlight = [
      { id: r.production.fastest.routeId, color: '#2563eb' },
      ...(r.production.lightsCard ? [{ id: r.production.lightsCard.routeId, color: '#f59e0b' }] : []),
      ...(r.production.calmCard ? [{ id: r.production.calmCard.routeId, color: '#16a34a' }] : []),
      ...(r.legacyInitial.lightsCard ? [{ id: r.legacyInitial.lightsCard.routeId, color: '#dc2626', dash: '4 4' }] : []),
    ]
    rows.push(`<tr><td><b>${r.od.name}</b><br>${r.od.straightKm} km · ${r.od.bucket}<br>pool ${r.poolSize} (prod ${r.productionPoolSize})</td>
<td>${svgMap(r.od, routes, highlight)}</td><td>${fmtSet(r.legacyInitial)}</td><td>${fmtSet(r.legacyExpanded)}</td><td>${fmtSet(r.production)}</td><td>${fmtSet(r.oracle)}</td></tr>`)
  }
  const summaryRows = Object.entries(summary)
    .map(([k, v]) => `<tr><td>${k}</td>${Object.values(v).map((x) => `<td>${x}</td>`).join('')}</tr>`)
    .join('\n')
  const head = Object.keys(Object.values(summary)[0]).map((k) => `<th>${k}</th>`).join('')
  await writeFile(
    `${OUT_DIR}/report.html`,
    `<!doctype html><meta charset="utf-8"><title>Routing sandbox report</title>
<style>body{font:13px system-ui;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px;vertical-align:top}th{background:#f1f5f9}</style>
<h1>Routing sandbox report</h1><p>config ${cfg.configVersion} · ${results.length} trips · metrics measured with the new engine for every card set.
Map: grey = all candidates, blue = new Fastest, amber = new Fewest lights, green = new Calm, dashed red = legacy Fewest lights.</p>
<h2>Summary</h2><table><tr><th>set</th>${head}</tr>${summaryRows}</table>
<h2>Trips</h2><table><tr><th>trip</th><th>map</th><th>legacy (initial)</th><th>legacy (more options)</th><th>new (production pool)</th><th>new (full pool)</th></tr>
${rows.join('\n')}</table>`,
  )
}
