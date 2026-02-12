import { fetchBicycleRoute, parseLatLon, type LatLonPair } from '../src/api/digitransit'

type RequestBody =
  | {
      from: string
      to: string
    }
  | {
      from: LatLonPair
      to: LatLonPair
    }

export default async function handler(req: any, res: any) {
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

  let body: RequestBody
  try {
    body = req.body as RequestBody
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  if (!body || !body.from || !body.to) {
    return res
      .status(400)
      .json({ error: 'Request body must include "from" and "to" fields.' })
  }

  try {
    const from =
      typeof (body as any).from === 'string'
        ? parseLatLon((body as any).from)
        : (body as any).from
    const to =
      typeof (body as any).to === 'string'
        ? parseLatLon((body as any).to)
        : (body as any).to

    const data = await fetchBicycleRoute(from, to, apiKey)
    return res.status(200).json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}

