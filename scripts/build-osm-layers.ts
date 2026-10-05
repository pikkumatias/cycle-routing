/**
 * Builds data/osm-layers.json — the OSM data the routing engine needs at request time —
 * so searches never call Overpass. Run with `npm run data:osm` (refresh quarterly).
 *
 * The region is fetched in ~4.5 km chunks, one Overpass query each, cached under
 * .cache/osm/ so an interrupted run resumes and re-runs are free (`--refresh` refetches).
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import polyline from '@mapbox/polyline'
import { GridIndex, haversineDistance, resample, segmentDistance } from '../src/routing/geo'
import type { OsmLayersFile, RoadClass, RoadRecord } from '../src/routing/layers'
import type { LatLng } from '../src/routing/types'

/** Helsinki, Espoo, Vantaa and Kauniainen. */
const REGION = { south: 60.08, west: 24.45, north: 60.42, east: 25.3 }
const CHUNK_LAT = 0.04
const CHUNK_LON = 0.08
// Public mirrors were unreliable for queries this size; the main instance answers 504
// when busy, which a patient backoff gets through. Override with OVERPASS_URL.
const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter'
const MAX_ATTEMPTS = 12
const CACHE_DIR = '.cache/osm'
const OUT_FILE = 'data/osm-layers.json'
const META_FILE = 'data/meta.json'

/** Calm-network nodes are sampled this far apart along each car-free path. */
const CALM_NODE_SPACING_M = 150
/** …and dropped within this distance of a major road (they would not be "away"). */
const CALM_NODE_MIN_ROAD_M = 25
/** A road is a tram street when most of its vertices lie this close to tram rails. */
const TRAM_NEAR_M = 5

const MAJOR = /^(trunk|primary|secondary|tertiary)(_link)?$/
const GRADE_BRIDGE = /^(yes|viaduct|cantilever|movable)$/
const NON_STOPPING_SIGNALS = new Set(['blinker', 'emergency', 'ramp_meter'])

type Tags = Record<string, string>
type OsmNode = { type: 'node'; id: number; lat: number; lon: number; tags?: Tags }
type OsmWay = { type: 'way'; id: number; nodes?: number[]; geometry?: { lat: number; lon: number }[]; tags?: Tags }
type OverpassResult = { osm3s?: { timestamp_osm_base?: string }; elements: Array<OsmNode | OsmWay> }

function chunkQuery(s: number, w: number, n: number, e: number): string {
  return `[out:json][timeout:180][bbox:${s},${w},${n},${e}];
way["highway"~"^(trunk|primary|secondary|tertiary)(_link)?$"];out geom;
(node["highway"="traffic_signals"];node["crossing"="traffic_signals"];);out;
(way["highway"="cycleway"];way["highway"~"^(path|footway|pedestrian|track|bridleway)$"]["bicycle"~"^(yes|designated|permissive)$"];);out tags geom;
(way["highway"]["bridge"~"^(yes|viaduct|cantilever|movable)$"];way["highway"]["tunnel"="yes"];);out tags geom;
way["railway"="tram"];out geom;`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchChunk(query: string, refresh: boolean): Promise<OverpassResult> {
  const file = `${CACHE_DIR}/${createHash('sha1').update(query).digest('hex')}.json`
  if (!refresh) {
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch {
      // not cached yet
    }
  }
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'cycle-routing/1.0 layer build (https://github.com/pikkumatias/cycle-routing)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(200_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as OverpassResult
      await writeFile(file, JSON.stringify(json))
      return json
    } catch (err) {
      lastError = err
      const wait = 10_000 * (attempt + 1)
      console.warn(`  attempt ${attempt + 1} failed (${(err as Error).message}); retrying in ${wait / 1000}s`)
      await sleep(wait)
    }
  }
  throw lastError
}

/** Parse `maxspeed` into km/h; Finnish implicit limits included. */
function parseMaxspeed(v?: string): number | undefined {
  if (!v) return undefined
  if (v === 'FI:urban') return 50
  if (v === 'FI:rural') return 80
  if (v === 'walk') return 10
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) && !v.includes('mph') ? n : undefined
}

const hasBikeLane = (t: Tags) =>
  ['cycleway', 'cycleway:right', 'cycleway:left', 'cycleway:both'].some((k) => t[k] === 'lane')

const geomOf = (w: OsmWay): LatLng[] => (w.geometry ?? []).map((g) => [g.lat, g.lon])
const round6 = (p: LatLng): LatLng => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]

