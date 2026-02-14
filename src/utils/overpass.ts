/**
 * Overpass API client for OSM POIs (parks, water) in a bounding box.
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

export type OsmPoi = {
  lat: number
  lon: number
  type?: 'node' | 'way'
  tags?: Record<string, string>
}

/**
 * Build Overpass QL query for parks and water in a bbox.
 * Uses nodes and ways; for ways we request center so we get a single point per feature.
 */
function buildParksAndWaterQuery(bbox: Bbox, timeoutSec: number): string {
  const { south, west, north, east } = bbox
  return `[out:json][timeout:${timeoutSec}];
(
  node["leisure"="park"](${south},${west},${north},${east});
  node["landuse"="grass"](${south},${west},${north},${east});
  node["landuse"="forest"](${south},${west},${north},${east});
  node["natural"="water"](${south},${west},${north},${east});
  way["leisure"="park"](${south},${west},${north},${east});
  way["natural"="water"](${south},${west},${north},${east});
);
out center;`
}

/**
 * Parse Overpass JSON response into an array of { lat, lon } (and optional tags).
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
      result.push({
        lat,
        lon,
        type: el.type,
        tags: el.tags && typeof el.tags === 'object' ? el.tags : undefined,
      })
    }
  }
  return result
}

/**
 * Fetch parks and water POIs from OpenStreetMap via the Overpass API.
 * No registration or API key required. Use a tight bbox and reasonable timeout.
 */
export async function fetchParksAndWater(
  bbox: Bbox,
  options?: { timeoutSec?: number; signal?: AbortSignal },
): Promise<OsmPoi[]> {
  const timeoutSec = options?.timeoutSec ?? DEFAULT_TIMEOUT_SEC
  const query = buildParksAndWaterQuery(bbox, timeoutSec)

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
