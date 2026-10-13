import { fetchUpstream, type VercelReq, type VercelRes } from './_lib/upstream.js'

const DIGITRANSIT_ENDPOINT = 'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1'

const STATIONS_QUERY = `
  query CityBikeStations {
    vehicleRentalStations {
      stationId
      name
      lat
      lon
      operative
      availableVehicles { total }
    }
  }
`

type RawStation = {
  stationId?: string
  name?: string
  lat?: number | null
  lon?: number | null
  operative?: boolean | null
  availableVehicles?: { total?: number | null } | null
}

/** GET → operative city bike stations with live bike counts. */
export default async function handler(req: VercelReq, res: VercelRes) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method Not Allowed', code: 'BAD_REQUEST' })
    }

    const apiKey = process.env.DIGITRANSIT_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'DIGITRANSIT_API_KEY is not configured on the server.', code: 'SERVER_ERROR' })
    }

    const result = await fetchUpstream('City bike service', DIGITRANSIT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'digitransit-subscription-key': apiKey },
      body: JSON.stringify({ query: STATIONS_QUERY }),
    })
    if ('status' in result) return res.status(result.status).json(result.body)

    const data = result.data as { data?: { vehicleRentalStations?: RawStation[] | null } }
    const raw = data.data?.vehicleRentalStations
    if (!raw) {
      console.error('[citybike-stations] no stations in response', JSON.stringify(result.data).slice(0, 500))
      return res.status(502).json({ error: 'City bike service is unavailable.', code: 'UPSTREAM_UNAVAILABLE' })
    }

    const stations = raw
      // `operative` is null when the feed doesn't say; only an explicit false hides a station.
      .filter((s) => s.operative !== false && typeof s.lat === 'number' && typeof s.lon === 'number')
      .map((s) => ({
        stationId: String(s.stationId),
        name: s.name ?? '',
        lat: s.lat as number,
        lon: s.lon as number,
        bikesAvailable: s.availableVehicles?.total ?? 0,
      }))

    // Realtime counts: let the edge serve repeats briefly while revalidating.
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60')
    return res.status(200).json({ stations })
  } catch (error) {
    console.error('[citybike-stations]', error)
    return res.status(500).json({ error: 'City bike stations failed on the server.', code: 'SERVER_ERROR' })
  }
}
