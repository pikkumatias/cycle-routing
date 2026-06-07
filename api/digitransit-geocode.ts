const GEOCODING_ENDPOINT =
  'https://api.digitransit.fi/geocoding/v1/autocomplete'

interface VercelReq {
  method?: string
  query: Record<string, string | string[] | undefined>
}
interface VercelRes {
  setHeader(name: string, value: string): void
  status(code: number): VercelRes
  json(data: unknown): VercelRes
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
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

    const text = firstValue(req.query.text)
    if (!text?.trim()) {
      return res.status(400).json({ error: '"text" query parameter is required.' })
    }

    const url = new URL(GEOCODING_ENDPOINT)
    url.searchParams.set('text', text)
    url.searchParams.set('size', firstValue(req.query.size) ?? '5')
    url.searchParams.set('lang', firstValue(req.query.lang) ?? 'en')
    const focusLat = firstValue(req.query['focus.point.lat'])
    if (focusLat) {
      url.searchParams.set('focus.point.lat', focusLat)
    }
    const focusLon = firstValue(req.query['focus.point.lon'])
    if (focusLon) {
      url.searchParams.set('focus.point.lon', focusLon)
    }

    const upstream = await fetch(url.toString(), {
      headers: {
        'digitransit-subscription-key': apiKey,
      },
    })

    if (!upstream.ok) {
      const body = await upstream.text()
      return res
        .status(upstream.status)
        .json({ error: `Geocoding API error: ${upstream.status} ${upstream.statusText}`, details: body })
    }

    const data = await upstream.json()
    // Autocomplete results are stable for a given query; let the edge/browser
    // serve repeats and revalidate in the background.
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=86400')
    return res.status(200).json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
