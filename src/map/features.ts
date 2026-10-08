import type { Feature, FeatureCollection, MultiLineString, Point, Polygon, MultiPolygon } from 'geojson'
import type { PlannedRoute } from '../api/routePlan'
import type { CityBikeStation } from '../services/citybikes'
import { hazardToLatLng, type Hazard } from '../services/hazards'
import { toDisplayLegs, type LatLng } from '../utils/routeGeometry'

/** GeoJSON is [lon, lat]; the app uses [lat, lon]. */
const toLngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat]

export type RouteFeatureProps = { id: string; selected: boolean }

/** Every route as one feature; the selected one last so it draws on top. */
export function routeFeatures(
  routes: Pick<PlannedRoute, 'id' | 'legs'>[],
  selectedId: string | null,
): FeatureCollection<MultiLineString, RouteFeatureProps> {
  const features = routes
    .map((r): Feature<MultiLineString, RouteFeatureProps> => ({
      type: 'Feature',
      properties: { id: r.id, selected: r.id === selectedId },
      geometry: {
        type: 'MultiLineString',
        coordinates: toDisplayLegs(r.legs).map((leg) => leg.positions.map(toLngLat)),
      },
    }))
    .sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected))
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
