const GEOCODING_ENDPOINT =
  'https://api.digitransit.fi/geocoding/v1/autocomplete'

export default async function handler(req: any, res: any) {
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

    const text = req.query.text as string | undefined
    if (!text?.trim()) {
      return res.status(400).json({ error: '"text" query parameter is required.' })
    }

    const url = new URL(GEOCODING_ENDPOINT)
    url.searchParams.set('text', text)
    url.searchParams.set('size', req.query.size ?? '5')
    url.searchParams.set('lang', req.query.lang ?? 'en')
    if (req.query['focus.point.lat']) {
      url.searchParams.set('focus.point.lat', req.query['focus.point.lat'])
    }
    if (req.query['focus.point.lon']) {
      url.searchParams.set('focus.point.lon', req.query['focus.point.lon'])
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
    return res.status(200).json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
