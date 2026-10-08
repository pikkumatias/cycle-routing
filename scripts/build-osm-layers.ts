/**
 * Builds data/osm-layers.json — the OSM data the routing engine needs at request time —
 * so searches never call Overpass. Run with `npm run data:osm` (refresh quarterly).
 *
 * Sources:
 * - default: BBBike's daily Helsinki extract (OSM XML, ~130 MB gzipped), parsed as a stream.
 *   Covers lat 60.11–60.35, lon 24.59–25.24. Downloaded once into .cache/osm/.
 * - `--source=overpass`: the region in ~4.5 km Overpass chunks, each cached under
 *   .cache/osm/. Public Overpass is often overloaded (504s), so this can take hours.
 * `--refresh` ignores the cache.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { createGunzip } from 'node:zlib'
import polyline from '@mapbox/polyline'
import { GridIndex, haversineDistance, resample, segmentDistance } from '../src/routing/geo'
import type { OsmLayersFile, RoadClass, RoadRecord } from '../src/routing/layers'
import type { LatLng } from '../src/routing/types'

const EXTRACT_URL = 'https://download.bbbike.org/osm/bbbike/Helsinki/Helsinki.osm.gz'
/** Helsinki, Espoo, Vantaa and Kauniainen, for the Overpass source. */
const OVERPASS_REGION = { south: 60.08, west: 24.45, north: 60.42, east: 25.3 }
const CHUNK_LAT = 0.04
const CHUNK_LON = 0.08
const OVERPASS_URL = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter'
const MAX_ATTEMPTS = 12
const CACHE_DIR = '.cache/osm'
const OUT_FILE = 'data/osm-layers.json'
const META_FILE = 'data/meta.json'
const USER_AGENT = 'cycle-routing/1.0 layer build (https://github.com/pikkumatias/cycle-routing)'

/** Calm-network nodes are sampled this far apart along each car-free path. */
const CALM_NODE_SPACING_M = 150
/** …and dropped within this distance of a major road (they would not be "away"). */
const CALM_NODE_MIN_ROAD_M = 25
/** A road is a tram street when most of its vertices lie this close to tram rails. */
const TRAM_NEAR_M = 5

const MAJOR = /^(trunk|primary|secondary|tertiary)(_link)?$/
const GRADE_BRIDGE = /^(yes|viaduct|cantilever|movable)$/
const PATH_LIKE = /^(path|footway|pedestrian|track|bridleway)$/
const BIKE_ALLOWED = /^(yes|designated|permissive)$/
const NON_STOPPING_SIGNALS = new Set(['blinker', 'emergency', 'ramp_meter'])

type Tags = Record<string, string>
type Signal = { id: number; lat: number; lon: number }
type Way = { id: number; nodes: number[]; geom: LatLng[]; tags: Tags }

/** Everything the layer file is built from, whichever source supplied it. */
type Collected = {
  signals: Map<number, Signal>
  roads: Map<number, Way>
  paths: Map<number, Way>
  grade: Map<number, Way>
  trams: Map<number, Way>
  osmTimestamp: string
  bbox: [number, number, number, number]
}

const emptyCollected = (bbox: Collected['bbox']): Collected => ({
  signals: new Map(),
  roads: new Map(),
  paths: new Map(),
  grade: new Map(),
  trams: new Map(),
  osmTimestamp: '',
  bbox,
})

const isStoppingSignal = (t: Tags) =>
  (t.highway === 'traffic_signals' || t.crossing === 'traffic_signals') &&
  !NON_STOPPING_SIGNALS.has(t.traffic_signals ?? '')

/** Sort a way into the layer it feeds; mirrors the Overpass query below. */
function addWay(c: Collected, way: Way): void {
  const t = way.tags
  if (way.geom.length < 2) return
  if (t.railway === 'tram') c.trams.set(way.id, way)
  if (!t.highway) return
  if (MAJOR.test(t.highway)) {
    c.roads.set(way.id, way)
    return
  }
  if (GRADE_BRIDGE.test(t.bridge ?? '') || t.tunnel === 'yes') c.grade.set(way.id, way)
  if (t.highway === 'cycleway' || (PATH_LIKE.test(t.highway) && BIKE_ALLOWED.test(t.bicycle ?? ''))) {
    c.paths.set(way.id, way)
  }
}

// ── Source: BBBike extract ──────────────────────────────────────────────────────────

const decodeXml = (v: string) =>
  v.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const attr = (line: string, name: string) => line.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]

/**
 * Node coordinates for the whole extract in sorted typed arrays — osmium writes nodes
 * sorted by id and before any way — so millions of nodes fit in memory.
 */
class NodeStore {
  private ids = new Float64Array(1 << 20)
  private lats = new Int32Array(1 << 20)
  private lons = new Int32Array(1 << 20)
  private size = 0