async function main() {
  const refresh = process.argv.includes('--refresh')
  await mkdir(CACHE_DIR, { recursive: true })
  await mkdir('data', { recursive: true })

  const signals = new Map<number, OsmNode>()
  const roads = new Map<number, OsmWay>()
  const paths = new Map<number, OsmWay>()
  const grade = new Map<number, OsmWay>()
  const trams = new Map<number, OsmWay>()
  let osmTimestamp = ''

  const chunks: Array<[number, number, number, number]> = []
  for (let s = REGION.south; s < REGION.north - 1e-9; s += CHUNK_LAT) {
    for (let w = REGION.west; w < REGION.east - 1e-9; w += CHUNK_LON) {
      const r = (x: number) => Math.round(x * 1e4) / 1e4
      chunks.push([r(s), r(w), r(Math.min(s + CHUNK_LAT, REGION.north)), r(Math.min(w + CHUNK_LON, REGION.east))])
    }
  }

  for (const [i, [s, w, n, e]] of chunks.entries()) {
    console.log(`chunk ${i + 1}/${chunks.length} (${s},${w},${n},${e})`)
    const result = await fetchChunk(chunkQuery(s, w, n, e), refresh)
    osmTimestamp ||= result.osm3s?.timestamp_osm_base ?? ''
    for (const el of result.elements) {
      const t = el.tags ?? {}
      if (el.type === 'node') {
        if (!NON_STOPPING_SIGNALS.has(t.traffic_signals ?? '')) signals.set(el.id, el)
        continue
      }
      if (t.railway === 'tram') trams.set(el.id, el)
      else if (MAJOR.test(t.highway ?? '')) roads.set(el.id, el)
      else {
        if (GRADE_BRIDGE.test(t.bridge ?? '') || t.tunnel === 'yes') grade.set(el.id, el)
        if (t.highway) paths.set(el.id, el)
      }
    }
  }

  // Signals, with an index so roads can reference the ones that sit on them.
  const signalList = [...signals.values()]
  const signalIndex = new Map(signalList.map((s, i) => [s.id, i]))

  const tramIndex = new GridIndex<[LatLng, LatLng]>(50)
  for (const t of trams.values()) {
    const g = geomOf(t)
    for (let i = 0; i < g.length - 1; i++) tramIndex.insert([g[i], g[i + 1]], [g[i], g[i + 1]])
  }
  const nearTram = (p: LatLng) =>
    tramIndex.near(p, TRAM_NEAR_M).some(([a, b]) => segmentDistance(p, a, b).distanceM <= TRAM_NEAR_M)

  const roadRecords: RoadRecord[] = []
  const roadIndex = new GridIndex<[LatLng, LatLng]>(50)
  for (const way of roads.values()) {
    const t = way.tags ?? {}
    const geom = geomOf(way)
    if (geom.length < 2) continue
    for (let i = 0; i < geom.length - 1; i++) roadIndex.insert([geom[i], geom[i + 1]], [geom[i], geom[i + 1]])
    const tram = /tram/.test(t.embedded_rails ?? '') || geom.filter(nearTram).length > geom.length / 2
    const onRoad = (way.nodes ?? []).map((id) => signalIndex.get(id)).filter((i): i is number => i !== undefined)
    const record: RoadRecord = {
      cls: t.highway.replace('_link', '') as RoadClass,
      geom: polyline.encode(geom.map(round6), 6),
    }
    if (t.name) record.name = t.name
    const maxspeed = parseMaxspeed(t.maxspeed)
    if (maxspeed !== undefined) record.maxspeed = maxspeed
    const lanes = Number.parseInt(t.lanes ?? '', 10)
    if (Number.isFinite(lanes)) record.lanes = lanes
    if (hasBikeLane(t)) record.bikeLane = true
    if (tram) record.tram = true
    if (GRADE_BRIDGE.test(t.bridge ?? '')) record.grade = 'bridge'
    else if (t.tunnel === 'yes') record.grade = 'tunnel'
    if (onRoad.length > 0) record.signals = onRoad
    roadRecords.push(record)
  }
  const nearRoad = (p: LatLng) =>
    roadIndex.near(p, CALM_NODE_MIN_ROAD_M).some(([a, b]) => segmentDistance(p, a, b).distanceM <= CALM_NODE_MIN_ROAD_M)

  // Calm-network nodes: car-free paths sampled every 150 m, away from major roads.
  const calmNodes: LatLng[] = []
  const calmIndex = new GridIndex<LatLng>(CALM_NODE_SPACING_M)
  for (const way of paths.values()) {
    const t = way.tags ?? {}
    if (t.footway === 'sidewalk' || t.cycleway === 'sidewalk' || t.access === 'private' || t.bicycle === 'no') continue
    for (const p of resample(geomOf(way), CALM_NODE_SPACING_M)) {
      if (nearRoad(p)) continue
      if (calmIndex.near(p, CALM_NODE_SPACING_M / 2).some((q) => haversineDistance(p, q) < CALM_NODE_SPACING_M / 2)) continue
      calmIndex.insert(p, [p])
      calmNodes.push(round6(p))
    }
  }

  const gradeSeparated = [...grade.values()]
    .map(geomOf)
    .filter((g) => g.length >= 2)
    .map((g) => polyline.encode(g.map(round6), 6))

  const file: OsmLayersFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    osmTimestamp,
    bbox: [REGION.south, REGION.west, REGION.north, REGION.east],
    signals: signalList.map((s) => round6([s.lat, s.lon])),
    roads: roadRecords,
    calmNodes,
    gradeSeparated,
  }
  const json = JSON.stringify(file)
  await writeFile(OUT_FILE, json)
  const meta = {
    generatedAt: file.generatedAt,
    osmTimestamp,
    bbox: file.bbox,
    counts: {
      signals: file.signals.length,
      roads: roadRecords.length,
      tramRoads: roadRecords.filter((r) => r.tram).length,
      calmNodes: calmNodes.length,
      gradeSeparated: gradeSeparated.length,
    },
    bytes: json.length,
  }
  await writeFile(META_FILE, JSON.stringify(meta, null, 2) + '\n')
  console.log(meta)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
