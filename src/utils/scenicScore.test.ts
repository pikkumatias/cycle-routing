import { describe, it, expect } from 'vitest'
import {
  haversineDistance,
  minDistanceToPolyline,
  scorePoisNearRoute,
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
    { lat: 60.1701, lon: 24.9401, tags: { leisure: 'park' } }, // very close
    { lat: 60.175, lon: 24.945, tags: { leisure: 'park' } }, // on the route
    { lat: 60.2, lon: 25.0, tags: { natural: 'water' } }, // far away
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
