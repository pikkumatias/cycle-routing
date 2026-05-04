/**
 * Overpass API client for OSM POIs and cycling infrastructure in a bounding box.
 * No API key required. See https://wiki.openstreetmap.org/wiki/Overpass_API
 */

const OVERPASS_PROXY = '/api/overpass'
const DEFAULT_TIMEOUT_SEC = 8
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 0

// Cap bbox to prevent oversized queries (~39km lat × ~24km lon at 60°N)
const MAX_BBOX_SPAN = 0.35


export type Bbox = {
  south: number
  west: number
  north: number
  east: number
}

export type PoiCategory =
  | 'park'
  | 'garden'
  | 'nature_reserve'
  | 'forest'
  | 'wood'
  | 'meadow'
  | 'grass'
  | 'water'
  | 'fountain'
  | 'river_stream'
  | 'cycleway_separated'
  | 'cycleway_designated'
  | 'cycleway_lane'
  | 'traffic_signal'

export type OsmPoi = {
  lat: number
  lon: number
  type?: 'node' | 'way'
  tags?: Record<string, string>
  category?: PoiCategory
}

/**
 * Classify an OSM element by its tags into a PoiCategory.
 * Cycling infrastructure is checked first, then scenic/nature categories.
 */
export function classifyPoi(tags: Record<string, string> | undefined): PoiCategory | undefined {
  if (!tags) return undefined

  // Traffic signals
  if (tags.highway === 'traffic_signals') return 'traffic_signal'

  // Cycling infrastructure
  if (tags.highway === 'cycleway') return 'cycleway_separated'
  if (
    tags.cycleway === 'track' ||
    tags['cycleway:left'] === 'track' ||
    tags['cycleway:right'] === 'track'
  ) return 'cycleway_separated'
  if (tags.cycleway === 'lane') return 'cycleway_lane'
  if (
    tags.bicycle === 'designated' &&
    (tags.highway === 'path' || tags.highway === 'footway')
  ) return 'cycleway_designated'

  // Scenic / nature
  if (tags.leisure === 'park') return 'park'
  if (tags.leisure === 'garden') return 'garden'
  if (tags.leisure === 'nature_reserve') return 'nature_reserve'
  if (tags.landuse === 'forest') return 'forest'
  if (tags.natural === 'wood') return 'wood'
  if (tags.landuse === 'meadow') return 'meadow'
  if (tags.landuse === 'grass') return 'grass'
  if (tags.natural === 'water') return 'water'
  if (tags.amenity === 'fountain') return 'fountain'
  if (tags.waterway === 'river' || tags.waterway === 'stream') return 'river_stream'

  return undefined
}

function capBbox(bbox: Bbox): Bbox {
  const latMid = (bbox.south + bbox.north) / 2
  const lngMid = (bbox.west + bbox.east) / 2
  const latHalf = Math.min((bbox.north - bbox.south) / 2, MAX_BBOX_SPAN / 2)
  const lngHalf = Math.min((bbox.east - bbox.west) / 2, MAX_BBOX_SPAN / 2)
  return {
    south: latMid - latHalf,
    west: lngMid - lngHalf,
    north: latMid + latHalf,
    east: lngMid + lngHalf,
  }
}

/**
 * Combined scenic POIs + cycling infrastructure query in a single Overpass request.
 * Uses `out center qt` — `qt` (quadtile sort) speeds up server-side processing.
 */
function buildCombinedQuery(bbox: Bbox, timeoutSec: number): string {
  const { south, west, north, east } = bbox
  const b = `(${south},${west},${north},${east})`
  return `[out:json][timeout:${timeoutSec}];
(
  way["leisure"="park"]${b};
  way["leisure"="garden"]${b};
  way["leisure"="nature_reserve"]${b};
  way["landuse"="grass"]${b};
  way["landuse"="forest"]${b};
  way["natural"="wood"]${b};
  way["landuse"="meadow"]${b};
  way["natural"="water"]${b};
  node["amenity"="fountain"]${b};
  node["highway"="traffic_signals"]${b};
  way["waterway"="river"]${b};
  way["waterway"="stream"]${b};
  way["highway"="cycleway"]${b};
  way["cycleway"="track"]${b};
  way["cycleway"="lane"]${b};
  way["cycleway:left"="track"]${b};
  way["cycleway:right"="track"]${b};
  way["bicycle"="designated"]["highway"="path"]${b};
  way["bicycle"="designated"]["highway"="footway"]${b};
);
out center qt;`
}

