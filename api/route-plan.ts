import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import polyline from '@mapbox/polyline'
import { DEFAULT_CONFIG } from '../src/routing/config.js'
import { haversineDistance } from '../src/routing/geo.js'
import { buildLayers, type Layers, type OsmLayersFile } from '../src/routing/layers.js'
import { createOtpClient } from '../src/routing/otpClient.js'
import { planRoutes } from '../src/routing/planRoutes.js'
import type { LatLon } from '../src/routing/types.js'

interface VercelReq {
  method?: string
  body: unknown
}
interface VercelRes {
  setHeader(name: string, value: string): void
  status(code: number): VercelRes
  json(data: unknown): VercelRes
}

const MIN_TRIP_M = 50
const MAX_TRIP_M = 40_000

// Parsed once per function instance; the file ships with the deployment (vercel.json includeFiles).
let layerData: Promise<{ layers: Layers; bbox: OsmLayersFile['bbox'] }> | null = null
function loadLayers() {
  layerData ??= readFile(join(process.cwd(), 'data/osm-layers.json'), 'utf8').then((text) => {
    const file = JSON.parse(text) as OsmLayersFile
    return { layers: buildLayers(file), bbox: file.bbox }
  })
  return layerData
}

function parsePoint(value: unknown): LatLon | null {
  const p = value as { lat?: unknown; lon?: unknown } | null | undefined
  if (typeof p?.lat !== 'number' || typeof p?.lon !== 'number') return null
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null
  return { lat: p.lat, lon: p.lon }
}

/**
 * POST { from: {lat, lon}, to: {lat, lon} } → planned routes and the cards to show.
 * Runs the whole routing engine server-side: OTP calls, scoring against the prebuilt OSM
 * layers and card selection. Only routes that appear on a card are returned.
 */
export default async function handler(req: VercelReq, res: VercelRes) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    const apiKey = process.env.DIGITRANSIT_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'DIGITRANSIT_API_KEY is not configured on the server.' })
    }

    const body = req.body as { from?: unknown; to?: unknown } | undefined
    const from = parsePoint(body?.from)
    const to = parsePoint(body?.to)
    if (!from || !to) {
      return res.status(400).json({ error: 'Body must include "from" and "to" as { lat: number, lon: number }.' })
    }

    const { layers, bbox } = await loadLayers()
    const [south, west, north, east] = bbox
    const inside = (p: LatLon) => p.lat >= south && p.lat <= north && p.lon >= west && p.lon <= east
    if (!inside(from) || !inside(to)) {
      return res.status(400).json({ error: 'Routing is only available within Helsinki, Espoo, Vantaa and Kauniainen.' })
    }
    const tripM = haversineDistance([from.lat, from.lon], [to.lat, to.lon])
    if (tripM < MIN_TRIP_M || tripM > MAX_TRIP_M) {
      return res.status(400).json({ error: `Origin and destination must be ${MIN_TRIP_M} m–${MAX_TRIP_M / 1000} km apart.` })
    }

    const otp = createOtpClient({ apiKey, timeoutMs: DEFAULT_CONFIG.otp.timeoutMs })
    let plan
    try {
      plan = await planRoutes(from, to, { otp, layers })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return res.status(502).json({ error: 'No route could be planned.', details: message })
    }

    const shown = new Set(plan.selection.cards.map((c) => c.routeId))
    return res.status(200).json({
      routes: plan.routes
        .filter((r) => shown.has(r.id))
        .map((r) => ({
          id: r.id,
          durationSec: r.durationSec,
          distanceM: Math.round(r.distanceM),
          legs: r.legs.map((leg) => polyline.encode(leg)),
          signalStops: r.profile.signalStops.map((s) => ({ at: s.at, rule: s.rule })),
          lights: r.profile.lights,
          calmIndex: r.profile.calmIndex,
          calmBand: r.profile.calmBand,
          stressM: Object.fromEntries(Object.entries(r.profile.stressM).map(([k, v]) => [k, Math.round(v)])),
          majorCrossings: r.profile.majorCrossings,
        })),
      cards: plan.selection.cards,
      meta: { ...plan.meta, dataVersion: layers.dataVersion },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return res.status(500).json({ error: message })
  }
}
