import { mkdir, writeFile } from 'node:fs/promises'
import polyline from '@mapbox/polyline'
import { DEFAULT_CONFIG, type RoutingConfig } from '../../src/routing/config'
import { cumulativeLengths, segmentDistance } from '../../src/routing/geo'
import type { Layers, Road } from '../../src/routing/layers'
import { routePolyline } from '../../src/routing/profile'
import { selectCards } from '../../src/routing/select'
import { buildShape, isDistinct, type Shape } from '../../src/routing/similarity'
import { classifySegments, findMajorCrossings } from '../../src/routing/stress'
import type { LatLng, ProfiledCandidate } from '../../src/routing/types'
import { legacyCards, loadLegacyPois } from './baseline'
import { OUT_DIR, loadLayers, writeJson, type OdPair } from './env'
import { isProduction, loadProfiledPool } from './evaluate'

const MAX_CANDIDATES = 8
const LETTERS = 'ABCDEFGHIJ'

export type ReviewCandidate = {
  letter: string
  id: string
  durationSec: number
  distanceM: number
  extraSec: number
  legs: string[]
  signalStops: LatLng[]
  lights: number
  dossier: string[]
}

export type ReviewData = {
  od: OdPair
  candidates: ReviewCandidate[]
  /** Letters of near-identical candidates (later not distinct from earlier), to confirm or split. */
  similarPairs: Array<[string, string]>
  cardSets: {
    legacy: Array<{ letter: string; roles: string[] }>
    production: Array<{ letter: string; roles: string[] }>
  }
}

/** Nearest major road within `maxM` of a point, if any. */
function nearestRoad(p: LatLng, layers: Layers, maxM: number): Road | null {
  let best: Road | null = null
  let bestD = maxM
  for (const seg of layers.roadSegments.near(p, maxM)) {
    const d = segmentDistance(p, seg.a, seg.b).distanceM
    if (d <= bestD) {
      bestD = d
      best = seg.road
    }
  }
  return best
}

const roadLabel = (r: Road) => `${r.name ?? `unnamed ${r.cls} road`}${r.tram ? ' (tram)' : ''}${r.maxspeed ? `, ${r.maxspeed} km/h` : ''}`
const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`)

/** Evidence a cyclist would use to judge the route — never the model's own scores. */
function describe(route: ProfiledCandidate, fastestSec: number, layers: Layers, cfg: RoutingConfig): string[] {
  const poly = routePolyline(route.legs)
  const cum = cumulativeLengths(poly)
  const steps = route.legSteps.flat()
  const segments = classifySegments(poly, steps, layers, cfg)
  const crossings = findMajorCrossings(poly, cum, segments, layers, cfg)

  // Condensed street sequence: merge repeats, skip slivers
  const seq: Array<{ name: string; m: number }> = []
  for (const s of steps) {
    const name = s.walkingBike ? `${s.streetName} (walking)` : s.bogusName ? `unnamed ${s.streetName}` : s.streetName
    const last = seq[seq.length - 1]
    if (last && last.name === name) last.m += s.distance
    else seq.push({ name, m: s.distance })
  }
  const sequence = seq.filter((x) => x.m >= 40).map((x) => `${x.name} ${metres(x.m)}`).join(' → ')

  // Metres in traffic on / beside named major roads
  const onRoad = new Map<string, number>()
  const beside = new Map<string, number>()
  for (const s of segments) {
    const mid: LatLng = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]
    if (s.onRoad) onRoad.set(roadLabel(s.onRoad), (onRoad.get(roadLabel(s.onRoad)) ?? 0) + s.lengthM)
    else if (s.stress === 'adjacent') {
      const road = nearestRoad(mid, layers, cfg.stress.adjacentM)
      const key = road ? roadLabel(road) : 'a major road'
      beside.set(key, (beside.get(key) ?? 0) + s.lengthM)
    }
  }
  const list = (m: Map<string, number>) =>
    [...m.entries()].filter(([, v]) => v >= 50).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${metres(v)}`).join('; ') || 'none'

  const lengthM = cum[cum.length - 1] ?? 0
  const walked = segments.filter((s) => s.step?.walkingBike).reduce((a, s) => a + s.lengthM, 0)
  const stopNames = route.profile.signalStops.map((st) => {
    const road = nearestRoad(st.at, layers, 40)
    return road?.name ?? 'minor street/path'
  })
  return [
    `time ${Math.round(route.durationSec / 60)} min (+${Math.round((route.durationSec - fastestSec) / 60)} min), ${metres(lengthM)}`,
    `streets: ${sequence}`,
    `in traffic on major roads: ${list(onRoad)}`,
    `separated path beside major roads: ${list(beside)}`,
    `major-road crossings: ${crossings.map((c) => `${c.road.name ?? c.road.cls} (${c.signal ? 'signals' : 'no signals'})`).join(', ') || 'none'}`,
    `traffic-light stops: ${route.profile.lights}${stopNames.length ? ` — ${stopNames.join(', ')}` : ''}`,
    ...(walked >= 30 ? [`walking the bike: ${metres(walked)}`] : []),
  ]
}

