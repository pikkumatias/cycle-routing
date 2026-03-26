/**
 * Overpass API client for OSM POIs and cycling infrastructure in a bounding box.
 * No API key required. See https://wiki.openstreetmap.org/wiki/Overpass_API
 */

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'
const OVERPASS_FALLBACK_ENDPOINT = 'https://overpass.kumi.systems/api/interpreter'
const DEFAULT_TIMEOUT_SEC = 15

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
 * Scenic POIs query: parks, nature, water features.
 */
function buildScenicQuery(bbox: Bbox, timeoutSec: number): string {
  const { south, west, north, east } = bbox
  const b = `(${south},${west},${north},${east})`
  return `[out:json][timeout:${timeoutSec}];
(
  node["leisure"="park"]${b};
  way["leisure"="park"]${b};
  node["leisure"="garden"]${b};
  way["leisure"="garden"]${b};
  node["leisure"="nature_reserve"]${b};
  way["leisure"="nature_reserve"]${b};
  node["landuse"="grass"]${b};
  way["landuse"="grass"]${b};
  node["landuse"="forest"]${b};
  way["landuse"="forest"]${b};
  node["natural"="wood"]${b};
  way["natural"="wood"]${b};
  node["landuse"="meadow"]${b};
  way["landuse"="meadow"]${b};
  node["natural"="water"]${b};
  way["natural"="water"]${b};
  node["amenity"="fountain"]${b};
  node["waterway"="river"]${b};
  node["waterway"="stream"]${b};
  way["waterway"="river"]${b};
  way["waterway"="stream"]${b};
);
out center;`
}

/**
 * Cycling infrastructure query: cycleways, lanes, designated paths.
 */
function buildInfraQuery(bbox: Bbox, timeoutSec: number): string {
  const { south, west, north, east } = bbox
  const b = `(${south},${west},${north},${east})`
  return `[out:json][timeout:${timeoutSec}];
(
  way["highway"="cycleway"]${b};
  way["cycleway"="track"]${b};
  way["cycleway"="lane"]${b};
  way["cycleway:left"="track"]${b};
  way["cycleway:right"="track"]${b};
  way["bicycle"="designated"]["highway"="path"]${b};
  way["bicycle"="designated"]["highway"="footway"]${b};
);
out center;`
}

/**
 * Parse Overpass JSON response into an array of classified POIs.
 */
function parseOverpassResponse(data: any): OsmPoi[] {
  const elements = data?.elements
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
  const endpoints = [OVERPASS_ENDPOINT, OVERPASS_FALLBACK_ENDPOINT]

  for (let i = 0; i < endpoints.length; i++) {
    if (callerSignal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), (timeoutSec + 3) * 1000)
    const onCallerAbort = () => controller.abort()
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true })

    try {
      const res = await fetch(endpoints[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Overpass API error: ${res.status} ${res.statusText}\n${text.slice(0, 500)}`)
      }
      return parseOverpassResponse(await res.json())
    } catch (err) {
      if (callerSignal?.aborted) throw err
      if (i === endpoints.length - 1) throw err
      // Brief pause before trying fallback endpoint
      await new Promise<void>((r) => setTimeout(r, 300))
    } finally {
      clearTimeout(timeoutId)
      callerSignal?.removeEventListener('abort', onCallerAbort)
    }
  }

  return []
}

/**
 * Fetch scenic POIs and cycling infrastructure from OpenStreetMap via Overpass API.
 * Runs scenic and infrastructure queries in parallel. If one fails, the other still
 * contributes to scoring. Throws only if both queries fail on all endpoints.
 */
export async function fetchPoisAndInfrastructure(
  bbox: Bbox,
  options?: { timeoutSec?: number; signal?: AbortSignal },
): Promise<OsmPoi[]> {
  const timeoutSec = options?.timeoutSec ?? DEFAULT_TIMEOUT_SEC
  const capped = capBbox(bbox)

  const [scenic, infra] = await Promise.allSettled([
    fetchQuery(buildScenicQuery(capped, timeoutSec), timeoutSec, options?.signal),
    fetchQuery(buildInfraQuery(capped, timeoutSec), timeoutSec, options?.signal),
  ])

  const result: OsmPoi[] = []
  if (scenic.status === 'fulfilled') result.push(...scenic.value)
  if (infra.status === 'fulfilled') result.push(...infra.value)

  if (scenic.status === 'rejected' && infra.status === 'rejected') {
    throw scenic.reason
  }

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
