import { haversineDistance } from '../utils/scenicScore'
import type { LatLng } from '../utils/routeGeometry'

export type CityBikeStation = {
  stationId: string
  name: string
  lat: number
  lon: number
  bikesAvailable: number
}

// Progressive search radii (meters) around each endpoint. We widen the radius
// when fewer than two stations are found nearby, so the user gets more than a
// single pickup/dropoff option whenever one exists a little further out.
export const CITYBIKE_RADII_M = [500, 750, 1000]

// Realtime counts go stale quickly, so cache only briefly to absorb rapid
// toggles/tab switches without refetching the full station set every time.
const CACHE_TTL_MS = 60_000
let cache: { at: number; stations: CityBikeStation[] } | null = null

export async function fetchCityBikeStations(): Promise<CityBikeStation[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.stations

  const res = await fetch('/api/citybike-stations')
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`City bike API error: ${res.status} ${res.statusText}\n${body}`)
  }

  const data = (await res.json()) as { stations?: CityBikeStation[] }
  const stations = data.stations ?? []
  cache = { at: Date.now(), stations }
  return stations
}

// Stations within the smallest radius that yields at least two results (capped
// at the largest radius). Widening the search avoids stranding the user with a
// single option near an endpoint when more exist just outside the base radius.
function stationsNearPoint(
  stations: CityBikeStation[],
  point: LatLng,
): CityBikeStation[] {
  let nearby: CityBikeStation[] = []
  for (const radius of CITYBIKE_RADII_M) {
    nearby = stations.filter(
      (s) => haversineDistance([s.lat, s.lon], point) <= radius,
    )
    if (nearby.length >= 2) break
  }
  return nearby
}

// Stations near the origin and/or destination — relevant for picking up a bike
// near the start and dropping it off near the end. Each endpoint is searched
// independently and the two sets are merged, deduped by station id.
export function filterStationsNearEndpoints(
  stations: CityBikeStation[],
  from: LatLng,
  to: LatLng,
): CityBikeStation[] {
  const seen = new Set<string>()
  return [
    ...stationsNearPoint(stations, from),
    ...stationsNearPoint(stations, to),
  ].filter((s) => {
    if (seen.has(s.stationId)) return false
    seen.add(s.stationId)
    return true
  })
}
