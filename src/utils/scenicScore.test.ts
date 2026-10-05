import { describe, it, expect } from 'vitest'
import {
  haversineDistance,
  minDistanceToPolyline,
  scorePoisNearRoute,
  findSignalStops,
  samplePolyline,
} from './scenicScore'
import type { LatLng } from './routeGeometry'
import type { OsmPoi } from './overpass'

describe('haversineDistance', () => {
  it('returns 0 for the same point', () => {
    const p: LatLng = [60.17, 24.94]
    expect(haversineDistance(p, p)).toBe(0)
  })

  it('calculates roughly 1 km between two known points', () => {
    // ~1 km apart in Helsinki
    const a: LatLng = [60.17, 24.94]
    const b: LatLng = [60.17, 24.957]
    const dist = haversineDistance(a, b)
    expect(dist).toBeGreaterThan(900)
    expect(dist).toBeLessThan(1100)
  })

  it('is symmetric', () => {
    const a: LatLng = [60.17, 24.94]
    const b: LatLng = [60.18, 24.95]
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 5)
  })
})

describe('minDistanceToPolyline', () => {
  const polyline: LatLng[] = [
    [60.17, 24.94],
    [60.171, 24.941],
    [60.172, 24.942],
  ]

  it('returns 0 for a point on the polyline', () => {
    expect(minDistanceToPolyline([60.17, 24.94], polyline)).toBe(0)
  })

  it('returns a short distance for a nearby point', () => {
    // Slightly offset from the first vertex
    const dist = minDistanceToPolyline([60.1701, 24.94], polyline)
    expect(dist).toBeGreaterThan(0)
    expect(dist).toBeLessThan(50)
  })

  it('returns Infinity for an empty polyline', () => {
    expect(minDistanceToPolyline([60.17, 24.94], [])).toBe(Infinity)
  })
})

describe('scorePoisNearRoute', () => {
  const polyline: LatLng[] = [
    [60.17, 24.94],
    [60.175, 24.945],
    [60.18, 24.95],
  ]

  const pois: OsmPoi[] = [
    { lat: 60.1701, lon: 24.9401, tags: { leisure: 'park' }, category: 'park' }, // very close
    { lat: 60.175, lon: 24.945, tags: { leisure: 'park' }, category: 'park' }, // on the route
    { lat: 60.2, lon: 25.0, tags: { natural: 'water' }, category: 'water' }, // far away
  ]

  it('counts nearby POIs within the threshold', () => {
    const result = scorePoisNearRoute(pois, polyline, 150)
    expect(result.count).toBe(2)
    expect(result.nearbyPois).toHaveLength(2)
  })

  it('returns 0 when no POIs are near', () => {
    const farPois: OsmPoi[] = [{ lat: 61.0, lon: 25.0 }]
    const result = scorePoisNearRoute(farPois, polyline, 150)
    expect(result.count).toBe(0)
  })

  it('respects the threshold parameter', () => {
    // With a very small threshold, only the point exactly on the route matches
    const result = scorePoisNearRoute(pois, polyline, 1)
    expect(result.count).toBe(1)
    expect(result.nearbyPois[0].lat).toBe(60.175)
  })
})

describe('findSignalStops', () => {
  const LAT0 = 60.17
  const LON0 = 24.93
  const M_PER_DEG_LAT = 111_320
  const M_PER_DEG_LON = 111_320 * Math.cos((LAT0 * Math.PI) / 180)
  /** Point `east` / `north` metres from the origin. */
  const at = (east: number, north: number): [number, number] => [
    LAT0 + north / M_PER_DEG_LAT,
    LON0 + east / M_PER_DEG_LON,
  ]
  const signal = (east: number, north: number): OsmPoi => {
    const [lat, lon] = at(east, north)
    return { lat, lon, category: 'traffic_signal' }
  }
  // 1 km due east with a vertex every 10 m
  const straight = Array.from({ length: 101 }, (_, i) => at(i * 10, 0))

  it('counts nothing on a route without signals', () => {
    expect(findSignalStops([], straight)).toEqual([])
  })

  it('merges the signal nodes of one junction into a single stop', () => {
    const junction = [signal(500, 0), signal(510, 8), signal(520, -8), signal(530, 0)]
    expect(findSignalStops(junction, straight)).toHaveLength(1)
  })

  it('counts two junctions 100 m apart as two stops', () => {
    expect(findSignalStops([signal(300, 0), signal(400, 0)], straight)).toHaveLength(2)
  })

  it('ignores signals on a parallel street 30 m away', () => {
    expect(findSignalStops([signal(500, 30)], straight)).toHaveLength(0)
  })

  it('finds a signal at a turn that every-3rd-vertex sampling would cut off', () => {
    // East 100 m, then north 100 m; the corner vertex is index 10
    const lShape = [
      ...Array.from({ length: 11 }, (_, i) => at(i * 10, 0)),
      ...Array.from({ length: 10 }, (_, i) => at(100, (i + 1) * 10)),
    ]
    const cornerSignal = signal(103, -3)
    expect(findSignalStops([cornerSignal], lShape)).toHaveLength(1)
    // The old scorer measured against samplePolyline(…, 3), which skips the corner
    const sampled = samplePolyline(lShape, 3)
    expect(sampled.some(([lat, lon]) => lat === lShape[10][0] && lon === lShape[10][1])).toBe(false)
  })

  it('does not depend on the order of the input nodes', () => {
    const nodes = [signal(530, 0), signal(300, 2), signal(500, 0), signal(700, -4), signal(515, 5)]
    const forward = findSignalStops(nodes, straight).length
    const reversed = findSignalStops([...nodes].reverse(), straight).length
    expect(forward).toBe(3)
    expect(reversed).toBe(forward)
  })

  it('places each stop at the centroid of its nodes', () => {
    const [stop] = findSignalStops([signal(500, 4), signal(520, -4)], straight)
    const [lat, lon] = at(510, 0)
    expect(stop.lat).toBeCloseTo(lat, 6)
    expect(stop.lon).toBeCloseTo(lon, 6)
  })
})
