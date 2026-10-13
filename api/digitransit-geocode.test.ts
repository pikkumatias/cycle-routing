// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import handler, { REGION_BBOX } from './digitransit-geocode'
import { fetchedUrl, mockRes } from './_lib/testing'

async function call(query: Record<string, string | string[] | undefined>, method = 'GET') {
  const res = mockRes()
  await handler({ method, query }, res)
  return res
}

const okFetch = () => vi.fn(async () => new Response(JSON.stringify({ features: [] })))

beforeEach(() => {
  vi.stubEnv('DIGITRANSIT_API_KEY', 'test-key')
  vi.unstubAllGlobals()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/digitransit-geocode', () => {
  it('rejects other methods', async () => {
    const res = await call({ text: 'x' }, 'POST')
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('GET')
  })

  it.each([
    ['missing text', {}],
    ['blank text', { text: '  ' }],
    ['overlong text', { text: 'a'.repeat(201) }],
  ])('returns 400 for %s', async (_label, query) => {
    const res = await call(query)
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('forwards only allow-listed, validated params and bounds results to the data area', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const res = await call({
      text: ['Mannerheimintie', 'ignored'],
      size: '500',
      lang: 'de',
      'focus.point.lat': '60.17',
      'focus.point.lon': '24.94',
      api_key: 'sneaky',
    })
    expect(res.statusCode).toBe(200)
    const url = fetchedUrl(fetchMock)
    expect(url.searchParams.get('text')).toBe('Mannerheimintie')
    expect(url.searchParams.get('size')).toBe('10')
    expect(url.searchParams.get('lang')).toBe('en')
    expect(url.searchParams.get('focus.point.lat')).toBe('60.17')
    expect(url.searchParams.get('boundary.rect.min_lat')).toBe(String(REGION_BBOX[0]))
    expect(url.searchParams.get('boundary.rect.max_lon')).toBe(String(REGION_BBOX[3]))
    expect(url.searchParams.has('api_key')).toBe(false)
    expect(res.headers['Cache-Control']).toContain('s-maxage')
  })

  it('drops an invalid focus point instead of forwarding it', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    await call({ text: 'x', 'focus.point.lat': 'abc', 'focus.point.lon': '24.94' })
    const url = fetchedUrl(fetchMock)
    expect(url.searchParams.has('focus.point.lat')).toBe(false)
    expect(url.searchParams.has('focus.point.lon')).toBe(false)
  })

  it('maps an upstream auth failure to 502 without its body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid key abc123', { status: 401 })))
    const res = await call({ text: 'x' })
    expect(res.statusCode).toBe(502)
    expect(res.body).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })
    expect(JSON.stringify(res.body)).not.toContain('abc123')
  })

  it('maps an upstream timeout to 504', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('timed out', 'TimeoutError')
      }),
    )
    const res = await call({ text: 'x' })
    expect(res.statusCode).toBe(504)
    expect(res.body).toMatchObject({ code: 'TIMEOUT' })
  })

  it('keeps the search box in step with the routing data area', () => {
    const meta = JSON.parse(readFileSync('data/meta.json', 'utf8')) as { bbox: number[] }
    expect(REGION_BBOX).toEqual(meta.bbox)
  })
})
