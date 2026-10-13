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
  body?: unknown
  query?: Record<string, string | string[] | undefined>
}
interface VercelRes {
  setHeader(name: string, value: string): void
  status(code: number): VercelRes
  json(data: unknown): VercelRes
}

/** Riding speeds the app offers, km/h; 20 is OTP's default and is planned without a speed. */
const SPEEDS_KMH = new Set([15, 20, 25])
const DEFAULT_SPEED_KMH = 20

const MIN_TRIP_M = 50
const MAX_TRIP_M = 40_000
/** Plans of a GET trip are shared by the edge for this long (and served stale for a day while refreshing). */
const EDGE_CACHE = 'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400'

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

const fail = (res: VercelRes, code: RoutePlanErrorCode, error: string) => {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(STATUS[code]).json({ error, code })
}

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

/** "60.1921,24.9458" → a point, or null. */
function parseQueryPoint(value: string | string[] | undefined): LatLon | null {
  const parts = (Array.isArray(value) ? value[0] : value)?.split(',')
  if (parts?.length !== 2 || parts.some((p) => !p.trim())) return null
  return parsePoint({ lat: Number(parts[0]), lon: Number(parts[1]) })
}

type Trip = { from: LatLon | null; to: LatLon | null; speedKmh: number | null }

/** km/h from a query or body value: the default when absent, null when not an offered speed. */
function parseSpeed(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === undefined || raw === null || raw === '') return DEFAULT_SPEED_KMH
  const kmh = Number(raw)
  return SPEEDS_KMH.has(kmh) ? kmh : null
}

/** The trip from a GET query or a POST body; Vercel's lazy `req.body` getter throws on malformed JSON. */
function readTrip(req: VercelReq): Trip {
  if (req.method === 'GET') {
    return { from: parseQueryPoint(req.query?.from), to: parseQueryPoint(req.query?.to), speedKmh: parseSpeed(req.query?.speed) }
  }
  try {
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as {
      from?: unknown
      to?: unknown
      speed?: unknown
    } | null
    return { from: parsePoint(body?.from), to: parsePoint(body?.to), speedKmh: parseSpeed(body?.speed) }
  } catch {
    return { from: null, to: null, speedKmh: null }
  }
}

/**
 * GET ?from=lat,lon&to=lat,lon[&speed=15|20|25 km/h] → planned routes and the cards to show. GET answers are cached
 * at the edge, so the client rounds coordinates to share them; a deployment clears the cache.
 * POST { from: {lat, lon}, to: {lat, lon} } plans the same, uncached (clients from before GET).
 *
 * Runs the whole routing engine server-side: OTP calls, scoring against the prebuilt OSM
 * layers and card selection. Only routes that appear on a card are returned.
 * Errors are `{ error, code }`; the client shows a localized message per `code`.
 */
export default async function handler(req: VercelReq, res: VercelRes) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      return res.status(405).json({ error: 'Method Not Allowed', code: 'BAD_REQUEST' })
    }

    const apiKey = process.env.DIGITRANSIT_API_KEY
    if (!apiKey) return fail(res, 'SERVER_ERROR', 'DIGITRANSIT_API_KEY is not configured on the server.')

    const { from, to, speedKmh } = readTrip(req)
    if (!from || !to) {
      return fail(res, 'BAD_REQUEST', 'Give "from" and "to" as ?from=lat,lon&to=lat,lon, or POST them as { lat, lon }.')
    }
    if (speedKmh === null) return fail(res, 'BAD_REQUEST', `"speed" must be one of ${[...SPEEDS_KMH].join(', ')} km/h.`)

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
      plan = await planRoutes(from, to, { otp, layers }, speedKmh === DEFAULT_SPEED_KMH ? {} : { speedMps: speedKmh / 3.6 })
    } catch (error) {
      if (!(error instanceof PlanError)) throw error
      if (error.code !== 'NO_ROUTE') console.error('[route-plan]', error.code, error.message)
      return fail(res, error.code, error.message)
    }

    const shown = new Set(plan.selection.cards.map((c) => c.routeId))
    // A partial plan (deadline hit) is worth showing but not worth keeping
    res.setHeader('Cache-Control', req.method === 'GET' && !plan.meta.partial ? EDGE_CACHE : 'no-store')
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
          climbM: Math.round(r.profile.climbM),
          stressRuns: r.profile.stressRuns.map(([endM, stress]) => [Math.round(endM), stress]),
        })),
      cards: plan.selection.cards,
      meta: { ...plan.meta, dataVersion: layers.dataVersion },
    })
  } catch (error) {
    console.error('[route-plan]', error)
    return fail(res, 'SERVER_ERROR', 'Route planning failed on the server.')
  }
}
