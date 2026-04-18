const REVERSE_GEOCODING_ENDPOINT =
  'https://api.digitransit.fi/geocoding/v1/reverse'

interface VercelReq {
  method?: string
  query: Record<string, string | string[] | undefined>
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

    const lat = req.query['point.lat'] as string | undefined
    const lon = req.query['point.lon'] as string | undefined

    if (!lat?.trim() || !lon?.trim()) {
      return res
        .status(400)
        .json({ error: '"point.lat" and "point.lon" query parameters are required.' })
    }

    const url = new URL(REVERSE_GEOCODING_ENDPOINT)
    url.searchParams.set('point.lat', lat)
    url.searchParams.set('point.lon', lon)
    url.searchParams.set('size', '1')
    url.searchParams.set('lang', 'en')

    const upstream = await fetch(url.toString(), {
      headers: {
        'digitransit-subscription-key': apiKey,
      },
    })

    if (!upstream.ok) {
      const body = await upstream.text()
      return res
        .status(upstream.status)
        .json({ error: `Reverse geocoding API error: ${upstream.status} ${upstream.statusText}`, details: body })
    }

    const data = await upstream.json()
    return res.status(200).json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
