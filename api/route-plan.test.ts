// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import polyline from '@mapbox/polyline'
import type { OsmLayersFile } from '../src/routing/layers'
import { mockRes } from './_lib/testing'

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

async function call(method: string, body?: unknown) {
  return callWith({ method, body })
}

async function callWith(req: { method: string; body?: unknown; query?: Record<string, string | string[] | undefined> }) {
  const { default: handler } = await import('./route-plan')
  const res = mockRes()
  await handler(req, res)
  return res
}

const noRouteResponse = {
  data: { planConnection: { edges: [], routingErrors: [{ code: 'NO_DIRECT_MODE_CONNECTION', description: 'none' }] } },
}

beforeEach(() => {
  vi.stubEnv('DIGITRANSIT_API_KEY', 'test-key')
  vi.unstubAllGlobals()
})

describe('/api/route-plan', () => {
  it('rejects other methods', async () => {
    const res = await call('PUT')
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('GET, POST')
  })

  it('plans a GET trip from query coordinates and lets the edge cache the answer', async () => {
    const straight: Array<[number, number]> = [[from.lat, from.lon], [to.lat, to.lon]]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(otpResponse(straight, 900)))))
    const res = await callWith({ method: 'GET', query: { from: `${from.lat},${from.lon}`, to: `${to.lat},${to.lon}` } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toMatch(/s-maxage=\d+/)
  })

  it.each([
    ['missing to', { from: '60.19,24.94' }],
    ['one number', { from: '60.19', to: '60.17,24.93' }],
    ['text', { from: 'home', to: '60.17,24.93' }],
  ])('returns 400 for a GET with %s', async (_label, query) => {
    const res = await callWith({ method: 'GET', query })
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ code: 'BAD_REQUEST' })
  })

  it.each([
    ['15', 15 / 3.6],
    ['25', 25 / 3.6],
  ])('asks OTP at %s km/h when given that speed', async (speed, mps) => {
    const straight: Array<[number, number]> = [[from.lat, from.lon], [to.lat, to.lon]]
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(otpResponse(straight, 900))))
    vi.stubGlobal('fetch', fetchMock)
    await callWith({ method: 'GET', query: { from: `${from.lat},${from.lon}`, to: `${to.lat},${to.lon}`, speed } })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(init.body)).toContain(`speed: ${Math.round(mps * 1e6) / 1e6}`)
  })

  it('rejects a speed outside the offered ones', async () => {
    const res = await callWith({ method: 'GET', query: { from: `${from.lat},${from.lon}`, to: `${to.lat},${to.lon}`, speed: '90' } })
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('never caches an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(noRouteResponse))))
    const res = await callWith({ method: 'GET', query: { from: `${from.lat},${from.lon}`, to: `${to.lat},${to.lon}` } })
    expect(res.statusCode).toBe(422)
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('requires the API key', async () => {
    vi.stubEnv('DIGITRANSIT_API_KEY', '')
    const res = await call('POST', { from, to })
    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({ code: 'SERVER_ERROR' })
  })

  it.each([
    ['missing points', {}, 'BAD_REQUEST'],
    ['no body', undefined, 'BAD_REQUEST'],
    ['non-numeric coordinates', { from: { lat: '60.1', lon: 24.9 }, to }, 'BAD_REQUEST'],
    ['non-finite coordinates', { from: { lat: Infinity, lon: 24.9 }, to }, 'BAD_REQUEST'],
    ['a point outside the region', { from: { lat: 61.5, lon: 23.8 }, to }, 'OUT_OF_AREA'],
    ['points closer than 50 m', { from, to: { lat: from.lat + 0.0001, lon: from.lon } }, 'TOO_SHORT'],
    ['points more than 40 km apart', { from: { lat: 60.1, lon: 24.5 }, to: { lat: 60.4, lon: 25.25 } }, 'TOO_LONG'],
  ])('returns 400 for %s', async (_label, body, code) => {
    const res = await call('POST', body)
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ code })
  })

  it('returns 400 when the JSON body cannot be parsed', async () => {
    const req = {
      method: 'POST',
      get body(): unknown {
        throw new SyntaxError('Unexpected token')
      },
    }
    const res = await callWith(req)
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('accepts a body that arrives as a JSON string', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(noRouteResponse))))
    const res = await call('POST', JSON.stringify({ from, to }))
    expect(res.body).toMatchObject({ code: 'NO_ROUTE' })
  })

  it('returns 422 NO_ROUTE when OTP finds no route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(noRouteResponse))))
    const res = await call('POST', { from, to })
    expect(res.statusCode).toBe(422)
    expect(res.body).toMatchObject({ code: 'NO_ROUTE' })
  })

  it('returns 503 UPSTREAM_UNAVAILABLE when Digitransit is down, without leaking its response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret upstream body', { status: 503 })))
    const res = await call('POST', { from, to })
    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })
    expect(JSON.stringify(res.body)).not.toContain('secret upstream body')
  })

  it('returns 504 TIMEOUT when every OTP call times out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      }),
    )
    const res = await call('POST', { from, to })
    expect(res.statusCode).toBe(504)
    expect(res.body).toMatchObject({ code: 'TIMEOUT' })
  })

  it('recovers after the layer file fails to load once', async () => {
    vi.resetModules()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(readFile).mockRejectedValueOnce(new Error('EIO'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(noRouteResponse))))
    const first = await call('POST', { from, to })
    expect(first.statusCode).toBe(500)
    expect(first.body).toMatchObject({ code: 'SERVER_ERROR' })
    const second = await call('POST', { from, to })
    expect(second.body).toMatchObject({ code: 'NO_ROUTE' })
  })

  it('returns cards and only the routes shown on them, with encoded legs', async () => {
    const straight: Array<[number, number]> = [[from.lat, from.lon], [to.lat, to.lon]]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(otpResponse(straight, 900)))))
    const res = await call('POST', { from, to })
    expect(res.statusCode).toBe(200)
    const body = res.body as {
      routes: Array<{ id: string; legs: string[]; lights: number; calmBand: string; climbM: number; stressRuns: unknown[] }>
      cards: Array<{ routeId: string; primary: string }>
      meta: { dataVersion: string; calls: number }
    }
    expect(body.cards).toHaveLength(1)
    expect(body.cards[0].primary).toBe('fastest')
    expect(body.routes.map((r) => r.id)).toEqual([body.cards[0].routeId])
    expect(polyline.decode(body.routes[0].legs[0])).toHaveLength(2)
    expect(body.routes[0]).toMatchObject({ climbM: expect.any(Number), stressRuns: expect.any(Array) })
    expect(body.meta.dataVersion).toBe('2026-10-01T00:00:00Z')
    expect(body.meta.calls).toBeGreaterThanOrEqual(3)
  })
})
