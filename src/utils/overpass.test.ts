import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  fetchParksAndWater,
  boundsToBbox,
  osmPoisToLatLngs,
  type OsmPoi,
} from './overpass'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  globalThis.fetch = mockFetch as unknown as typeof fetch
})

describe('boundsToBbox', () => {
  it('converts route bounds to Overpass bbox', () => {
    const bounds: [number, number][] = [
      [60.1, 24.8],
      [60.2, 25.0],
    ]
    expect(boundsToBbox(bounds)).toEqual({
      south: 60.1,
      west: 24.8,
      north: 60.2,
      east: 25.0,
    })
  })

  it('returns null for invalid input', () => {
    expect(boundsToBbox([])).toBeNull()
    expect(boundsToBbox([[60, 24]])).toBeNull()
  })
})

describe('osmPoisToLatLngs', () => {
  it('converts OsmPoi array to [lat, lon][]', () => {
    const pois: OsmPoi[] = [
      { lat: 60.17, lon: 24.94 },
      { lat: 60.18, lon: 24.95 },
    ]
    expect(osmPoisToLatLngs(pois)).toEqual([
      [60.17, 24.94],
      [60.18, 24.95],
    ])
  })
})

describe('fetchParksAndWater', () => {
  const okResponse = (elements: object[]) => ({
    ok: true,
    json: async () => ({ elements }),
  } as Response)

  it('fires a single combined query and returns all results', async () => {
    // Each test uses a unique bbox to avoid hitting the in-memory cache
    const bbox = { south: 60.16, west: 24.93, north: 60.18, east: 24.96 }

    mockFetch.mockResolvedValueOnce(okResponse([
      { type: 'node', lat: 60.17, lon: 24.94, tags: { leisure: 'park' } },
      { type: 'way', center: { lat: 60.175, lon: 24.95 }, tags: { natural: 'water' } },
      { type: 'way', center: { lat: 60.171, lon: 24.94 }, tags: { highway: 'cycleway' } },
    ]))

    const result = await fetchParksAndWater(bbox)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({
      lat: 60.17, lon: 24.94, type: 'node',
      tags: { leisure: 'park' }, category: 'park',
    })
    expect(result[1]).toEqual({
      lat: 60.175, lon: 24.95, type: 'way',
      tags: { natural: 'water' }, category: 'water',
    })
    expect(result[2]).toEqual({
      lat: 60.171, lon: 24.94, type: 'way',
      tags: { highway: 'cycleway' }, category: 'cycleway_separated',
    })

    // Only one HTTP request for the combined query
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://overpass-api.de/api/interpreter',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    )

    // Combined query body contains both scenic and infra tags
    const body = decodeURIComponent(mockFetch.mock.calls[0][1].body as string)
    expect(body).toContain('[out:json]')
    expect(body).toContain('leisure')
    expect(body).toContain('cycleway')
    expect(body).toContain('out center qt')
    expect(body).toContain('60.16')
  })

  it('returns empty array when the response has no elements', async () => {
    const bbox = { south: 60.20, west: 24.93, north: 60.22, east: 24.96 }
    mockFetch.mockResolvedValueOnce(okResponse([]))

    const result = await fetchParksAndWater(bbox)
    expect(result).toEqual([])
  })

  it('returns cached result on second call with same bbox', async () => {
    const bbox = { south: 60.30, west: 24.93, north: 60.32, east: 24.96 }
    mockFetch.mockResolvedValue(okResponse([
      { type: 'node', lat: 60.31, lon: 24.94, tags: { leisure: 'park' } },
    ]))

    const first = await fetchParksAndWater(bbox)
    const second = await fetchParksAndWater(bbox)

    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
    // Only one fetch despite two calls
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('retries on the fallback endpoint and throws when all endpoints fail', async () => {
    const bbox = { south: 60.40, west: 24.93, north: 60.42, east: 24.96 }
    const errorResponse = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'Rate limited',
    } as Response
    mockFetch.mockResolvedValue(errorResponse)

    await expect(
      fetchParksAndWater(bbox),
    ).rejects.toThrow(/Overpass API error: 429/)

    // 2 calls total: primary endpoint, then fallback
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://overpass.kumi.systems/api/interpreter',
      expect.objectContaining({ method: 'POST' }),
    )
  }, 2000)
})
