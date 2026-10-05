import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fetchGeocodingAutocomplete, parseLatLon, type LatLonPair } from './digitransit'

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

describe('fetchGeocodingAutocomplete', () => {
  it('returns empty array for empty input', async () => {
    const result = await fetchGeocodingAutocomplete('')
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns empty array for whitespace-only input', async () => {
    const result = await fetchGeocodingAutocomplete('   ')
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('calls the backend proxy with correct params', async () => {
    const geoJsonResponse = {
      features: [
        {
          properties: { label: 'Helsingin päärautatieasema' },
          geometry: { coordinates: [24.941, 60.171] },
        },
      ],
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => geoJsonResponse,
    } as Response)

    const result = await fetchGeocodingAutocomplete('Helsinki')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url] = mockFetch.mock.calls[0]
    expect(url).toContain('/api/digitransit-geocode')
    expect(url).toContain('text=Helsinki')
    expect(url).toContain('size=5')
    expect(url).toContain('lang=en')

    expect(result).toEqual([
      { label: 'Helsingin päärautatieasema', lat: 60.171, lon: 24.941 },
    ])
  })

  it('parses GeoJSON coordinates as [lon, lat]', async () => {
    const geoJsonResponse = {
      features: [
        {
          properties: { label: 'Test Place' },
          geometry: { coordinates: [25.0, 61.5] },
        },
      ],
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => geoJsonResponse,
    } as Response)

    const result = await fetchGeocodingAutocomplete('Test')
    expect(result[0].lon).toBe(25.0)
    expect(result[0].lat).toBe(61.5)
  })

  it('returns empty array when no features are present', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ features: [] }),
    } as Response)

    const result = await fetchGeocodingAutocomplete('Nonexistent')
    expect(result).toEqual([])
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'Access denied',
    } as Response)

    await expect(
      fetchGeocodingAutocomplete('Helsinki'),
    ).rejects.toThrow(/Geocoding API error: 403 Forbidden/i)
  })

  it('passes AbortSignal to fetch', async () => {
    const controller = new AbortController()
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ features: [] }),
    } as Response)

    await fetchGeocodingAutocomplete('Test', controller.signal)

    const [, options] = mockFetch.mock.calls[0]
    expect(options).toHaveProperty('signal', controller.signal)
  })
})

