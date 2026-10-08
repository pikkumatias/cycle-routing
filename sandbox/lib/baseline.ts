// Reproduces what the pre-overhaul app (commit c197bee) showed for a trip, using the frozen
// legacy modules, so the new selection can be compared against what users actually saw.
import { ensureExtract, readExtract } from '../../scripts/lib/osmExtract'
import type { LatLng } from '../../src/routing/types'
import { classifyPoi, type OsmPoi } from './legacy/overpass'
import { estimateBboxFromEndpoints } from './legacy/routeGeometry'
import { deduplicateRoutes, selectDefaultRoutes, selectRoutes } from './legacy/routeSelection'
import type { CandidateRoute } from './legacy/types'
import { readJson, writeJson } from './env'
import { LEGACY_DEFAULT, LEGACY_EXTRA, type Pool } from './generate'

const LEGACY_POIS_FILE = 'sandbox/.cache/legacy-pois.json'

/**
 * Every element the old combined Overpass query fetched, classified by the old rules: nodes
 * as points, ways as the centre of their bounding box (`out center`). Built once from the
 * OSM extract and cached.
 */
export async function loadLegacyPois(): Promise<OsmPoi[]> {
  try {
    return await readJson<OsmPoi[]>(LEGACY_POIS_FILE)
  } catch {
    // build below
  }
  const pois: OsmPoi[] = []
  console.log('building legacy POIs from the extract…')
  await readExtract(await ensureExtract(false), {
    onNode: (_id, lat, lon, tags) => {
      const category = classifyPoi(tags)
      // the old query fetched only these two node kinds
      if (category === 'traffic_signal' || category === 'fountain') pois.push({ lat, lon, type: 'node', category })
    },
    onWay: (_id, _refs, geom, tags) => {
      const category = classifyPoi(tags)
      if (!category || category === 'traffic_signal' || category === 'fountain' || geom.length === 0) return
      const lats = geom.map((p) => p[0])
      const lons = geom.map((p) => p[1])
      pois.push({
        lat: (Math.min(...lats) + Math.max(...lats)) / 2,
        lon: (Math.min(...lons) + Math.max(...lons)) / 2,
        type: 'way',
        category,
      })
    },
  })
  await writeJson(LEGACY_POIS_FILE, pois)
  return pois
}

export type LegacyCards = {
  /** Cards shown right after searching: Fewest lights and Fastest (one if identical). */
  initial: { fastest: string; fewestLights: string }
  /** After expanding "more options" the old app re-selected all four from a bigger pool. */
  expanded: { fastest: string; fewestLights: string; scenic: string; calm: string } | null
}

export function legacyCards(pool: Pool, allPois: OsmPoi[]): LegacyCards {
  const [[south, west], [north, east]] = estimateBboxFromEndpoints(pool.od.from as LatLng, pool.od.to as LatLng)
  const pois = allPois.filter((p) => p.lat >= south && p.lat <= north && p.lon >= west && p.lon <= east)

  const toLegacy = (names: string[]): CandidateRoute[] =>
    pool.routes
      .filter((r) => r.generators.some((g) => names.includes(g)))
      .map((r) => ({ response: r.id, durationSec: r.durationSec, distanceKm: r.distanceM / 1000, polyline: r.legs.flat() }))

  const defaults = deduplicateRoutes(toLegacy(LEGACY_DEFAULT))
  const initial = selectDefaultRoutes(defaults, pois)
  const combined = deduplicateRoutes([...defaults, ...toLegacy(LEGACY_EXTRA)])
  const expanded = combined.length > 0 ? selectRoutes(combined, pois) : null

  const id = (r: { response: unknown }) => r.response as string
  return {
    initial: { fastest: id(initial.fastest), fewestLights: id(initial.fewestLights) },
    expanded: expanded && {
      fastest: id(expanded.fastest),
      fewestLights: id(expanded.fewestLights),
      scenic: id(expanded.scenic),
      calm: id(expanded.calm),
    },
  }
}