export async function buildDossiers(ods: OdPair[], cfg: RoutingConfig = DEFAULT_CONFIG): Promise<void> {
  const layers = await loadLayers()
  const legacyPois = await loadLegacyPois()
  for (const od of ods) {
    const { pool, routes } = await loadProfiledPool(od, layers, cfg)
    const byId = new Map(routes.map((r) => [r.id, r]))
    const legacy = legacyCards(pool, legacyPois)
    const production = selectCards(routes.filter(isProduction), cfg).cards
    const oracle = selectCards(routes, cfg).cards

    // Must-show routes first (anything a card set showed), then distinct fill-ins by duration.
    const must = [
      ...Object.values(legacy.initial),
      ...Object.values(legacy.expanded ?? {}),
      ...production.map((c) => c.routeId),
      ...oracle.map((c) => c.routeId),
    ]
    const chosen: ProfiledCandidate[] = []
    for (const id of must) if (!chosen.some((c) => c.id === id)) chosen.push(byId.get(id)!)
    const shapes = new Map<string, Shape>()
    const shape = (r: ProfiledCandidate) => {
      let s = shapes.get(r.id)
      if (!s) shapes.set(r.id, (s = buildShape(routePolyline(r.legs))))
      return s
    }
    for (const r of [...routes].sort((a, b) => a.durationSec - b.durationSec)) {
      if (chosen.length >= MAX_CANDIDATES) break
      if (!chosen.some((c) => c.id === r.id) && isDistinct(shape(r), chosen.map(shape), cfg)) chosen.push(r)
    }
    chosen.sort((a, b) => a.durationSec - b.durationSec)

    const fastestSec = Math.min(...routes.map((r) => r.durationSec))
    const letterOf = new Map(chosen.map((r, i) => [r.id, LETTERS[i]]))
    const candidates: ReviewCandidate[] = chosen.map((r) => ({
      letter: letterOf.get(r.id)!,
      id: r.id,
      durationSec: r.durationSec,
      distanceM: Math.round(r.distanceM),
      extraSec: r.durationSec - fastestSec,
      legs: r.legs.map((l) => polyline.encode(l)),
      signalStops: r.profile.signalStops.map((s) => s.at),
      lights: r.profile.lights,
      dossier: describe(r, fastestSec, layers, cfg),
    }))
    const similarPairs: Array<[string, string]> = []
    for (let i = 0; i < chosen.length; i++) {
      for (let j = i + 1; j < chosen.length; j++) {
        if (!isDistinct(shape(chosen[j]), [shape(chosen[i])], cfg)) similarPairs.push([LETTERS[i], LETTERS[j]])
      }
    }
    const legacyRoles = new Map<string, string[]>()
    for (const [role, id] of Object.entries(legacy.expanded ?? legacy.initial)) {
      legacyRoles.set(id, [...(legacyRoles.get(id) ?? []), role])
    }
    const review: ReviewData = {
      od,
      candidates,
      similarPairs,
      cardSets: {
        legacy: [...legacyRoles.entries()].map(([id, roles]) => ({ letter: letterOf.get(id)!, roles })),
        production: production.map((c) => ({ letter: letterOf.get(c.routeId)!, roles: [c.primary, ...c.badges] })),
      },
    }
    await writeJson(`${OUT_DIR}/review/${od.id}.json`, review)
    const md = [
      `# ${od.name} (${od.straightKm} km straight line, ${od.bucket})`,
      '',
      ...candidates.flatMap((c) => [`## ${c.letter}`, ...c.dossier.map((l) => `- ${l}`), '']),
      similarPairs.length ? `Near-identical pairs (by the current rule): ${similarPairs.map((p) => p.join('≈')).join(', ')}` : '',
    ].join('\n')
    await mkdir(`${OUT_DIR}/dossiers`, { recursive: true })
    await writeFile(`${OUT_DIR}/dossiers/${od.id}.md`, md + '\n')
  }
}
