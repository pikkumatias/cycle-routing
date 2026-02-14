export type LatLonPair = {
  lat: number
  lon: number
}

export type TriangleFactors = {
  time: number
  safety: number
  slope: number
}

export const ROUTE_PRESETS = {
  fastest: { time: 1.0, safety: 0, slope: 0 },
  scenic: { time: 0.2, safety: 0.7, slope: 0.1 },
  balanced: { time: 0.5, safety: 0.4, slope: 0.1 },
} as const satisfies Record<string, TriangleFactors>

export type RoutePresetKey = keyof typeof ROUTE_PRESETS

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
): Promise<unknown> {
  const res = await fetch('/api/digitransit-route', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, triangle }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Backend route API error: ${res.status} ${res.statusText}\n${text}`,
    )
  }

  return res.json()
}

export async function requestAllRouteVariants(
  from: LatLonPair,
  to: LatLonPair,
): Promise<Record<RoutePresetKey, unknown>> {
  const entries = Object.entries(ROUTE_PRESETS) as [RoutePresetKey, TriangleFactors][]
  const results = await Promise.all(
    entries.map(([, triangle]) => requestBicycleRouteViaBackend(from, to, triangle)),
  )
  return Object.fromEntries(
    entries.map(([key], i) => [key, results[i]]),
  ) as Record<RoutePresetKey, unknown>
}


