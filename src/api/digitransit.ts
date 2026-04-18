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

type OtpLeg = {
  distance?: number
  legGeometry?: { points?: string }
}

type OtpItinerary = {
  duration?: number
  legs?: OtpLeg[]
}

export type OtpPlanResponse = {
  data?: { plan?: { itineraries?: OtpItinerary[] } }
}

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
  type GeoJsonFeature = {
    properties?: { label?: string }
    geometry?: { coordinates?: [number, number] }
  }
  const features: GeoJsonFeature[] = (data as { features?: GeoJsonFeature[] })?.features ?? []

  return features.map((f) => ({
    label: f.properties?.label ?? '',
    lon: f.geometry?.coordinates?.[0] ?? 0,
    lat: f.geometry?.coordinates?.[1] ?? 0,
  }))
}

export async function fetchReverseGeocode(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<GeocodingResult | null> {
  const url = new URL('/api/digitransit-reverse-geocode', window.location.origin)
  url.searchParams.set('point.lat', String(lat))
  url.searchParams.set('point.lon', String(lon))

  const res = await fetch(url.toString(), { signal })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Reverse geocoding API error: ${res.status} ${res.statusText}\n${body}`)
  }

  const data = await res.json()
  type GeoJsonFeature = {
    properties?: { label?: string }
    geometry?: { coordinates?: [number, number] }
  }
  const features: GeoJsonFeature[] = (data as { features?: GeoJsonFeature[] })?.features ?? []
  const first = features[0]
  if (!first) return null

  return {
    label: first.properties?.label ?? '',
    lon: first.geometry?.coordinates?.[0] ?? lon,
    lat: first.geometry?.coordinates?.[1] ?? lat,
  }
}

import { decodePolyline, type LatLng } from '../utils/routeGeometry'

export type CandidateRoute = {
  /** Wrapped as single-itinerary response for getRouteLegsFromPlanResponse compatibility */
  response: unknown
  durationSec: number
  distanceKm: number
  polyline: LatLng[]
}

async function requestBatchRoutesViaBackend(
  from: LatLonPair,
  to: LatLonPair,
  presets: TriangleFactors[],
  numItineraries: number,
): Promise<Array<unknown | null>> {
  const res = await fetch('/api/digitransit-route-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, presets, numItineraries }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Backend batch route API error: ${res.status} ${res.statusText}\n${text}`)
  }

  const data = (await res.json()) as { results: Array<unknown> }
  return data.results.map((r) =>
    r != null && typeof r === 'object' && 'error' in r ? null : r,
  )
}

const MAX_ROUTE_CACHE = 20
const routeCache = new Map<string, CandidateRoute[]>()

function routeCacheKey(from: LatLonPair, to: LatLonPair): string {
  const q = (n: number) => Math.round(n / 0.001) * 0.001
  return `${q(from.lat)},${q(from.lon)}->${q(to.lat)},${q(to.lon)}`
}

/**
 * Fetch a diverse pool of candidate routes by sending all OTP presets in a
 * single batch request, then caching results keyed by quantized coordinates.
 */
export async function fetchCandidateRoutes(
  from: LatLonPair,
  to: LatLonPair,
): Promise<CandidateRoute[]> {
  const cacheKey = routeCacheKey(from, to)
  const cached = routeCache.get(cacheKey)
  if (cached) return cached

  const responses = await requestBatchRoutesViaBackend(from, to, CANDIDATE_PRESETS, 2)

  const candidates: CandidateRoute[] = []

  for (const raw of responses) {
    if (raw == null) continue
    const itineraries = (raw as OtpPlanResponse)?.data?.plan?.itineraries ?? []
    for (const it of itineraries) {
      const durationSec: number = it?.duration ?? 0
      const legs: OtpLeg[] = it?.legs ?? []
      const distanceKm =
        legs.reduce((sum: number, leg) => sum + (leg?.distance ?? 0), 0) / 1000
      const polyline = legs.flatMap((leg) =>
        decodePolyline(leg?.legGeometry?.points ?? ''),
      )

      // Wrap as single-itinerary response so getRouteLegsFromPlanResponse works
      const response = { data: { plan: { itineraries: [it] } } }

      candidates.push({ response, durationSec, distanceKm, polyline })
    }
  }

  if (routeCache.size >= MAX_ROUTE_CACHE) {
    routeCache.delete(routeCache.keys().next().value!)
  }
  routeCache.set(cacheKey, candidates)

  return candidates
}
