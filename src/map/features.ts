import type { Feature, FeatureCollection, LineString, MultiLineString, Point, Polygon, MultiPolygon } from 'geojson'
import type { PlannedRoute } from '../api/routePlan'
import type { CityBikeStation } from '../services/citybikes'
import { hazardToLatLng, type Hazard } from '../services/hazards'
import { exposureRuns, type ExposureBucket } from '../components/exposure'
import { cumulativeLengths } from '../routing/geo'
import { toDisplayLegs, type LatLng } from '../utils/routeGeometry'


/** GeoJSON is [lon, lat]; the app uses [lat, lon]. */
const toLngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat]

export type RouteFeatureProps = { id: string }

/**
 * Every route as one smoothed feature. Built once per plan: the map switches the selection
 * with layer filters on `id` (`isRoute`), so tapping a card sends no new geometry.
 */
export function routeFeatures(routes: Pick<PlannedRoute, 'id' | 'legs'>[]): FeatureCollection<MultiLineString, RouteFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: routes.map((r): Feature<MultiLineString, RouteFeatureProps> => ({
      type: 'Feature',
      properties: { id: r.id },
      geometry: {
        type: 'MultiLineString',
        coordinates: toDisplayLegs(r.legs).map((leg) => leg.map(toLngLat)),
      },
    })),
  }
}

/** Layer filter matching one route (or, negated, every other one). */
export function isRoute(id: string | null, negate = false): ['==' | '!=', ['get', 'id'], string] {
  return [negate ? '!=' : '==', ['get', 'id'], id ?? '']
}

/**
 * The route split where its traffic changes, one smoothed line per stretch with its exposure
 * bucket, for drawing the selected route in traffic colours. Run ends are metres along the
 * legs joined into one line, as the server measured them.
 */
export function stressFeatures(
  route: Pick<PlannedRoute, 'legs' | 'stressRuns'>,
): FeatureCollection<LineString, { bucket: ExposureBucket }> {
  const poly: LatLng[] = []
  for (const leg of route.legs) {
    for (const p of leg) {
      const last = poly[poly.length - 1]
      if (!last || last[0] !== p[0] || last[1] !== p[1]) poly.push(p)
    }
  }
  const runs = exposureRuns(route.stressRuns)
  if (poly.length < 2 || runs.length === 0) return { type: 'FeatureCollection', features: [] }

  const cum = cumulativeLengths(poly)
  const length = cum[cum.length - 1]
  const pointAt = (m: number): LatLng => {
    let i = 1
    while (i < poly.length - 1 && cum[i] < m) i++
    const span = cum[i] - cum[i - 1]
    const f = span > 0 ? Math.max(0, Math.min(1, (m - cum[i - 1]) / span)) : 0
    return [poly[i - 1][0] + (poly[i][0] - poly[i - 1][0]) * f, poly[i - 1][1] + (poly[i][1] - poly[i - 1][1]) * f]
  }

  const features = runs.map(({ bucket, from, to }): Feature<LineString, { bucket: ExposureBucket }> => {
    const fromM = from * length
    const toM = to * length
    const piece = [pointAt(fromM), ...poly.filter((_, i) => cum[i] > fromM && cum[i] < toM), pointAt(toM)]
    return {
      type: 'Feature',
      properties: { bucket },
      geometry: { type: 'LineString', coordinates: toDisplayLegs([piece])[0].map(toLngLat) },
    }
  })
  return { type: 'FeatureCollection', features }
}

export function pointFeatures(points: LatLng[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: toLngLat(p) } })),
  }
}

export type BikeFeatureProps = { id: string; name: string; bikes: number }

export function bikeFeatures(stations: CityBikeStation[]): FeatureCollection<Point, BikeFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: stations.map((s) => ({
      type: 'Feature',
      properties: { id: s.stationId, name: s.name, bikes: s.bikesAvailable },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    })),
  }
}

export type HazardFeatureProps = { id: string; type: Hazard['type'] }

/** Roadwork areas (polygons) and one marker point per roadwork. */
export function hazardFeatures(hazards: Hazard[]): {
  areas: FeatureCollection<Polygon | MultiPolygon, HazardFeatureProps>
  points: FeatureCollection<Point, HazardFeatureProps>
} {
  const areas: Feature<Polygon | MultiPolygon, HazardFeatureProps>[] = []
  const points: Feature<Point, HazardFeatureProps>[] = []
  for (const h of hazards) {
    const properties = { id: h.id, type: h.type }
    if (h.geometry.type === 'Polygon' || h.geometry.type === 'MultiPolygon') {
      areas.push({ type: 'Feature', properties, geometry: h.geometry })
    }
    const at = hazardToLatLng(h)
    if (at) points.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: toLngLat(at) } })
  }
  return {
    areas: { type: 'FeatureCollection', features: areas },
    points: { type: 'FeatureCollection', features: points },
  }
}
