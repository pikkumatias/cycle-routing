const DIGITRANSIT_ENDPOINT =
  'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1'

type LatLonPair = { lat: number; lon: number }

type TriangleFactors = {
  time: number
  safety: number
  slope: number
}

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
  triangle?: TriangleFactors,
  numItineraries: number = 1,
): Promise<unknown> {
  const t = triangle ?? { time: 1, safety: 0, slope: 0 }
  const query = `
    query PlanBicycleRoute(
      $fromLat: Float!
      $fromLon: Float!
      $toLat: Float!
      $toLon: Float!
      $timeFactor: Float!
      $safetyFactor: Float!
      $slopeFactor: Float!
      $numItineraries: Int!
    ) {
      plan(
        from: { lat: $fromLat, lon: $fromLon }
        to: { lat: $toLat, lon: $toLon }
        numItineraries: $numItineraries
        transportModes: [{ mode: BICYCLE }]
        optimize: TRIANGLE
        triangle: {
          safetyFactor: $safetyFactor
          slopeFactor: $slopeFactor
          timeFactor: $timeFactor
        }
      ) {
        itineraries { duration walkDistance legs { mode startTime endTime distance from { name } to { name } route { shortName longName } legGeometry { length points } } }
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
      timeFactor: t.time,
      safetyFactor: t.safety,
      slopeFactor: t.slope,
      numItineraries,
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
    throw new Error(`Routing API error: ${res.status} ${res.statusText}\n${text}`)
  }
  return res.json()
}

type BatchRequestBody =
  | { from: string; to: string; presets: TriangleFactors[]; numItineraries?: number }
  | { from: LatLonPair; to: LatLonPair; presets: TriangleFactors[]; numItineraries?: number }

interface VercelReq {
  method?: string
  body: unknown
}
interface VercelRes {
  setHeader(name: string, value: string): void
  status(code: number): VercelRes
  json(data: unknown): VercelRes
}

export default async function handler(req: VercelReq, res: VercelRes) {
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

    const body = req.body as BatchRequestBody | undefined
    if (!body || body.from == null || body.to == null) {
      return res
        .status(400)
        .json({ error: 'Request body must include "from", "to", and "presets" fields.' })
    }

    const presets = body.presets
    if (!Array.isArray(presets) || presets.length === 0) {
      return res.status(400).json({ error: '"presets" must be a non-empty array.' })
    }
    if (presets.length > 10) {
      return res.status(400).json({ error: '"presets" must have at most 10 entries.' })
    }

    const from = typeof body.from === 'string' ? parseLatLon(body.from) : body.from
    const to = typeof body.to === 'string' ? parseLatLon(body.to) : body.to
    const numItineraries = body.numItineraries ?? 1

    const settled = await Promise.allSettled(
      presets.map((t) => fetchBicycleRoute(from, to, apiKey, t, numItineraries)),
    )

    const results = settled.map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : { error: r.reason instanceof Error ? r.reason.message : 'Unknown error' },
    )

    return res.status(200).json({ results })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
