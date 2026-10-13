// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import handler from './digitransit-reverse-geocode'
import { fetchedUrl, mockRes } from './_lib/testing'

async function call(query: Record<string, string | string[] | undefined>, method = 'GET') {
  const res = mockRes()
  await handler({ method, query }, res)
  return res
}

beforeEach(() => {
  vi.stubEnv('DIGITRANSIT_API_KEY', 'test-key')
  vi.unstubAllGlobals()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/digitransit-reverse-geocode', () => {
  it('rejects other methods', async () => {
    expect((await call({}, 'POST')).statusCode).toBe(405)
  })

  it.each([
    ['missing point', {}],
    ['non-numeric lat', { 'point.lat': 'north', 'point.lon': '24.9' }],
    ['out-of-range lon', { 'point.lat': '60.1', 'point.lon': '200' }],
  ])('returns 400 for %s', async (_label, query) => {
    const res = await call(query)
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('takes the first of repeated params instead of crashing', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ features: [] })))
    vi.stubGlobal('fetch', fetchMock)
    const res = await call({ 'point.lat': ['60.17', '1'], 'point.lon': ['24.94', '2'], lang: ['fi', 'en'] })
    expect(res.statusCode).toBe(200)
    const url = fetchedUrl(fetchMock)
    expect(url.searchParams.get('point.lat')).toBe('60.17')
    expect(url.searchParams.get('point.lon')).toBe('24.94')
    expect(url.searchParams.get('lang')).toBe('fi')
    expect(url.searchParams.get('size')).toBe('1')
  })

  it('maps upstream failures to 502 without their body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota exceeded for key xyz', { status: 429 })))
    const res = await call({ 'point.lat': '60.17', 'point.lon': '24.94' })
    expect(res.statusCode).toBe(502)
    expect(JSON.stringify(res.body)).not.toContain('xyz')
  })
})
