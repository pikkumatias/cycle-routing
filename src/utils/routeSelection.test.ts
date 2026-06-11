import { describe, it, expect } from 'vitest'
import { computeOverlap, deduplicateRoutes, selectRoutes, selectDefaultRoutes } from './routeSelection'
import type { LatLng } from './routeGeometry'
import type { CandidateRoute } from '../api/digitransit'
import type { OsmPoi } from './overpass'

function makeCandidate(
  polyline: LatLng[],
  durationSec: number = 600,
  distanceKm: number = 3,
): CandidateRoute {
  return {
    response: { data: { plan: { itineraries: [{ duration: durationSec, legs: [] }] } } },
    durationSec,
    distanceKm,
    polyline,
  }
}

describe('computeOverlap', () => {
  it('returns 1.0 for identical polylines', () => {
    const poly: LatLng[] = [
      [60.17, 24.94],
      [60.171, 24.941],
      [60.172, 24.942],
      [60.173, 24.943],
    ]
    expect(computeOverlap(poly, poly)).toBe(1)
  })

  it('returns 0 for completely disjoint polylines', () => {
    const a: LatLng[] = [
      [60.17, 24.94],
      [60.171, 24.941],
    ]
    const b: LatLng[] = [
      [61.0, 25.5],
      [61.01, 25.51],
    ]
    expect(computeOverlap(a, b)).toBe(0)
  })

  it('returns partial overlap for intersecting polylines', () => {
    // First half shared, second half diverges
    const shared: LatLng[] = [
      [60.17, 24.94],
      [60.171, 24.941],
      [60.172, 24.942],
    ]
    const a: LatLng[] = [...shared, [60.173, 24.943], [60.174, 24.944]]
    const b: LatLng[] = [...shared, [60.173, 24.95], [60.174, 24.96]]
    const overlap = computeOverlap(a, b)
    expect(overlap).toBeGreaterThan(0.3)
    expect(overlap).toBeLessThan(0.9)
  })

  it('returns 0 for empty polyline A', () => {
    const b: LatLng[] = [[60.17, 24.94]]
    expect(computeOverlap([], b)).toBe(0)
  })
})

describe('deduplicateRoutes', () => {
  it('keeps all routes when they are distinct', () => {
    const a = makeCandidate([[60.17, 24.94], [60.18, 24.95]], 500)
    const b = makeCandidate([[61.0, 25.5], [61.1, 25.6]], 600)
    const result = deduplicateRoutes([a, b])
    expect(result).toHaveLength(2)
  })

  it('removes duplicates and keeps the faster one', () => {
    const poly: LatLng[] = [
      [60.17, 24.94],
      [60.171, 24.941],
      [60.172, 24.942],
    ]
    const slow = makeCandidate(poly, 800)
    const fast = makeCandidate(poly, 500)
    const result = deduplicateRoutes([slow, fast])
    expect(result).toHaveLength(1)
    expect(result[0].durationSec).toBe(500)
  })

  it('handles single candidate', () => {
    const c = makeCandidate([[60.17, 24.94]], 600)
    expect(deduplicateRoutes([c])).toHaveLength(1)
  })

  it('handles empty array', () => {
    expect(deduplicateRoutes([])).toHaveLength(0)
  })
})

