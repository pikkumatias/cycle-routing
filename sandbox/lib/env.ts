import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { buildLayers, type Layers, type OsmLayersFile } from '../../src/routing/layers'
import { DIGITRANSIT_ROUTING_ENDPOINT, buildPlanQuery, parsePlanResponse, type OtpCall } from '../../src/routing/otpClient'
import type { LatLng } from '../../src/routing/types'

export const OUT_DIR = 'sandbox/out'
export const LABELS_DIR = 'sandbox/labels'
const OTP_CACHE_DIR = 'sandbox/.cache/otp'
/** Minimum gap between live OTP calls (cached calls are free). */
const OTP_MIN_GAP_MS = 250

export type OdPair = {
  id: string
  name: string
  from: LatLng
  to: LatLng
  straightKm: number
  bucket: 'short' | 'medium' | 'long'
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true })
  await writeFile(file, JSON.stringify(data, null, 1) + '\n')
}

/** Public OD corpus plus the gitignored private one, if present. */
export async function loadOdPairs(): Promise<OdPair[]> {
  const pub = await readJson<OdPair[]>('sandbox/od-pairs.json')
  const priv = await readJson<OdPair[]>('sandbox/od-pairs.private.json').catch(() => [])
  return [...pub, ...priv]
}

let layers: Layers | null = null
export async function loadLayers(): Promise<Layers> {
  layers ??= buildLayers(await readJson<OsmLayersFile>('data/osm-layers.json'))
  return layers
}

export type CallStats = { live: number; cached: number; failed: number }

/**
 * OTP client that stores every raw response under sandbox/.cache/otp, keyed by the query
 * text, so a full corpus run costs API calls once and re-runs are free and deterministic.
 */
export function cachedOtp(stats: CallStats): OtpCall {
  const apiKey = process.env.DIGITRANSIT_API_KEY
  if (!apiKey) throw new Error('DIGITRANSIT_API_KEY missing (set it in .env.local)')
  let lastCall = 0
  return async (req) => {
    const query = buildPlanQuery(req)
    const file = `${OTP_CACHE_DIR}/${createHash('sha1').update(query).digest('hex')}.json`
    let json: unknown
    try {
      json = await readJson(file)
      stats.cached++
    } catch {
      const wait = lastCall + OTP_MIN_GAP_MS - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      lastCall = Date.now()
      try {
        const res = await fetch(DIGITRANSIT_ROUTING_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'digitransit-subscription-key': apiKey },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) throw new Error(`OTP HTTP ${res.status}`)
        json = await res.json()
      } catch (err) {
        stats.failed++
        throw err
      }
      stats.live++
      await writeJson(file, json)
    }
    return parsePlanResponse(json)
  }
}
