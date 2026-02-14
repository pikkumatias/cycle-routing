import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fetchBicycleRoute, parseLatLon, type LatLonPair } from './digitransit'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  globalThis.fetch = mockFetch as unknown as typeof fetch
})

describe('parseLatLon', () => {
  it('parses "lat,lon" format', () => {
    const result = parseLatLon('60.192059,24.945831')
    expect(result).toEqual<LatLonPair>({
      lat: 60.192059,
      lon: 24.945831,
    })
  })

  it('parses "lat lon" format', () => {
    const result = parseLatLon('60.192059 24.945831')
    expect(result).toEqual<LatLonPair>({
      lat: 60.192059,
      lon: 24.945831,
    })
  })

  it('throws when input is empty', () => {
    expect(() => parseLatLon('')).toThrow(/Value is required/i)
  })

  it('throws when format is invalid', () => {
    expect(() => parseLatLon('60.192059')).toThrow(/Use "lat,lon" or "lat lon"/i)
  })

  it('throws when numbers are invalid', () => {
    expect(() => parseLatLon('abc,24.945831')).toThrow(
      /must be numbers/i,
    )
  })
})

describe('fetchBicycleRoute', () => {
  const from: LatLonPair = { lat: 60.192059, lon: 24.945831 }
  const to: LatLonPair = { lat: 60.169857, lon: 24.938379 }

  it('throws when API key is missing', async () => {
    await expect(
      fetchBicycleRoute(from, to, undefined),
    ).rejects.toThrow(/VITE_DIGITRANSIT_API_KEY is not set/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('calls Digitransit with correct payload and headers', async () => {
    const fakeResponse = { data: { plan: { itineraries: [] } } }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => fakeResponse,
    } as Response)

    const apiKey = 'test-key'

    const result = await fetchBicycleRoute(from, to, apiKey)

    expect(result).toEqual(fakeResponse)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]

    expect(url).toBe(
      'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1',
    )

    const { method, headers, body } = options as RequestInit
    expect(method).toBe('POST')
    expect(headers).toMatchObject({
      'Content-Type': 'application/json',
      'digitransit-subscription-key': apiKey,
    })

    const parsedBody = JSON.parse(String(body))
    expect(parsedBody).toHaveProperty('query')
    expect(parsedBody).toHaveProperty('variables')
    expect(parsedBody.variables).toEqual({
      fromLat: from.lat,
      fromLon: from.lon,
      toLat: to.lat,
      toLon: to.lon,
    })
  })

  it('request body query includes legGeometry with length and points for map drawing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { plan: { itineraries: [] } } }),
    } as Response)

    await fetchBicycleRoute(from, to, 'test-key')

    const [, options] = mockFetch.mock.calls[0]
    const body = options?.body as string
    const parsedBody = JSON.parse(body)
    const query = parsedBody.query as string

    expect(query).toContain('legGeometry')
    expect(query).toContain('length')
    expect(query).toContain('points')
    expect(query).toMatch(/legGeometry\s*\{\s*length\s+points\s*}/s)
  })

  it('returns response with legGeometry on legs unchanged', async () => {
    const encodedPolyline = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
    const fakeItinerary = {
      duration: 960,
      walkDistance: 0,
      legs: [
        {
          mode: 'BICYCLE',
          startTime: 1730000000000,
          endTime: 1730000960000,
          distance: 2523,
          from: { name: 'Origin' },
          to: { name: 'Destination' },
          route: null,
          legGeometry: { length: 42, points: encodedPolyline },
        },
      ],
    }
    const fakeResponse = {
      data: { plan: { itineraries: [fakeItinerary] } },
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => fakeResponse,
    } as Response)

    const result = await fetchBicycleRoute(from, to, 'test-key')

    expect(result).toEqual(fakeResponse)
    const legs = (result as any)?.data?.plan?.itineraries?.[0]?.legs
    expect(legs).toHaveLength(1)
    expect(legs[0].legGeometry).toEqual({ length: 42, points: encodedPolyline })
  })

  it('throws a helpful error when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid subscription key',
    } as Response)

    await expect(
      fetchBicycleRoute(from, to, 'bad-key'),
    ).rejects.toThrow(/Routing API error: 401 Unauthorized/i)
  })
})

