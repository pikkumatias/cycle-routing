import { fetchUpstream, firstValue, numberParam, type VercelReq, type VercelRes } from './_lib/upstream.js'

const GEOCODING_ENDPOINT = 'https://api.digitransit.fi/geocoding/v1/autocomplete'

/**
 * [south, west, north, east] of the routing data (`data/meta.json`); a test keeps them equal.
 * Suggestions outside it could never be routed to, so the geocoder doesn't offer them.
 */
export const REGION_BBOX = [60.113, 24.588, 60.353, 25.242] as const

const MAX_TEXT_LENGTH = 200
const MAX_SIZE = 10
const LANGS = new Set(['fi', 'sv', 'en'])

/** GET ?text=…&size=&lang=&focus.point.lat=&focus.point.lon= → Digitransit autocomplete GeoJSON. */
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

    const text = firstValue(req.query.text)?.trim()
    if (!text || text.length > MAX_TEXT_LENGTH) {
      return res
        .status(400)
        .json({ error: `"text" is required and at most ${MAX_TEXT_LENGTH} characters.`, code: 'BAD_REQUEST' })
    }
    const lang = firstValue(req.query.lang)
    const size = Math.min(MAX_SIZE, Math.round(numberParam(req.query.size, 1, Infinity) ?? 5))

    const url = new URL(GEOCODING_ENDPOINT)
    url.searchParams.set('text', text)
    url.searchParams.set('size', String(size))
    url.searchParams.set('lang', lang && LANGS.has(lang) ? lang : 'en')
    const focusLat = numberParam(req.query['focus.point.lat'], -90, 90)
    const focusLon = numberParam(req.query['focus.point.lon'], -180, 180)
    if (focusLat !== undefined && focusLon !== undefined) {
      url.searchParams.set('focus.point.lat', String(focusLat))
      url.searchParams.set('focus.point.lon', String(focusLon))
    }
    const [south, west, north, east] = REGION_BBOX
    url.searchParams.set('boundary.rect.min_lat', String(south))
    url.searchParams.set('boundary.rect.min_lon', String(west))
    url.searchParams.set('boundary.rect.max_lat', String(north))
    url.searchParams.set('boundary.rect.max_lon', String(east))

    const result = await fetchUpstream('Geocoding', url.toString(), {
      headers: { 'digitransit-subscription-key': apiKey },
    })
    if ('status' in result) return res.status(result.status).json(result.body)

    // Autocomplete results are stable for a given query; let the edge/browser
    // serve repeats and revalidate in the background.
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400')
    return res.status(200).json(result.data)
  } catch (error) {
    console.error('[geocode]', error)
    return res.status(500).json({ error: 'Geocoding failed on the server.', code: 'SERVER_ERROR' })
  }
}