describe('selectRoutes', () => {
  const parkPoi: OsmPoi = {
    lat: 60.171,
    lon: 24.941,
    category: 'park',
    tags: { leisure: 'park' },
  }
  const cyclewayPoi: OsmPoi = {
    lat: 60.18,
    lon: 24.96,
    category: 'cycleway_separated',
    tags: { highway: 'cycleway' },
  }

  it('assigns fastest to the route with lowest duration', () => {
    const fast = makeCandidate([[60.17, 24.94], [60.175, 24.945]], 300)
    const slow = makeCandidate([[61.0, 25.5], [61.05, 25.55]], 900)
    const result = selectRoutes([fast, slow], [])
    expect(result.fastest.durationSec).toBe(300)
  })

  it('assigns scenic to the route nearest scenic POIs', () => {
    // Route A passes near the park POI
    const nearPark = makeCandidate(
      [[60.17, 24.94], [60.171, 24.941], [60.172, 24.942]],
      600,
    )
    // Route B is far from the park
    const farFromPark = makeCandidate(
      [[60.20, 25.0], [60.21, 25.01], [60.22, 25.02]],
      500,
    )
    const result = selectRoutes([nearPark, farFromPark], [parkPoi])
    expect(result.scenic.scenicScore).toBeGreaterThan(0)
  })

  it('assigns calm to the route nearest cycling infrastructure', () => {
    // Route near cycleway
    const nearCycleway = makeCandidate(
      [[60.18, 24.96], [60.181, 24.961]],
      700,
    )
    // Route far from cycleway
    const farFromCycleway = makeCandidate(
      [[60.10, 24.80], [60.11, 24.81]],
      500,
    )
    const result = selectRoutes([nearCycleway, farFromCycleway], [cyclewayPoi])
    expect(result.calm.infraScore).toBeGreaterThan(0)
  })

  it('handles a single candidate by assigning it to all categories', () => {
    const only = makeCandidate([[60.17, 24.94]], 600)
    const result = selectRoutes([only], [])
    expect(result.fastest.durationSec).toBe(600)
    expect(result.scenic.durationSec).toBe(600)
    expect(result.calm.durationSec).toBe(600)
  })

  it('throws on empty candidate array', () => {
    expect(() => selectRoutes([], [])).toThrow('No candidate routes available')
  })

  it('returns all three categories', () => {
    const a = makeCandidate([[60.17, 24.94]], 500)
    const b = makeCandidate([[60.18, 24.95]], 600)
    const result = selectRoutes([a, b], [])
    expect(result).toHaveProperty('fastest')
    expect(result).toHaveProperty('scenic')
    expect(result).toHaveProperty('calm')
  })
})

describe('selectDefaultRoutes', () => {
  const signalPoi: OsmPoi = {
    lat: 60.171,
    lon: 24.941,
    category: 'traffic_signal',
    tags: { highway: 'traffic_signals' },
  }

  it('returns only fewestLights and fastest', () => {
    const a = makeCandidate([[60.17, 24.94], [60.175, 24.945]], 500)
    const b = makeCandidate([[60.18, 24.95], [60.185, 24.955]], 600)
    const result = selectDefaultRoutes([a, b], [])
    expect(Object.keys(result).sort()).toEqual(['fastest', 'fewestLights'])
  })

  it('assigns fastest to the route with lowest duration', () => {
    const fast = makeCandidate([[60.17, 24.94], [60.175, 24.945]], 300)
    const slow = makeCandidate([[61.0, 25.5], [61.05, 25.55]], 900)
    const result = selectDefaultRoutes([fast, slow], [])
    expect(result.fastest.durationSec).toBe(300)
  })

  it('picks the signal-free route as fewest lights', () => {
    // Fast route passes through the signal; the slower route avoids it entirely.
    const throughSignal = makeCandidate(
      [[60.17, 24.94], [60.171, 24.941], [60.172, 24.942]],
      300,
    )
    const noSignal = makeCandidate(
      [[60.20, 25.0], [60.21, 25.01], [60.22, 25.02]],
      900,
    )
    const result = selectDefaultRoutes([throughSignal, noSignal], [signalPoi])
    expect(result.fastest.durationSec).toBe(300)
    expect(result.fewestLights.durationSec).toBe(900)
    expect(result.fewestLights.lightCount).toBe(0)
  })

  it('handles a single candidate by assigning it to both categories', () => {
    const only = makeCandidate([[60.17, 24.94]], 600)
    const result = selectDefaultRoutes([only], [])
    expect(result.fastest.durationSec).toBe(600)
    expect(result.fewestLights.durationSec).toBe(600)
  })

  it('throws on empty candidate array', () => {
    expect(() => selectDefaultRoutes([], [])).toThrow('No candidate routes available')
  })
})
