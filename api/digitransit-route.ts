const DIGITRANSIT_ENDPOINT =
  'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1'

type LatLonPair = { lat: number; lon: number }

function parseLatLon(input: string): LatLonPair {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Value is required')
  const parts = trimmed.includes(',') ? trimmed.split(',') : trimmed.split(/\s+/)
  if (parts.length !== 2) {
    throw new Error('Use "lat,lon" or "lat lon", e.g. 60.192059,24.945831')
  }
  const lat = Number(parts[0])
  const lon = Number(parts[1])
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    throw new Error('Latitude and longitude must be numbers')
  }
  return { lat, lon }
}

async function fetchBicycleRoute(
  from: LatLonPair,
  to: LatLonPair,
  apiKey: string,
): Promise<unknown> {
  const query = `
    query PlanBicycleRoute($fromLat: Float!, $fromLon: Float!, $toLat: Float!, $toLon: Float!) {
      plan(
        from: { lat: $fromLat, lon: $fromLon }
        to: { lat: $toLat, lon: $toLon }
        numItineraries: 1
        transportModes: [{ mode: BICYCLE }]
      ) {
        itineraries { duration walkDistance legs { mode startTime endTime distance from { name } to { name } route { shortName longName } } }
      }
    }
  `
  const body = JSON.stringify({
    query,
    variables: { fromLat: from.lat, fromLon: from.lon, toLat: to.lat, toLon: to.lon },
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
    throw new Error(`Routing API error: ${res.status} ${res.statusText}\n${text}`)
  }
  return res.json()
}

type RequestBody =
  | { from: string; to: string }
  | { from: LatLonPair; to: LatLonPair }

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    const apiKey = process.env.DIGITRANSIT_API_KEY
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: 'DIGITRANSIT_API_KEY is not configured on the server.' })
    }

    const body = req.body as RequestBody | undefined
    if (!body || body.from == null || body.to == null) {
      return res
        .status(400)
        .json({ error: 'Request body must include "from" and "to" fields.' })
    }

    const from =
      typeof body.from === 'string' ? parseLatLon(body.from) : body.from
    const to = typeof body.to === 'string' ? parseLatLon(body.to) : body.to

    const data = await fetchBicycleRoute(from, to, apiKey)
    return res.status(200).json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