type OverpassElement = {
  type?: 'node' | 'way'
  lat?: number
  lon?: number
  center?: { lat?: number; lon?: number }
  tags?: Record<string, string>
}

/**
 * Parse Overpass JSON response into an array of classified POIs.
 */
function parseOverpassResponse(data: unknown): OsmPoi[] {
  const elements = (data as { elements?: OverpassElement[] })?.elements
  if (!Array.isArray(elements)) return []

  const result: OsmPoi[] = []
  for (const el of elements) {
    let lat: number | undefined
    let lon: number | undefined
    if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
      lat = el.lat
      lon = el.lon
    } else if (el.type === 'way' && el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
      lat = el.center.lat
      lon = el.center.lon
    }
    if (lat != null && lon != null) {
      const tags = el.tags && typeof el.tags === 'object' ? el.tags : undefined
      result.push({
        lat,
        lon,
        type: el.type,
        tags,
        category: classifyPoi(tags),
      })
    }
  }
  return result
}

/**
 * Fetch a single Overpass query, retrying on the fallback endpoint if the primary fails.
 * Throws if all endpoints fail.
 */
async function fetchQuery(
  query: string,
  timeoutSec: number,
  callerSignal?: AbortSignal,
): Promise<OsmPoi[]> {
  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (callerSignal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (attempt > 0) {
      await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS))
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), (timeoutSec + 3) * 1000)
    const onCallerAbort = () => controller.abort()
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })

    try {
      const res = await fetch(OVERPASS_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Overpass proxy error: ${res.status}\n${text.slice(0, 500)}`)
      }
      return parseOverpassResponse(await res.json())
    } catch (err) {
      lastError = err
      if (callerSignal?.aborted) throw err
    } finally {
      clearTimeout(timeoutId)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    }
  }

  throw lastError
}

// In-memory cache: quantized bbox key → POI results. Quantized to 0.01° grid (~1km) so
// nearby queries share the same cache entry. OSM data rarely changes within a session.
const poiCache = new Map<string, OsmPoi[]>()

function bboxCacheKey(bbox: Bbox): string {
  const q = (n: number) => Math.round(n / 0.01) * 0.01
  return `${q(bbox.south)},${q(bbox.west)},${q(bbox.north)},${q(bbox.east)}`
}

/**
 * Fetch scenic POIs and cycling infrastructure from OpenStreetMap via Overpass API.
 * Uses a single combined query (one HTTP round-trip). Results are cached in memory
 * for the session, keyed by a quantized bbox (~1km grid) to share nearby lookups.
 */
export async function fetchPoisAndInfrastructure(
  bbox: Bbox,
  options?: { timeoutSec?: number; signal?: AbortSignal },
): Promise<OsmPoi[]> {
  const timeoutSec = options?.timeoutSec ?? DEFAULT_TIMEOUT_SEC
  const capped = capBbox(bbox)
  const cacheKey = bboxCacheKey(capped)

  const cached = poiCache.get(cacheKey)
  if (cached) return cached

  const result = await fetchQuery(buildCombinedQuery(capped, timeoutSec), timeoutSec, options?.signal)
  poiCache.set(cacheKey, result)
  return result
}

/** Backward-compatible alias for the original fetch function. */
export const fetchParksAndWater = fetchPoisAndInfrastructure

/**
 * Convert route bounds from getBoundsFromLegsAndPoints format to Overpass Bbox.
 * Input: [[minLat, minLon], [maxLat, maxLon]] (south-west, north-east).
 */
export function boundsToBbox(bounds: [number, number][]): Bbox | null {
  if (!bounds || bounds.length < 2) return null
  const [[south, west], [north, east]] = bounds
  if (typeof south !== 'number' || typeof west !== 'number' || typeof north !== 'number' || typeof east !== 'number') return null
  return { south, west, north, east }
}

/** Convert OsmPoi[] to [lat, lng][] for use with distance/scoring utils. */
export function osmPoisToLatLngs(pois: OsmPoi[]): [number, number][] {
  return pois.map((p) => [p.lat, p.lon])
}
