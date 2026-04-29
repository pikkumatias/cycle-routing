import { minDistanceToPolyline, samplePolyline } from '../utils/scenicScore'
import type { LatLng } from '../utils/routeGeometry'

export type HazardType = 'excavation' | 'traffic_arrangement' | 'area_rental'

type HazardGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'MultiPoint'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] }

export type Hazard = {
  id: string
  type: HazardType
  purpose: string | null
  address: string | null
  district: string | null
  startDate: string | null
  endDate: string | null
  geometry: HazardGeometry
}

export type HazardBounds = {
  minLat: number
  minLon: number
  maxLat: number
  maxLon: number
}

type LayerConfig = {
  name: string
  type: HazardType
  startField: string
  endField: string
}

const WFS_ENDPOINT = 'https://kartta.hel.fi/ws/geoserver/avoindata/wfs'

const HAZARD_LAYERS: LayerConfig[] = [
  { name: 'avoindata:Kaivuilmoitus_alue',                  type: 'excavation',          startField: 'tyo_alkaa',                endField: 'tyo_paattyy' },
  { name: 'avoindata:Kaivuilmoitus_piste',                 type: 'excavation',          startField: 'tyo_alkaa',                endField: 'tyo_paattyy' },
  { name: 'avoindata:Tilapainen_liikennejarjestely_alue',  type: 'traffic_arrangement', startField: 'liikennejarjestely_alkaa', endField: 'liikennejarjestely_paattyy' },
  { name: 'avoindata:Tilapainen_liikennejarjestely_piste', type: 'traffic_arrangement', startField: 'liikennejarjestely_alkaa', endField: 'liikennejarjestely_paattyy' },
  { name: 'avoindata:Aluevuokraus_alue',                   type: 'area_rental',         startField: 'tyo_alkaa',                endField: 'tyo_paattyy' },
  { name: 'avoindata:Aluevuokraus_piste',                  type: 'area_rental',         startField: 'tyo_alkaa',                endField: 'tyo_paattyy' },
]

const HAZARD_THRESHOLD_M = 100

function buildWfsUrl(layer: LayerConfig, bounds: HazardBounds): string {
  const { minLat, minLon, maxLat, maxLon } = bounds
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: layer.name,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    CQL_FILTER: `status='Käynnissä' AND BBOX(singlegeom,${minLon},${minLat},${maxLon},${maxLat},'EPSG:4326')`,
  })
  return `${WFS_ENDPOINT}?${params.toString()}`
}

function parseFeature(
  feature: unknown,
  layer: LayerConfig,
  fallbackIndex: number,
): Hazard | null {
  const f = feature as {
    id?: string
    geometry?: HazardGeometry
    properties?: Record<string, unknown>
  }
  if (!f?.geometry) return null
  const props = f.properties ?? {}
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    id: String(f.id ?? `${layer.name}-${fallbackIndex}`),
    type: layer.type,
    purpose: str(props.tyon_tarkoitus),
    address: str(props.osoite),
    district: str(props.kaupunginosa),
    startDate: str(props[layer.startField]),
    endDate: str(props[layer.endField]),
    geometry: f.geometry,
  }
}

export async function fetchHazards(bounds: HazardBounds): Promise<Hazard[]> {
  const results = await Promise.allSettled(
    HAZARD_LAYERS.map(async (layer, li) => {
      const res = await fetch(buildWfsUrl(layer, bounds), {
        signal: AbortSignal.timeout(60000),
      })
      if (!res.ok) throw new Error(`WFS ${layer.name}: HTTP ${res.status}`)
      const data = (await res.json()) as { features?: unknown[] }
      return (data.features ?? [])
        .map((f, i) => parseFeature(f, layer, li * 1000 + i))
        .filter((h): h is Hazard => h !== null)
    }),
  )

  const hazards: Hazard[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') {
      hazards.push(...r.value)
    } else {
      console.warn('[hazards] layer failed:', r.reason)
    }
  }
  return hazards
}

// GeoJSON coordinates are [lon, lat]; Leaflet expects [lat, lon]
export function hazardToLatLng(hazard: Hazard): [number, number] | null {
  const geo = hazard.geometry
  if (geo.type === 'Point') {
    return [geo.coordinates[1], geo.coordinates[0]]
  }
  if (geo.type === 'MultiPoint') {
    if (geo.coordinates.length === 0) return null
    const avg = geo.coordinates.reduce((s, c) => [s[0] + c[0], s[1] + c[1]], [0, 0])
    return [avg[1] / geo.coordinates.length, avg[0] / geo.coordinates.length]
  }
  const ring =
    geo.type === 'Polygon' ? geo.coordinates[0] : geo.coordinates[0][0]
  if (!ring || ring.length === 0) return null
  const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length
  const lon = ring.reduce((s, c) => s + c[0], 0) / ring.length
  return [lat, lon]
}

export function filterHazardsNearRoute(
  hazards: Hazard[],
  polyline: LatLng[],
): Hazard[] {
  const sampled = samplePolyline(polyline, 3)
  return hazards.filter((h) => {
    const pos = hazardToLatLng(h)
    return pos ? minDistanceToPolyline(pos, sampled) <= HAZARD_THRESHOLD_M : false
  })
}
