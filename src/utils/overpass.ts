/**
 * Overpass API client for OSM POIs and cycling infrastructure in a bounding box.
 * No API key required. See https://wiki.openstreetmap.org/wiki/Overpass_API
 */

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'
const DEFAULT_TIMEOUT_SEC = 25

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

/**
 * Build Overpass QL query for scenic POIs and cycling infrastructure in a bbox.
 * Uses nodes and ways; for ways we request center so we get a single point per feature.
 */
function buildCombinedQuery(bbox: Bbox, timeoutSec: number): string {
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
 * Fetch scenic POIs and cycling infrastructure from OpenStreetMap via Overpass API.
 * No registration or API key required. Use a tight bbox and reasonable timeout.
 */
export async function fetchPoisAndInfrastructure(
  bbox: Bbox,
  options?: { timeoutSec?: number; signal?: AbortSignal },
): Promise<OsmPoi[]> {
  const timeoutSec = options?.timeoutSec ?? DEFAULT_TIMEOUT_SEC
  const query = buildCombinedQuery(bbox, timeoutSec)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), (timeoutSec + 5) * 1000)
  const signal = options?.signal ?? controller.signal

  try {
    const res = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal,
    })
    clearTimeout(timeoutId)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Overpass API error: ${res.status} ${res.statusText}\n${text.slice(0, 500)}`)
    }
    const data = await res.json()
    return parseOverpassResponse(data)
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof Error) throw err
    throw new Error('Overpass request failed')
  }
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
