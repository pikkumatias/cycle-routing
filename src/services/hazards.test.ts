import { describe, it, expect, vi, afterEach } from 'vitest'
import { filterHazardsNearRoute, hazardToLatLng, type Hazard, fetchHazards } from './hazards'
import type { LatLng } from '../utils/routeGeometry'

// Straight north-south route in Helsinki, ~500m long
const ROUTE: LatLng[] = [
  [60.1700, 24.9400],
  [60.1720, 24.9400],
  [60.1740, 24.9400],
  [60.1760, 24.9400],
  [60.1780, 24.9400],
]

function makeHazard(geometry: Hazard['geometry'], id = 'h1'): Hazard {
  return {
    id,
    type: 'excavation',
    purpose: null,
    address: null,
    district: null,
    startDate: null,
    endDate: null,
    geometry,
  }
}

describe('filterHazardsNearRoute', () => {
  describe('Point hazards', () => {
    it('includes a point directly on the route', () => {
      const h = makeHazard({ type: 'Point', coordinates: [24.9400, 60.1740] })
      expect(filterHazardsNearRoute([h], ROUTE)).toHaveLength(1)
    })

    it('includes a point within 50m of the route', () => {
      // ~30m east of the route
      const h = makeHazard({ type: 'Point', coordinates: [24.9404, 60.1740] })
      expect(filterHazardsNearRoute([h], ROUTE)).toHaveLength(1)
    })

    it('excludes a point further than 50m from the route', () => {
      // ~200m east of the route
      const h = makeHazard({ type: 'Point', coordinates: [24.9430, 60.1740] })
      expect(filterHazardsNearRoute([h], ROUTE)).toHaveLength(0)
    })
  })

  describe('MultiPoint hazards', () => {
    it('includes when any point is within threshold', () => {
      const h = makeHazard({
        type: 'MultiPoint',
        coordinates: [
          [24.9430, 60.1740], // far
          [24.9401, 60.1740], // near (~10m)
        ],
      })
      expect(filterHazardsNearRoute([h], ROUTE)).toHaveLength(1)
    })

    it('excludes when all points are beyond threshold', () => {
      const h = makeHazard({
        type: 'MultiPoint',
        coordinates: [
          [24.9430, 60.1740],
          [24.9435, 60.1760],
        ],
      })
      expect(filterHazardsNearRoute([h], ROUTE)).toHaveLength(0)
    })
  })

  describe('Polygon hazards — boundary vertex check', () => {
    it('includes a polygon whose boundary crosses the route', () => {
      // Small rectangle straddling the route at lon 24.94
      const h = makeHazard({
        type: 'Polygon',
        coordinates: [[
          [24.9395, 60.1738],
          [24.9405, 60.1738],
          [24.9405, 60.1742],
          [24.9395, 60.1742],
          [24.9395, 60.1738],
        ]],
      })
      expect(filterHazardsNearRoute([h], ROUTE)).toHaveLength(1)
    })

    it('excludes a polygon whose boundary is far from the route', () => {
      // Rectangle sitting ~200m to the east
      const h = makeHazard({
        type: 'Polygon',
        coordinates: [[
          [24.9425, 60.1738],
          [24.9435, 60.1738],
          [24.9435, 60.1742],
          [24.9425, 60.1742],
          [24.9425, 60.1738],
        ]],
      })
      expect(filterHazardsNearRoute([h], ROUTE)).toHaveLength(0)
    })

    it('excludes a large polygon whose centroid is near the route but boundary is not', () => {
      // Wide east-west rectangle; centroid at lon 24.945 (~500m east of route),
      // western boundary at lon 24.943 (~300m east) — beyond the 50m threshold.
      const h = makeHazard({
        type: 'Polygon',
        coordinates: [[
          [24.9430, 60.1738],
          [24.9470, 60.1738],
          [24.9470, 60.1742],
          [24.9430, 60.1742],
          [24.9430, 60.1738],
        ]],
      })
      expect(filterHazardsNearRoute([h], ROUTE)).toHaveLength(0)
    })
  })

  describe('Polygon hazards — point-in-polygon check', () => {
    it('includes a large polygon that fully contains the route', () => {
      // Giant rectangle enclosing the entire route; boundary vertices are ~1km from route
      const h = makeHazard({
        type: 'Polygon',
        coordinates: [[
          [24.9300, 60.1680],
          [24.9500, 60.1680],
          [24.9500, 60.1800],
          [24.9300, 60.1800],
          [24.9300, 60.1680],
        ]],
      })
      expect(filterHazardsNearRoute([h], ROUTE)).toHaveLength(1)
    })

    it('excludes a large polygon that does not contain any route vertex', () => {
      // Giant rectangle east of the route
      const h = makeHazard({
        type: 'Polygon',
        coordinates: [[
          [24.9410, 60.1680],
          [24.9600, 60.1680],
          [24.9600, 60.1800],
          [24.9410, 60.1800],
          [24.9410, 60.1680],
        ]],
      })
      expect(filterHazardsNearRoute([h], ROUTE)).toHaveLength(0)
    })
  })

  describe('MultiPolygon hazards', () => {
    it('includes when a sub-polygon boundary is near the route', () => {
      const h = makeHazard({
        type: 'MultiPolygon',
        coordinates: [
          // far polygon
          [[
            [24.9430, 60.1738],
            [24.9440, 60.1738],
            [24.9440, 60.1742],
            [24.9430, 60.1742],
            [24.9430, 60.1738],
          ]],
          // near polygon straddles the route
          [[
            [24.9395, 60.1738],
            [24.9405, 60.1738],
            [24.9405, 60.1742],
            [24.9395, 60.1742],
            [24.9395, 60.1738],
          ]],
        ],
      })
      expect(filterHazardsNearRoute([h], ROUTE)).toHaveLength(1)
    })
  })

  describe('empty inputs', () => {
    it('returns empty array when no hazards', () => {
      expect(filterHazardsNearRoute([], ROUTE)).toHaveLength(0)
    })

    it('excludes all hazards when route is empty', () => {
      const h = makeHazard({ type: 'Point', coordinates: [24.9400, 60.1740] })
      expect(filterHazardsNearRoute([h], [])).toHaveLength(0)
    })
  })
})

