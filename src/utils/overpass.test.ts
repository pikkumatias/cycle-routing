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
  const bbox = { south: 60.16, west: 24.93, north: 60.18, east: 24.96 }

  const okResponse = (elements: object[]) => ({
    ok: true,
    json: async () => ({ elements }),
  } as Response)

  it('fires two parallel queries (scenic + infra) and merges the results', async () => {
    // Scenic query resolves first (first fetch call)
    mockFetch.mockResolvedValueOnce(okResponse([
      { type: 'node', lat: 60.17, lon: 24.94, tags: { leisure: 'park' } },
      { type: 'way', center: { lat: 60.175, lon: 24.95 }, tags: { natural: 'water' } },
    ]))
    // Infra query (second fetch call)
    mockFetch.mockResolvedValueOnce(okResponse([
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

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://overpass-api.de/api/interpreter',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    )

    // Scenic query body contains leisure tags and bbox coords
    const scenicBody = decodeURIComponent(mockFetch.mock.calls[0][1].body as string)
    expect(scenicBody).toContain('[out:json]')
    expect(scenicBody).toContain('leisure')
    expect(scenicBody).toContain('60.16')

    // Infra query body contains highway/cycleway tags
    const infraBody = decodeURIComponent(mockFetch.mock.calls[1][1].body as string)
    expect(infraBody).toContain('[out:json]')
    expect(infraBody).toContain('cycleway')
    expect(infraBody).toContain('60.16')
  })

  it('returns empty array when both responses have no elements', async () => {
    mockFetch.mockResolvedValue(okResponse([]))

    const result = await fetchParksAndWater({ south: 60, west: 24, north: 61, east: 25 })
    expect(result).toEqual([])
  })

  it('retries on the fallback endpoint and throws when all endpoints fail', async () => {
    const errorResponse = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'Rate limited',
    } as Response
    // All calls (primary + fallback for both scenic and infra) return 429
    mockFetch.mockResolvedValue(errorResponse)

    await expect(
      fetchParksAndWater({ south: 60, west: 24, north: 61, east: 25 }),
    ).rejects.toThrow(/Overpass API error: 429/)

    // 4 calls total: scenic→primary, infra→primary, scenic→fallback, infra→fallback
    expect(mockFetch).toHaveBeenCalledTimes(4)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://overpass.kumi.systems/api/interpreter',
      expect.objectContaining({ method: 'POST' }),
    )
  }, 2000)

  it('returns partial results when only the infra query fails', async () => {
    // Use mockImplementation to distinguish scenic vs infra by query body content
    mockFetch.mockImplementation(async (_url: string, opts: RequestInit) => {
      const body = decodeURIComponent(opts.body as string)
      if (body.includes('leisure')) {
        // Scenic query
        return okResponse([
          { type: 'node', lat: 60.17, lon: 24.94, tags: { leisure: 'park' } },
        ])
      }
      // Infra query — always fails
      return {
        ok: false, status: 500, statusText: 'Server Error',
        text: async () => 'error',
      } as Response
    })

    const result = await fetchParksAndWater({ south: 60, west: 24, north: 61, east: 25 })

    // Scenic POIs are returned even though infra failed
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ category: 'park' })
  }, 2000)
})