  add(id: number, lat: number, lon: number): void {
    if (this.size === this.ids.length) {
      const ids = new Float64Array(this.ids.length * 2)
      const lats = new Int32Array(this.ids.length * 2)
      const lons = new Int32Array(this.ids.length * 2)
      ids.set(this.ids)
      lats.set(this.lats)
      lons.set(this.lons)
      this.ids = ids
      this.lats = lats
      this.lons = lons
    }
    this.ids[this.size] = id
    this.lats[this.size] = Math.round(lat * 1e7)
    this.lons[this.size] = Math.round(lon * 1e7)
    this.size++
  }

  get(id: number): LatLng | null {
    let lo = 0
    let hi = this.size - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const v = this.ids[mid]
      if (v === id) return [this.lats[mid] / 1e7, this.lons[mid] / 1e7]
      if (v < id) lo = mid + 1
      else hi = mid - 1
    }
    return null
  }
}

type Pending = { kind: 'node' | 'way'; id: number; lat: number; lon: number; refs: number[]; tags: Tags }

async function collectFromExtract(refresh: boolean): Promise<Collected> {
  const file = `${CACHE_DIR}/Helsinki.osm.gz`
  const cached = !refresh && (await stat(file).then((s) => s.size > 0, () => false))
  if (!cached) {
    console.log(`downloading ${EXTRACT_URL}`)
    const res = await fetch(EXTRACT_URL, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok || !res.body) throw new Error(`Extract download failed: HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(file))
  }

  const c = emptyCollected([0, 0, 0, 0])
  const nodes = new NodeStore()
  let current: Pending | null = null
  let newestEdit = ''

  const finish = (p: Pending) => {
    if (p.kind === 'node') {
      if (isStoppingSignal(p.tags)) c.signals.set(p.id, { id: p.id, lat: p.lat, lon: p.lon })
      return
    }
    const geom = p.refs.map((r) => nodes.get(r)).filter((q): q is LatLng => q !== null)
    addWay(c, { id: p.id, nodes: p.refs, geom, tags: p.tags })
  }

  console.log('parsing extract…')
  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })
  for await (const raw of lines) {
    const line = raw.trimStart()
    if (line.startsWith('<node ')) {
      const id = Number(attr(line, 'id'))
      const lat = Number(attr(line, 'lat'))
      const lon = Number(attr(line, 'lon'))
      nodes.add(id, lat, lon)
      const ts = attr(line, 'timestamp')
      if (ts && ts > newestEdit) newestEdit = ts
      current = line.endsWith('/>') ? null : { kind: 'node', id, lat, lon, refs: [], tags: {} }
    } else if (line.startsWith('<way ')) {
      current = { kind: 'way', id: Number(attr(line, 'id')), lat: 0, lon: 0, refs: [], tags: {} }
    } else if (line.startsWith('<nd ') && current) {
      current.refs.push(Number(attr(line, 'ref')))
    } else if (line.startsWith('<tag ') && current) {
      const k = attr(line, 'k')
      const v = attr(line, 'v')
      if (k !== undefined && v !== undefined) current.tags[decodeXml(k)] = decodeXml(v)
    } else if ((line.startsWith('</node>') || line.startsWith('</way>')) && current) {
      finish(current)
      current = null
    } else if (line.startsWith('<relation ')) {
      break // relations come last and are not needed
    } else if (line.startsWith('<bounds ')) {
      c.bbox = [
        Number(attr(line, 'minlat')),
        Number(attr(line, 'minlon')),
        Number(attr(line, 'maxlat')),
        Number(attr(line, 'maxlon')),
      ]
    }
  }
  lines.close()
  // The newest edit in the extract approximates its OSM data timestamp.
  c.osmTimestamp = newestEdit
  return c
}

// ── Source: Overpass ────────────────────────────────────────────────────────────────

type OverpassNode = { type: 'node'; id: number; lat: number; lon: number; tags?: Tags }
type OverpassWay = { type: 'way'; id: number; nodes?: number[]; geometry?: { lat: number; lon: number }[]; tags?: Tags }
type OverpassResult = { osm3s?: { timestamp_osm_base?: string }; elements: Array<OverpassNode | OverpassWay> }

function chunkQuery(s: number, w: number, n: number, e: number): string {
  return `[out:json][timeout:180][bbox:${s},${w},${n},${e}];
way["highway"~"^(trunk|primary|secondary|tertiary)(_link)?$"];out geom;
(node["highway"="traffic_signals"];node["crossing"="traffic_signals"];);out;
(way["highway"="cycleway"];way["highway"~"^(path|footway|pedestrian|track|bridleway)$"]["bicycle"~"^(yes|designated|permissive)$"];);out geom;
(way["highway"]["bridge"~"^(yes|viaduct|cantilever|movable)$"];way["highway"]["tunnel"="yes"];);out geom;
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
      const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
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

async function collectFromOverpass(refresh: boolean): Promise<Collected> {
  const r = OVERPASS_REGION
  const c = emptyCollected([r.south, r.west, r.north, r.east])
  const chunks: Array<[number, number, number, number]> = []
  const round = (x: number) => Math.round(x * 1e4) / 1e4
  for (let s = r.south; s < r.north - 1e-9; s += CHUNK_LAT) {
    for (let w = r.west; w < r.east - 1e-9; w += CHUNK_LON) {
      chunks.push([round(s), round(w), round(Math.min(s + CHUNK_LAT, r.north)), round(Math.min(w + CHUNK_LON, r.east))])
    }
  }
  for (const [i, [s, w, n, e]] of chunks.entries()) {
    console.log(`chunk ${i + 1}/${chunks.length} (${s},${w},${n},${e})`)
    const result = await fetchChunk(chunkQuery(s, w, n, e), refresh)
    c.osmTimestamp ||= result.osm3s?.timestamp_osm_base ?? ''
    for (const el of result.elements) {
      const t = el.tags ?? {}
      if (el.type === 'node') {
        if (isStoppingSignal(t)) c.signals.set(el.id, { id: el.id, lat: el.lat, lon: el.lon })
      } else {
        addWay(c, { id: el.id, nodes: el.nodes ?? [], geom: (el.geometry ?? []).map((g) => [g.lat, g.lon]), tags: t })
      }
    }
  }
  return c
}

// ── Layer file ──────────────────────────────────────────────────────────────────────

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

const round6 = (p: LatLng): LatLng => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]

function buildFile(c: Collected): OsmLayersFile {
  const signalList = [...c.signals.values()]
  const signalIndex = new Map(signalList.map((s, i) => [s.id, i]))

  const tramIndex = new GridIndex<[LatLng, LatLng]>(50)
  for (const t of c.trams.values()) {
    for (let i = 0; i < t.geom.length - 1; i++) tramIndex.insert([t.geom[i], t.geom[i + 1]], [t.geom[i], t.geom[i + 1]])
  }
  const nearTram = (p: LatLng) =>
    tramIndex.near(p, TRAM_NEAR_M).some(([a, b]) => segmentDistance(p, a, b).distanceM <= TRAM_NEAR_M)

  const roads: RoadRecord[] = []
  const roadIndex = new GridIndex<[LatLng, LatLng]>(50)
  for (const way of c.roads.values()) {
    const t = way.tags
    const geom = way.geom
    for (let i = 0; i < geom.length - 1; i++) roadIndex.insert([geom[i], geom[i + 1]], [geom[i], geom[i + 1]])
    const tram = /tram/.test(t.embedded_rails ?? '') || geom.filter(nearTram).length > geom.length / 2
    const onRoad = way.nodes.map((id) => signalIndex.get(id)).filter((i): i is number => i !== undefined)
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
    roads.push(record)
  }
  const nearRoad = (p: LatLng) =>
    roadIndex.near(p, CALM_NODE_MIN_ROAD_M).some(([a, b]) => segmentDistance(p, a, b).distanceM <= CALM_NODE_MIN_ROAD_M)

  // Calm-network nodes: car-free paths sampled every 150 m, away from major roads.
  const calmNodes: LatLng[] = []
  const calmIndex = new GridIndex<LatLng>(CALM_NODE_SPACING_M)
  for (const way of c.paths.values()) {
    const t = way.tags
    if (t.footway === 'sidewalk' || t.cycleway === 'sidewalk' || t.access === 'private' || t.bicycle === 'no') continue
    for (const p of resample(way.geom, CALM_NODE_SPACING_M)) {
      if (nearRoad(p)) continue
      if (calmIndex.near(p, CALM_NODE_SPACING_M / 2).some((q) => haversineDistance(p, q) < CALM_NODE_SPACING_M / 2)) continue
      calmIndex.insert(p, [p])
      calmNodes.push(round6(p))
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    osmTimestamp: c.osmTimestamp,
    bbox: c.bbox,
    signals: signalList.map((s) => round6([s.lat, s.lon])),
    roads,
    calmNodes,
    gradeSeparated: [...c.grade.values()].map((w) => polyline.encode(w.geom.map(round6), 6)),
  }
}

async function main() {
  const refresh = process.argv.includes('--refresh')
  const source = process.argv.find((a) => a.startsWith('--source='))?.split('=')[1] ?? 'extract'
  await mkdir(CACHE_DIR, { recursive: true })
  await mkdir('data', { recursive: true })

  const collected = source === 'overpass' ? await collectFromOverpass(refresh) : await collectFromExtract(refresh)
  const file = buildFile(collected)
  const json = JSON.stringify(file)
  await writeFile(OUT_FILE, json)
  const meta = {
    generatedAt: file.generatedAt,
    source,
    osmTimestamp: file.osmTimestamp,
    bbox: file.bbox,
    counts: {
      signals: file.signals.length,
      roads: file.roads.length,
      tramRoads: file.roads.filter((r) => r.tram).length,
      calmNodes: file.calmNodes.length,
      gradeSeparated: file.gradeSeparated.length,
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
