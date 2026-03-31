import { describe, it, expect } from 'vitest'
import polylineLib from '@mapbox/polyline'
import {
  decodePolyline,
  estimateBboxFromEndpoints,
  getBoundsFromLegsAndPoints,
  type LatLng,
  type RouteLeg,
} from './routeGeometry'

// ── decodePolyline ────────────────────────────────────────────────────────────

describe('decodePolyline', () => {
  it('decodes a valid encoded polyline', () => {
    const points: LatLng[] = [[60.1699, 24.9384], [60.192, 24.9451]]
    const encoded = polylineLib.encode(points as [number, number][])
    const decoded = decodePolyline(encoded)

    expect(decoded).toHaveLength(2)
    expect(decoded[0][0]).toBeCloseTo(points[0][0], 3)
    expect(decoded[0][1]).toBeCloseTo(points[0][1], 3)
    expect(decoded[1][0]).toBeCloseTo(points[1][0], 3)
    expect(decoded[1][1]).toBeCloseTo(points[1][1], 3)
  })

  it('returns empty array for an empty string', () => {
    expect(decodePolyline('')).toEqual([])
  })

  it('returns empty array for undefined input', () => {
    expect(decodePolyline(undefined as unknown as string)).toEqual([])
  })

  it('returns empty array for a non-string input', () => {
    expect(decodePolyline(null as unknown as string)).toEqual([])
  })

  it('returns empty array for a malformed encoded string', () => {
    // Should not throw — the try/catch in decodePolyline handles errors
    expect(() => decodePolyline('!!!invalid!!!')).not.toThrow()
  })
})

// ── estimateBboxFromEndpoints ─────────────────────────────────────────────────

describe('estimateBboxFromEndpoints', () => {
  const from: LatLng = [60.0, 24.0]
  const to: LatLng = [60.1, 24.2]

  it('returns a 2-element bounds array', () => {
    const bounds = estimateBboxFromEndpoints(from, to)
    expect(bounds).toHaveLength(2)
  })

  it('extends south-west beyond the minimum coordinates', () => {
    const [[south, west]] = estimateBboxFromEndpoints(from, to)
    expect(south).toBeLessThan(Math.min(from[0], to[0]))
    expect(west).toBeLessThan(Math.min(from[1], to[1]))
  })

  it('extends north-east beyond the maximum coordinates', () => {
    const [, [north, east]] = estimateBboxFromEndpoints(from, to)
    expect(north).toBeGreaterThan(Math.max(from[0], to[0]))
    expect(east).toBeGreaterThan(Math.max(from[1], to[1]))
  })

  it('applies a minimum padding when from and to are the same point', () => {
    const same: LatLng = [60.17, 24.94]
    const [[south, west], [north, east]] = estimateBboxFromEndpoints(same, same)
    // Default minimum padding is 0.005 on each side → span is ~0.01 (floating point safe)
    expect(north - south).toBeCloseTo(0.01, 5)
    expect(east - west).toBeCloseTo(0.01, 5)
  })

  it('respects a custom paddingFraction', () => {
    const defaultBounds = estimateBboxFromEndpoints(from, to)
    const largePaddingBounds = estimateBboxFromEndpoints(from, to, 0.5)
    const defaultSpan = defaultBounds[1][0] - defaultBounds[0][0]
    const largeSpan = largePaddingBounds[1][0] - largePaddingBounds[0][0]
    expect(largeSpan).toBeGreaterThan(defaultSpan)
  })
})

// ── getBoundsFromLegsAndPoints ────────────────────────────────────────────────

describe('getBoundsFromLegsAndPoints', () => {
  it('returns empty array when given no legs and no markers', () => {
    expect(getBoundsFromLegsAndPoints([])).toHaveLength(0)
  })

  it('returns [[minLat, minLon], [maxLat, maxLon]] from leg positions', () => {
    const legs: RouteLeg[] = [{
      positions: [[60.0, 24.0], [60.1, 24.2], [60.05, 24.1]],
    }]
    const bounds = getBoundsFromLegsAndPoints(legs)
    expect(bounds).toHaveLength(2)
    expect(bounds[0]).toEqual([60.0, 24.0])
    expect(bounds[1]).toEqual([60.1, 24.2])
  })

  it('includes from and to markers when computing bounds', () => {
    const legs: RouteLeg[] = [{ positions: [[60.1, 24.1]] }]
    const from: LatLng = [59.9, 23.8]  // south-west outlier
    const to: LatLng = [60.3, 24.5]    // north-east outlier
    const bounds = getBoundsFromLegsAndPoints(legs, from, to)
    expect(bounds[0][0]).toBe(59.9)  // minLat from `from`
    expect(bounds[0][1]).toBe(23.8)  // minLon from `from`
    expect(bounds[1][0]).toBe(60.3)  // maxLat from `to`
    expect(bounds[1][1]).toBe(24.5)  // maxLon from `to`
  })

  it('works with multiple legs', () => {
    const legs: RouteLeg[] = [
      { positions: [[60.0, 24.0], [60.05, 24.05]] },
      { positions: [[60.1, 24.1], [60.15, 24.15]] },
    ]
    const bounds = getBoundsFromLegsAndPoints(legs)
    expect(bounds[0]).toEqual([60.0, 24.0])
    expect(bounds[1]).toEqual([60.15, 24.15])
  })
})
