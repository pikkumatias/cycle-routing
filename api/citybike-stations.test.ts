// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import handler from './citybike-stations'
import { mockRes } from './_lib/testing'

async function call(method = 'GET') {
  const res = mockRes()
  await handler({ method, query: {} }, res)
  return res
}

const station = (over: Record<string, unknown>) => ({
  stationId: 'smoove:900',
  name: 'Orionintie',
  lat: 60.18,
  lon: 24.77,
  operative: true,
  availableVehicles: { total: 13 },
  ...over,
})

beforeEach(() => {
  vi.stubEnv('DIGITRANSIT_API_KEY', 'test-key')
  vi.unstubAllGlobals()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/citybike-stations', () => {
  it('rejects other methods', async () => {
    expect((await call('POST')).statusCode).toBe(405)
  })

  it('queries vehicleRentalStations and keeps operative stations with coordinates', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            vehicleRentalStations: [
              station({}),
              station({ stationId: 'smoove:1', operative: false }),
              station({ stationId: 'smoove:2', lat: null }),
              station({ stationId: 'smoove:3', availableVehicles: null }),
            ],
          },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = await call()
    expect(res.statusCode).toBe(200)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(init.body)).toContain('vehicleRentalStations')
    expect(res.body).toEqual({
      stations: [
        { stationId: 'smoove:900', name: 'Orionintie', lat: 60.18, lon: 24.77, bikesAvailable: 13 },
        { stationId: 'smoove:3', name: 'Orionintie', lat: 60.18, lon: 24.77, bikesAvailable: 0 },
      ],
    })
  })

  it('maps upstream failures to 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })))
    const res = await call()
    expect(res.statusCode).toBe(502)
    expect(res.body).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })
  })

  it('maps GraphQL errors without data to 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'boom' }] }))))
    const res = await call()
    expect(res.statusCode).toBe(502)
  })
})
