const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'
const OVERPASS_FALLBACK_ENDPOINT = 'https://overpass.kumi.systems/api/interpreter'

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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const body = req.body as { query?: string } | undefined
  if (!body?.query) {
    return res.status(400).json({ error: 'Request body must include a "query" field.' })
  }

  const endpoints = [OVERPASS_ENDPOINT, OVERPASS_FALLBACK_ENDPOINT]
  let lastError: string = 'Unknown error'

  for (const endpoint of endpoints) {
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'cycle-routing/1.0 (https://github.com/matiasmerenmies/cycle-routing)',
        },
        body: `data=${encodeURIComponent(body.query)}`,
        signal: AbortSignal.timeout(30000),
      })
      if (!upstream.ok) {
        const text = await upstream.text()
        lastError = `Overpass ${upstream.status}: ${text.slice(0, 200)}`
        continue
      }
      const data = await upstream.json()
      return res.status(200).json(data)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  return res.status(502).json({ error: lastError })
}
