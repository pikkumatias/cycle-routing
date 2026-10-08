// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import polyline from '@mapbox/polyline'
import type { OsmLayersFile } from '../src/routing/layers'

const layerFile: OsmLayersFile = {
  version: 1,
  generatedAt: 'test',
  osmTimestamp: '2026-10-01T00:00:00Z',
  bbox: [60.08, 24.45, 60.42, 25.3],
  signals: [],
  roads: [],
  calmNodes: [],
  gradeSeparated: [],
}

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => JSON.stringify(layerFile)),
}))

const from = { lat: 60.192059, lon: 24.945831 }
const to = { lat: 60.169857, lon: 24.938379 }

function otpResponse(points: Array<[number, number]>, duration: number) {
  return {
    data: {
      planConnection: {
        edges: [
          {
            node: {
              duration,
              legs: [
                {
                  distance: 3000,
                  legGeometry: { points: polyline.encode(points) },
                  steps: [{ distance: 3000, streetName: 'bike path', bogusName: true, area: false, walkingBike: false }],
                },
              ],
            },
          },
        ],
      },
    },
  }
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      res.headers[name] = value
    },
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(data: unknown) {
      res.body = data
      return res
    },
  }
  return res
}

async function call(method: string, body?: unknown) {
  const { default: handler } = await import('./route-plan')
  const res = mockRes()
  await handler({ method, body }, res)
  return res
}

beforeEach(() => {
  vi.stubEnv('DIGITRANSIT_API_KEY', 'test-key')
  vi.unstubAllGlobals()
})

describe('POST /api/route-plan', () => {
  it('rejects other methods', async () => {
    const res = await call('GET')
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('POST')
  })

  it('requires the API key', async () => {
    vi.stubEnv('DIGITRANSIT_API_KEY', '')
    expect((await call('POST', { from, to })).statusCode).toBe(500)
  })

  it.each([
    ['missing points', {}],
    ['non-numeric coordinates', { from: { lat: '60.1', lon: 24.9 }, to }],
    ['non-finite coordinates', { from: { lat: Infinity, lon: 24.9 }, to }],
    ['a point outside the region', { from: { lat: 61.5, lon: 23.8 }, to }],
    ['points closer than 50 m', { from, to: { lat: from.lat + 0.0001, lon: from.lon } }],
  ])('returns 400 for %s', async (_label, body) => {
    expect((await call('POST', body)).statusCode).toBe(400)
  })

  it('returns 502 when no route can be planned', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    const res = await call('POST', { from, to })
    expect(res.statusCode).toBe(502)
    expect(res.body).toMatchObject({ error: 'No route could be planned.' })
  })

  it('returns cards and only the routes shown on them, with encoded legs', async () => {
    const straight: Array<[number, number]> = [[from.lat, from.lon], [to.lat, to.lon]]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(otpResponse(straight, 900)))))
    const res = await call('POST', { from, to })
    expect(res.statusCode).toBe(200)
    const body = res.body as {
      routes: Array<{ id: string; legs: string[]; lights: number; calmBand: string }>
      cards: Array<{ routeId: string; primary: string }>
      meta: { dataVersion: string; calls: number }
    }
    expect(body.cards).toHaveLength(1)
    expect(body.cards[0].primary).toBe('fastest')
    expect(body.routes.map((r) => r.id)).toEqual([body.cards[0].routeId])
    expect(polyline.decode(body.routes[0].legs[0])).toHaveLength(2)
    expect(body.meta.dataVersion).toBe('2026-10-01T00:00:00Z')
    expect(body.meta.calls).toBeGreaterThanOrEqual(3)
  })
})