describe('hazardToLatLng', () => {
  it('converts a Point geometry to [lat, lon]', () => {
    const h = makeHazard({ type: 'Point', coordinates: [24.94, 60.17] })
    expect(hazardToLatLng(h)).toEqual([60.17, 24.94])
  })

  it('returns the centroid of a MultiPoint geometry', () => {
    const h = makeHazard({
      type: 'MultiPoint',
      coordinates: [
        [24.94, 60.17],
        [24.96, 60.19],
      ],
    })
    const result = hazardToLatLng(h)
    expect(result).not.toBeNull()
    expect(result![0]).toBeCloseTo(60.18, 5)
    expect(result![1]).toBeCloseTo(24.95, 5)
  })

  it('returns null for an empty MultiPoint', () => {
    const h = makeHazard({ type: 'MultiPoint', coordinates: [] })
    expect(hazardToLatLng(h)).toBeNull()
  })

  it('returns the centroid of a Polygon outer ring', () => {
    const h = makeHazard({
      type: 'Polygon',
      coordinates: [[
        [24.93, 60.17],
        [24.95, 60.17],
        [24.95, 60.19],
        [24.93, 60.19],
        [24.93, 60.17],
      ]],
    })
    const result = hazardToLatLng(h)
    expect(result).not.toBeNull()
    expect(result![0]).toBeCloseTo(60.18, 1)
    expect(result![1]).toBeCloseTo(24.94, 1)
  })

  it('returns null for a Polygon with an empty ring', () => {
    const h = makeHazard({ type: 'Polygon', coordinates: [[]] })
    expect(hazardToLatLng(h)).toBeNull()
  })
})

describe('fetchHazards', () => {
  afterEach(() => vi.unstubAllGlobals())

  let n = 0
  /** Bounds no earlier test has cached. */
  const freshBounds = () => {
    n++
    return { minLat: 60 + n * 0.1, minLon: 24.9, maxLat: 60.05 + n * 0.1, maxLon: 24.95 }
  }
  const layer = (features: unknown[]) => new Response(JSON.stringify({ features }))
  const point = { id: 'p1', geometry: { type: 'Point', coordinates: [24.9, 60.1] }, properties: {} }

  it('throws instead of reporting no roadworks when every layer fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(fetchHazards(freshBounds())).rejects.toThrow()
  })

  it('does not cache a failed or partial answer, so the next call retries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bounds = freshBounds()
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (calls++ === 0 ? Promise.reject(new TypeError('down')) : layer([point]))),
    )
    expect(await fetchHazards(bounds)).toHaveLength(5)
    expect(await fetchHazards(bounds)).toHaveLength(6)
    const fetched = calls
    expect(await fetchHazards(bounds)).toHaveLength(6)
    expect(calls).toBe(fetched)
  })

  it('stops when the caller aborts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))),
      ),
    )
    const controller = new AbortController()
    const pending = fetchHazards(freshBounds(), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
