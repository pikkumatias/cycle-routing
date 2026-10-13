import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import polyline from '@mapbox/polyline'
import { DEFAULT_CONFIG } from '../src/routing/config.js'
import { haversineDistance } from '../src/routing/geo.js'
import { buildLayers, type Layers, type OsmLayersFile } from '../src/routing/layers.js'
import { createOtpClient } from '../src/routing/otpClient.js'
import { PlanError, planRoutes } from '../src/routing/planRoutes.js'
import type { LatLon, RoutePlanErrorCode } from '../src/routing/types.js'

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

const STATUS: Record<RoutePlanErrorCode, number> = {
  BAD_REQUEST: 400,
  OUT_OF_AREA: 400,
  TOO_SHORT: 400,
  TOO_LONG: 400,
  NO_ROUTE: 422,
  SERVER_ERROR: 500,
  UPSTREAM_UNAVAILABLE: 503,
  TIMEOUT: 504,
}

const fail = (res: VercelRes, code: RoutePlanErrorCode, error: string) => res.status(STATUS[code]).json({ error, code })

// Parsed once per function instance; the file ships with the deployment (vercel.json includeFiles).
// A failed load is forgotten so the next request retries instead of failing for the instance's lifetime.
let layerData: Promise<{ layers: Layers; bbox: OsmLayersFile['bbox'] }> | null = null
function loadLayers() {
  layerData ??= readFile(join(process.cwd(), 'data/osm-layers.json'), 'utf8')
    .then((text) => {
      const file = JSON.parse(text) as OsmLayersFile
      return { layers: buildLayers(file), bbox: file.bbox }
    })
    .catch((error: unknown) => {
      layerData = null
      throw error
    })
  return layerData
}

function parsePoint(value: unknown): LatLon | null {
  const p = value as { lat?: unknown; lon?: unknown } | null | undefined
  if (typeof p?.lat !== 'number' || typeof p?.lon !== 'number') return null
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null
  return { lat: p.lat, lon: p.lon }
}

/** The request body as an object, or null; Vercel's lazy `req.body` getter throws on malformed JSON. */
function readBody(req: VercelReq): { from?: unknown; to?: unknown } | null {
  try {
    const body = typeof req.body === 'string' ? (JSON.parse(req.body) as unknown) : req.body
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

/**
 * POST { from: {lat, lon}, to: {lat, lon} } → planned routes and the cards to show.
 * Runs the whole routing engine server-side: OTP calls, scoring against the prebuilt OSM
 * layers and card selection. Only routes that appear on a card are returned.
 * Errors are `{ error, code }`; the client shows a localized message per `code`.
 */
export default async function handler(req: VercelReq, res: VercelRes) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method Not Allowed', code: 'BAD_REQUEST' })
    }

    const apiKey = process.env.DIGITRANSIT_API_KEY
    if (!apiKey) return fail(res, 'SERVER_ERROR', 'DIGITRANSIT_API_KEY is not configured on the server.')

    const body = readBody(req)
    const from = parsePoint(body?.from)
    const to = parsePoint(body?.to)
    if (!from || !to) {
      return fail(res, 'BAD_REQUEST', 'Body must be JSON with "from" and "to" as { lat: number, lon: number }.')
    }

    const { layers, bbox } = await loadLayers()
    const [south, west, north, east] = bbox
    const inside = (p: LatLon) => p.lat >= south && p.lat <= north && p.lon >= west && p.lon <= east
    if (!inside(from) || !inside(to)) {
      return fail(res, 'OUT_OF_AREA', 'Routing is only available in the Helsinki region map area.')
    }
    const tripM = haversineDistance([from.lat, from.lon], [to.lat, to.lon])
    if (tripM < MIN_TRIP_M) return fail(res, 'TOO_SHORT', `Origin and destination must be at least ${MIN_TRIP_M} m apart.`)
    if (tripM > MAX_TRIP_M) {
      return fail(res, 'TOO_LONG', `Origin and destination must be at most ${MAX_TRIP_M / 1000} km apart.`)
    }

    const otp = createOtpClient({ apiKey, timeoutMs: DEFAULT_CONFIG.otp.timeoutMs })
    let plan
    try {
      plan = await planRoutes(from, to, { otp, layers })
    } catch (error) {
      if (!(error instanceof PlanError)) throw error
      if (error.code !== 'NO_ROUTE') console.error('[route-plan]', error.code, error.message)
      return fail(res, error.code, error.message)
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
    console.error('[route-plan]', error)
    return fail(res, 'SERVER_ERROR', 'Route planning failed on the server.')
  }
}
