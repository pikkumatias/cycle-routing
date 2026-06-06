import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  filterStationsNearEndpoints,
  CITYBIKE_RADII_M,
  type CityBikeStation,
} from './citybikes'
import type { LatLng } from '../utils/routeGeometry'

const ORIGIN: LatLng = [60.17, 24.94]
// ~3.3 km from ORIGIN, so the two search radii never overlap.
const DEST: LatLng = [60.2, 24.96]

// At this latitude 0.001° ≈ 111 m, so latitude-only offsets give known distances:
// 0.004° ≈ 445 m (≤500), 0.005° ≈ 556 m (≤750), 0.008° ≈ 890 m (≤1000),
// 0.01° ≈ 1112 m (>1000).
function station(lat: number, lon: number, bikesAvailable = 5): CityBikeStation {
  return { stationId: `${lat},${lon}`, name: 'Test', lat, lon, bikesAvailable }
}

describe('CITYBIKE_RADII_M', () => {
  it('widens from 500 to 750 to 1000 meters', () => {
    expect(CITYBIKE_RADII_M).toEqual([500, 750, 1000])
  })
})

describe('filterStationsNearEndpoints', () => {
  it('returns an empty array for empty input', () => {
    expect(filterStationsNearEndpoints([], ORIGIN, DEST)).toEqual([])
  })

  it('excludes endpoints with no stations within the largest radius', () => {
    const s = station(60.185, 24.95) // ~1.7 km from both endpoints
    expect(filterStationsNearEndpoints([s], ORIGIN, DEST)).toEqual([])
  })

  it('keeps both stations within the base radius without widening', () => {
    const a = station(ORIGIN[0] + 0.001, ORIGIN[1]) // ~111 m
    const b = station(ORIGIN[0] + 0.002, ORIGIN[1]) // ~222 m
    const justOutside = station(ORIGIN[0] + 0.006, ORIGIN[1]) // ~667 m
    expect(
      filterStationsNearEndpoints([a, b, justOutside], ORIGIN, DEST),
    ).toEqual([a, b])
  })

  it('widens to 750 m when only one station is within 500 m', () => {
    const a = station(ORIGIN[0] + 0.001, ORIGIN[1]) // ~111 m (≤500)
    const b = station(ORIGIN[0] + 0.006, ORIGIN[1]) // ~667 m (≤750)
    expect(filterStationsNearEndpoints([a, b], ORIGIN, DEST)).toEqual([a, b])
  })

  it('widens to 1000 m when only one station is within 750 m', () => {
    const a = station(ORIGIN[0] + 0.001, ORIGIN[1]) // ~111 m (≤500)
    const b = station(ORIGIN[0] + 0.008, ORIGIN[1]) // ~890 m (≤1000, >750)
    expect(filterStationsNearEndpoints([a, b], ORIGIN, DEST)).toEqual([a, b])
  })

  it('stops at 1000 m and returns the single reachable station', () => {
    const a = station(ORIGIN[0] + 0.001, ORIGIN[1]) // ~111 m
    const tooFar = station(ORIGIN[0] + 0.01, ORIGIN[1]) // ~1112 m (>1000)
    expect(filterStationsNearEndpoints([a, tooFar], ORIGIN, DEST)).toEqual([a])
  })

  it('searches each endpoint independently and merges the results', () => {
    const o1 = station(ORIGIN[0] + 0.001, ORIGIN[1]) // origin, ~111 m
    const o2 = station(ORIGIN[0] + 0.002, ORIGIN[1]) // origin, ~222 m
    const d1 = station(DEST[0] + 0.001, DEST[1]) // dest, ~111 m
    const d2 = station(DEST[0] + 0.006, DEST[1]) // dest, ~667 m (needs widening)
    expect(
      filterStationsNearEndpoints([o1, o2, d1, d2], ORIGIN, DEST),
    ).toEqual([o1, o2, d1, d2])
  })

  it('dedupes a station that is near both endpoints', () => {
    const near: LatLng = [60.17, 24.94]
    const close: LatLng = [60.1711, 24.94] // ~122 m from `near`
    const s = station(near[0], near[1])
    expect(filterStationsNearEndpoints([s], near, close)).toEqual([s])
  })
})

describe('fetchCityBikeStations', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function load() {
    return import('./citybikes')
  }

  it('returns the stations array from the response body', async () => {
    const stations = [station(60.17, 24.94)]
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ stations }) })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchCityBikeStations } = await load()
    await expect(fetchCityBikeStations()).resolves.toEqual(stations)
    expect(fetchMock).toHaveBeenCalledWith('/api/citybike-stations')
  })

  it('caches results within the TTL so a second call does not refetch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ stations: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchCityBikeStations } = await load()
    await fetchCityBikeStations()
    await fetchCityBikeStations()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('defaults to an empty array when the body has no stations field', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchCityBikeStations } = await load()
    await expect(fetchCityBikeStations()).resolves.toEqual([])
  })

  it('throws with the status when the response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'boom',
    })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchCityBikeStations } = await load()
    await expect(fetchCityBikeStations()).rejects.toThrow('City bike API error: 500')
  })
})
