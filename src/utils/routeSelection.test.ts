import { describe, it, expect } from 'vitest'
import { computeOverlap, deduplicateRoutes, selectCalmRoute, selectDefaultRoutes } from './routeSelection'
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

describe('selectCalmRoute', () => {
  const cyclewayPoi: OsmPoi = {
    lat: 60.18,
    lon: 24.96,
    category: 'cycleway_separated',
    tags: { highway: 'cycleway' },
  }

  it('picks the unshown route nearest cycling infrastructure', () => {
    const nearCycleway = makeCandidate([[60.18, 24.96], [60.181, 24.961]], 700)
    const farFromCycleway = makeCandidate([[60.10, 24.80], [60.11, 24.81]], 500)
    const result = selectCalmRoute([nearCycleway, farFromCycleway], [cyclewayPoi], [])
    expect(result?.durationSec).toBe(700)
    expect(result?.infraScore).toBeGreaterThan(0)
  })

  it('never returns a route that is already shown', () => {
    const nearCycleway = makeCandidate([[60.18, 24.96], [60.181, 24.961]], 700)
    const farFromCycleway = makeCandidate([[60.10, 24.80], [60.11, 24.81]], 500)
    const result = selectCalmRoute(
      [nearCycleway, farFromCycleway],
      [cyclewayPoi],
      [nearCycleway.response],
    )
    expect(result?.response).toBe(farFromCycleway.response)
  })

  it('returns null when every candidate is already shown', () => {
    const only = makeCandidate([[60.17, 24.94]], 600)
    expect(selectCalmRoute([only], [], [only.response])).toBeNull()
  })
})

describe('selectDefaultRoutes', () => {
  // Routes run due east along separate latitudes; signals sit on a route's line.
  const eastward = (lat: number): LatLng[] =>
    Array.from({ length: 21 }, (_, i) => [lat, 24.9 + i * 0.001] as LatLng)
  const signalsOn = (lat: number, count: number): OsmPoi[] =>
    Array.from({ length: count }, (_, i) => ({
      lat,
      lon: 24.901 + i * 0.004, // ~220 m apart → separate stops
      category: 'traffic_signal' as const,
      tags: { highway: 'traffic_signals' },
    }))

  it('returns only fewestLights and fastest', () => {
    const a = makeCandidate(eastward(60.17), 500)
    const b = makeCandidate(eastward(60.18), 600)
    const result = selectDefaultRoutes([a, b], [])
    expect(Object.keys(result).sort()).toEqual(['fastest', 'fewestLights'])
  })

  it('assigns fastest to the route with lowest duration', () => {
    const fast = makeCandidate(eastward(60.17), 300)
    const slow = makeCandidate(eastward(60.18), 900)
    expect(selectDefaultRoutes([fast, slow], []).fastest.durationSec).toBe(300)
  })

  it('picks a route that avoids at least two lights within the detour cap', () => {
    const fast = makeCandidate(eastward(60.17), 600)
    const calmer = makeCandidate(eastward(60.18), 700)
    const result = selectDefaultRoutes([fast, calmer], [...signalsOn(60.17, 4), ...signalsOn(60.18, 1)])
    expect(result.fastest.lightCount).toBe(4)
    expect(result.fewestLights.durationSec).toBe(700)
    expect(result.fewestLights.lightCount).toBe(1)
  })

  it('merges into fastest when only one light is saved', () => {
    const fast = makeCandidate(eastward(60.17), 600)
    const other = makeCandidate(eastward(60.18), 650)
    const result = selectDefaultRoutes([fast, other], [...signalsOn(60.17, 3), ...signalsOn(60.18, 2)])
    expect(result.fewestLights).toBe(result.fastest)
  })

  it('merges into fastest when fastest already has the fewest lights', () => {
    const fast = makeCandidate(eastward(60.17), 600)
    const other = makeCandidate(eastward(60.18), 650)
    const result = selectDefaultRoutes([fast, other], signalsOn(60.18, 3))
    expect(result.fewestLights).toBe(result.fastest)
  })

  it('ignores light-free routes beyond the +30 % detour cap', () => {
    const fast = makeCandidate(eastward(60.17), 1200) // cap = +360 s
    const tooSlow = makeCandidate(eastward(60.18), 1600)
    const result = selectDefaultRoutes([fast, tooSlow], signalsOn(60.17, 5))
    expect(result.fewestLights).toBe(result.fastest)
  })

  it('allows at least four extra minutes on short trips', () => {
    const fast = makeCandidate(eastward(60.17), 300) // 30 % = 90 s, floor = 240 s
    const detour = makeCandidate(eastward(60.18), 530)
    const result = selectDefaultRoutes([fast, detour], signalsOn(60.17, 3))
    expect(result.fewestLights.durationSec).toBe(530)
  })

  it('breaks ties in light count by duration', () => {
    const fast = makeCandidate(eastward(60.17), 600)
    const slower = makeCandidate(eastward(60.18), 700)
    const quicker = makeCandidate(eastward(60.19), 650)
    const result = selectDefaultRoutes([fast, slower, quicker], signalsOn(60.17, 4))
    expect(result.fewestLights.durationSec).toBe(650)
  })

  it('handles a single candidate by assigning it to both categories', () => {
    const only = makeCandidate([[60.17, 24.94]], 600)
    const result = selectDefaultRoutes([only], [])
    expect(result.fewestLights).toBe(result.fastest)
  })

  it('throws on empty candidate array', () => {
    expect(() => selectDefaultRoutes([], [])).toThrow('No candidate routes available')
  })
})
