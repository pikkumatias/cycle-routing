/**
 * Streaming reader for BBBike's Helsinki OSM extract (OSM XML written by osmium), shared by
 * the layer build and the calibration sandbox. No dependencies beyond Node.
 */
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { createGunzip } from 'node:zlib'
import type { LatLng } from '../../src/routing/types'

export const EXTRACT_URL = 'https://download.bbbike.org/osm/bbbike/Helsinki/Helsinki.osm.gz'
export const EXTRACT_FILE = '.cache/osm/Helsinki.osm.gz'
export const USER_AGENT = 'cycle-routing/1.0 layer build (https://github.com/pikkumatias/cycle-routing)'

export type Tags = Record<string, string>

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

/** Download the extract into the cache unless it is already there. */
export async function ensureExtract(refresh: boolean): Promise<string> {
  const cached = !refresh && (await stat(EXTRACT_FILE).then((s) => s.size > 0, () => false))
  if (!cached) {
    await mkdir('.cache/osm', { recursive: true })
    console.log(`downloading ${EXTRACT_URL}`)
    const res = await fetch(EXTRACT_URL, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok || !res.body) throw new Error(`Extract download failed: HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(EXTRACT_FILE))
  }
  return EXTRACT_FILE
}

export type ExtractHandlers = {
  /** Called for every node that has tags. */
  onNode?: (id: number, lat: number, lon: number, tags: Tags) => void
  /** Called for every way, with its geometry resolved (nodes outside the extract dropped). */
  onWay?: (id: number, refs: number[], geom: LatLng[], tags: Tags) => void
}

type Pending = { kind: 'node' | 'way'; id: number; lat: number; lon: number; refs: number[]; tags: Tags }

/**
 * Stream the extract, calling the handlers per element. Returns the extract's bounds and
 * the newest edit timestamp (a stand-in for its OSM data timestamp).
 */
export async function readExtract(
  file: string,
  handlers: ExtractHandlers,
): Promise<{ bbox: [number, number, number, number]; newestEdit: string }> {
  const nodes = new NodeStore()
  let bbox: [number, number, number, number] = [0, 0, 0, 0]
  let newestEdit = ''
  let current: Pending | null = null

  const finish = (p: Pending) => {
    if (p.kind === 'node') handlers.onNode?.(p.id, p.lat, p.lon, p.tags)
    else {
      const geom = p.refs.map((r) => nodes.get(r)).filter((q): q is LatLng => q !== null)
      handlers.onWay?.(p.id, p.refs, geom, p.tags)
    }
  }

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
      bbox = [
        Number(attr(line, 'minlat')),
        Number(attr(line, 'minlon')),
        Number(attr(line, 'maxlat')),
        Number(attr(line, 'maxlon')),
      ]
    }
  }
  lines.close()
  return { bbox, newestEdit }
}
