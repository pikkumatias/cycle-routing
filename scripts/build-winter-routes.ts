/**
 * Builds data/winter-routes.json — Helsinki's prioritised winter maintenance network for
 * cycling (brush-salted and intensified-ploughing routes) — from the City of Helsinki's open
 * WFS. Licence CC BY 4.0, © City of Helsinki. Run with `npm run data:winter` each autumn,
 * when the city publishes the season's network.
 */
import { writeFile } from 'node:fs/promises'
import polyline from '@mapbox/polyline'
import type { WinterKind, WinterRoutesFile } from '../src/routing/layers'
import type { LatLng } from '../src/routing/types'

const LAYER = 'avoindata:Talvihoidon_priorisoitu_reitisto'
const URL =
  'https://kartta.hel.fi/ws/geoserver/avoindata/wfs?service=WFS&version=2.0.0&request=GetFeature' +
  `&typeNames=${LAYER}&outputFormat=application/json&srsName=EPSG:4326`
const OUT_FILE = 'data/winter-routes.json'

const KIND: Record<string, WinterKind> = { Harjasuolaus: 'brush', 'Tehostettu auraus': 'plough' }

type Feature = {
  properties: { nimi: string; hoitotapa: string }
  geometry: { type: 'LineString'; coordinates: number[][] } | { type: 'MultiLineString'; coordinates: number[][][] } | null
}

// GeoJSON in EPSG:4326 is [lon, lat]
const toLatLng = (c: number[]): LatLng => [Math.round(c[1] * 1e6) / 1e6, Math.round(c[0] * 1e6) / 1e6]

async function main() {
  const res = await fetch(URL, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`WFS answered HTTP ${res.status}`)
  const { features } = (await res.json()) as { features: Feature[] }

  const routes: WinterRoutesFile['routes'] = []
  for (const f of features) {
    const kind = KIND[f.properties.hoitotapa]
    // A new maintenance type means the city changed the data; decide how to treat it
    if (!kind) throw new Error(`Unknown hoitotapa "${f.properties.hoitotapa}" on ${f.properties.nimi}`)
    if (!f.geometry) continue
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates
    for (const coords of lines) {
      if (coords.length < 2) continue
      routes.push({ kind, name: f.properties.nimi, geom: polyline.encode(coords.map(toLatLng), 6) })
    }
  }
  if (routes.length === 0) throw new Error('The WFS returned no winter routes')

  const file: WinterRoutesFile = { version: 1, fetchedAt: new Date().toISOString(), source: LAYER, routes }
  await writeFile(OUT_FILE, JSON.stringify(file))
  const count = (k: WinterKind) => routes.filter((r) => r.kind === k).length
  console.log({ routes: routes.length, brush: count('brush'), plough: count('plough'), bytes: JSON.stringify(file).length })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
