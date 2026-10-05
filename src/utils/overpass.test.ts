import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  fetchParksAndWater,
  boundsToBbox,
  classifyPoi,
  snapBboxOutward,
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
      '/api/overpass',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    // Combined query body contains both scenic and infra tags
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string).query as string
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
    ).rejects.toThrow(/Overpass proxy error: 429/)

    // 4 calls total: 1 endpoint × 4 rounds (initial + 3 retries)
    expect(mockFetch).toHaveBeenCalledTimes(4)
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/overpass',
      expect.objectContaining({ method: 'POST' }),
    )
  }, 15000)
})

describe('classifyPoi traffic signals', () => {
  it('classifies intersection signal nodes', () => {
    expect(classifyPoi({ highway: 'traffic_signals' })).toBe('traffic_signal')
  })

  it('classifies signalised crossings tagged the Helsinki way', () => {
    expect(classifyPoi({ highway: 'crossing', crossing: 'traffic_signals' })).toBe('traffic_signal')
  })

  it.each(['blinker', 'emergency', 'ramp_meter'])('ignores %s signals that never stop cyclists', (kind) => {
    expect(classifyPoi({ highway: 'traffic_signals', traffic_signals: kind })).toBeUndefined()
  })

  it('leaves unsignalised crossings unclassified', () => {
    expect(classifyPoi({ highway: 'crossing', crossing: 'uncontrolled' })).toBeUndefined()
  })
})

describe('snapBboxOutward', () => {
  it('expands every edge outward to the 0.01° grid', () => {
    expect(snapBboxOutward({ south: 60.1649, west: 24.9301, north: 60.1751, east: 24.9449 })).toEqual({
      south: 60.16, west: 24.93, north: 60.18, east: 24.95,
    })
  })

  it('keeps edges that already sit on the grid', () => {
    expect(snapBboxOutward({ south: 60.16, west: 24.93, north: 60.18, east: 24.96 })).toEqual({
      south: 60.16, west: 24.93, north: 60.18, east: 24.96,
    })
  })

  it('maps a box and a slightly larger box in the same cells to the same snapped box', () => {
    const small = snapBboxOutward({ south: 60.161, west: 24.931, north: 60.171, east: 24.941 })
    const large = snapBboxOutward({ south: 60.1601, west: 24.9301, north: 60.1799, east: 24.9499 })
    expect(large).toEqual(small)
  })
})

describe('combined query', () => {
  it('requests signalised crossing nodes', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ elements: [] }) } as Response)
    await fetchParksAndWater({ south: 60.50, west: 24.93, north: 60.52, east: 24.96 })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string).query as string
    expect(body).toContain('node["crossing"="traffic_signals"]')
  })
})
