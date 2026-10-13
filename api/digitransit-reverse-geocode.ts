import { fetchUpstream, firstValue, numberParam, type VercelReq, type VercelRes } from './_lib/upstream.js'

const REVERSE_GEOCODING_ENDPOINT = 'https://api.digitransit.fi/geocoding/v1/reverse'

/** GET ?point.lat=&point.lon=&lang= → the nearest address as Digitransit GeoJSON (one feature). */
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

    const lat = numberParam(req.query['point.lat'], -90, 90)
    const lon = numberParam(req.query['point.lon'], -180, 180)
    if (lat === undefined || lon === undefined) {
      return res
        .status(400)
        .json({ error: '"point.lat" and "point.lon" must be valid coordinates.', code: 'BAD_REQUEST' })
    }
    const lang = firstValue(req.query.lang)

    const url = new URL(REVERSE_GEOCODING_ENDPOINT)
    url.searchParams.set('point.lat', String(lat))
    url.searchParams.set('point.lon', String(lon))
    url.searchParams.set('size', '1')
    url.searchParams.set('lang', lang === 'fi' || lang === 'sv' ? lang : 'en')

    const result = await fetchUpstream('Reverse geocoding', url.toString(), {
      headers: { 'digitransit-subscription-key': apiKey },
    })
    if ('status' in result) return res.status(result.status).json(result.body)

    // A coordinate's nearest address rarely changes; cache aggressively at the edge.
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    return res.status(200).json(result.data)
  } catch (error) {
    console.error('[reverse-geocode]', error)
    return res.status(500).json({ error: 'Reverse geocoding failed on the server.', code: 'SERVER_ERROR' })
  }
}
