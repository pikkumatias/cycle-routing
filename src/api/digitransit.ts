export type LatLonPair = {
  lat: number
  lon: number
}

export type TriangleFactors = {
  time: number
  safety: number
  slope: number
}

export type RouteCategory = 'fastest' | 'scenic' | 'calm'

/** Five spread presets to generate diverse candidate routes (factors must sum to 1.0). */
const CANDIDATE_PRESETS: TriangleFactors[] = [
  { time: 1.0,  safety: 0.0,  slope: 0.0  },  // fastest possible
  { time: 0.0,  safety: 1.0,  slope: 0.0  },  // best cycling infra
  { time: 0.0,  safety: 0.0,  slope: 1.0  },  // flattest route
  { time: 0.33, safety: 0.34, slope: 0.33 },  // balanced
  { time: 0.1,  safety: 0.6,  slope: 0.3  },  // safe + flat hybrid
]

export function parseLatLon(input: string): LatLonPair {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Value is required')
  }

  const parts = trimmed.includes(',')
    ? trimmed.split(',')
    : trimmed.split(/\s+/)

  if (parts.length !== 2) {
    throw new Error(
      'Use "lat,lon" or "lat lon", e.g. 60.192059,24.945831',
    )
  }

  const lat = Number(parts[0])
  const lon = Number(parts[1])

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    throw new Error('Latitude and longitude must be numbers')
  }

  return { lat, lon }
}

const DIGITRANSIT_ENDPOINT =
  'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1'

export async function fetchBicycleRoute(
  from: LatLonPair,
  to: LatLonPair,
  apiKey: string | undefined,
): Promise<unknown> {
  if (!apiKey) {
    throw new Error(
      'VITE_DIGITRANSIT_API_KEY is not set. Add it to your .env.local file.',
    )
  }

  const query = `
    query PlanBicycleRoute(
      $fromLat: Float!
      $fromLon: Float!
      $toLat: Float!
      $toLon: Float!
    ) {
      plan(
        from: { lat: $fromLat, lon: $fromLon }
        to: { lat: $toLat, lon: $toLon }
        numItineraries: 1
        transportModes: [{ mode: BICYCLE }]
      ) {
        itineraries {
          duration
          walkDistance
          legs {
            mode
            startTime
            endTime
            distance
            from { name }
            to { name }
            route {
              shortName
              longName
            }
            legGeometry {
              length
              points
            }
          }
        }
      }
    }
  `

  const body = JSON.stringify({
    query,
    variables: {
      fromLat: from.lat,
      fromLon: from.lon,
      toLat: to.lat,
      toLon: to.lon,
    },
  })

  const res = await fetch(DIGITRANSIT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'digitransit-subscription-key': apiKey,
    },
    body,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Routing API error: ${res.status} ${res.statusText}\n${text}`,
    )
  }

  const data = await res.json()

  return data
}

export async function requestBicycleRouteViaBackend(
  from: LatLonPair,
  to: LatLonPair,
  triangle?: TriangleFactors,
  numItineraries?: number,
): Promise<unknown> {
  const res = await fetch('/api/digitransit-route', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, triangle, numItineraries }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Backend route API error: ${res.status} ${res.statusText}\n${text}`,
    )
  }

  return res.json()
}

export type GeocodingResult = {
  label: string
  lat: number
  lon: number
}

export async function fetchGeocodingAutocomplete(
  text: string,
  signal?: AbortSignal,
): Promise<GeocodingResult[]> {
  if (!text.trim()) return []

  const url = new URL('/api/digitransit-geocode', window.location.origin)
  url.searchParams.set('text', text)
  url.searchParams.set('size', '5')
  url.searchParams.set('lang', 'en')
  url.searchParams.set('focus.point.lat', '60.17')
  url.searchParams.set('focus.point.lon', '24.94')

  const res = await fetch(url.toString(), { signal })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `Geocoding API error: ${res.status} ${res.statusText}\n${body}`,
    )
  }

  const data = await res.json()
  const features: any[] = data?.features ?? []

  return features.map((f) => ({
    label: f.properties?.label ?? '',
    lon: f.geometry?.coordinates?.[0] ?? 0,
    lat: f.geometry?.coordinates?.[1] ?? 0,
  }))
}

import { decodePolyline, type LatLng } from '../utils/routeGeometry'

export type CandidateRoute = {
  /** Wrapped as single-itinerary response for getRouteLegsFromPlanResponse compatibility */
  response: unknown
  durationSec: number
  distanceKm: number
  polyline: LatLng[]
}

/**
 * Fetch a diverse pool of candidate routes by making 2 OTP calls with
 * maximally spread triangle factors, each requesting multiple itineraries.
 */
export async function fetchCandidateRoutes(
  from: LatLonPair,
  to: LatLonPair,
): Promise<CandidateRoute[]> {
  const responses = await Promise.all(
    CANDIDATE_PRESETS.map((triangle) =>
      requestBicycleRouteViaBackend(from, to, triangle, 2),
    ),
  )

  const candidates: CandidateRoute[] = []

  for (const raw of responses) {
    const itineraries = (raw as any)?.data?.plan?.itineraries ?? []
    for (const it of itineraries) {
      const durationSec: number = it?.duration ?? 0
      const legs: any[] = it?.legs ?? []
      const distanceKm =
        legs.reduce((sum: number, leg: any) => sum + (leg?.distance ?? 0), 0) / 1000
      const polyline = legs.flatMap((leg: any) =>
        decodePolyline(leg?.legGeometry?.points),
      )

      // Wrap as single-itinerary response so getRouteLegsFromPlanResponse works
      const response = { data: { plan: { itineraries: [it] } } }

      candidates.push({ response, durationSec, distanceKm, polyline })
    }
  }

  return candidates
}
