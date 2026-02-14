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
  it('POSTs query to Overpass and returns parsed POIs', async () => {
    const bbox = { south: 60.16, west: 24.93, north: 60.18, east: 24.96 }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        elements: [
          { type: 'node', lat: 60.17, lon: 24.94, tags: { leisure: 'park' } },
          {
            type: 'way',
            center: { lat: 60.175, lon: 24.95 },
            tags: { natural: 'water' },
          },
        ],
      }),
    } as Response)

    const result = await fetchParksAndWater(bbox)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      lat: 60.17,
      lon: 24.94,
      type: 'node',
      tags: { leisure: 'park' },
    })
    expect(result[1]).toEqual({
      lat: 60.175,
      lon: 24.95,
      type: 'way',
      tags: { natural: 'water' },
    })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://overpass-api.de/api/interpreter',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    )
    const body = mockFetch.mock.calls[0][1].body as string
    expect(body).toContain('data=')
    expect(decodeURIComponent(body)).toContain('[out:json]')
    expect(decodeURIComponent(body)).toContain('leisure')
    expect(decodeURIComponent(body)).toContain('60.16')
  })

  it('returns empty array when response has no elements', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ elements: [] }),
    } as Response)

    const result = await fetchParksAndWater({
      south: 60,
      west: 24,
      north: 61,
      east: 25,
    })
    expect(result).toEqual([])
  })

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'Rate limited',
    } as Response)

    await expect(
      fetchParksAndWater({ south: 60, west: 24, north: 61, east: 25 }),
    ).rejects.toThrow(/Overpass API error: 429/)
  })
})
