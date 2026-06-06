const DIGITRANSIT_ENDPOINT =
  'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1'

const STATIONS_QUERY = `
  query CityBikeStations {
    bikeRentalStations {
      stationId
      name
      bikesAvailable
      lat
      lon
      state
    }
  }
`

type RawStation = {
  stationId?: string
  name?: string
  bikesAvailable?: number
  lat?: number
  lon?: number
  state?: string
}

interface VercelReq {
  method?: string
}
interface VercelRes {
  setHeader(name: string, value: string): void
  status(code: number): VercelRes
  json(data: unknown): VercelRes
}

export default async function handler(req: VercelReq, res: VercelRes) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    const apiKey = process.env.DIGITRANSIT_API_KEY
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: 'DIGITRANSIT_API_KEY is not configured on the server.' })
    }

    const upstream = await fetch(DIGITRANSIT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'digitransit-subscription-key': apiKey,
      },
      body: JSON.stringify({ query: STATIONS_QUERY }),
    })

    if (!upstream.ok) {
      const body = await upstream.text()
      return res.status(upstream.status).json({
        error: `City bike API error: ${upstream.status} ${upstream.statusText}`,
        details: body,
      })
    }

    const data = (await upstream.json()) as {
      data?: { bikeRentalStations?: RawStation[] }
    }
    const stations = (data.data?.bikeRentalStations ?? [])
      .filter(
        (s): s is Required<RawStation> =>
          s.state === 'Station on' &&
          typeof s.lat === 'number' &&
          typeof s.lon === 'number',
      )
      .map((s) => ({
        stationId: String(s.stationId),
        name: s.name ?? '',
        lat: s.lat,
        lon: s.lon,
        bikesAvailable: s.bikesAvailable ?? 0,
      }))

    // Realtime counts: let the edge serve repeats briefly while revalidating.
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
    return res.status(200).json({ stations })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
