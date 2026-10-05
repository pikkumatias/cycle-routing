// Types the frozen legacy modules referenced from src/api/digitransit.ts and
// src/components/RouteCards.tsx at commit c197bee.
import type { LatLng } from './routeGeometry'
import type { OsmPoi } from './overpass'

export type RouteCategory = 'fastest' | 'scenic' | 'calm' | 'fewestLights'

export type CandidateRoute = {
  response: unknown
  durationSec: number
  distanceKm: number
  polyline: LatLng[]
}

export type ScoredRoute = {
  response: unknown
  durationSec: number
  distanceKm: number
  scenicScore: number
  infraScore: number
  calmScore: number
  scenicPoiCount: number
  infraSegmentCount: number
  lightScore: number
  lightCount: number
  nearbyPois: OsmPoi[]
}
