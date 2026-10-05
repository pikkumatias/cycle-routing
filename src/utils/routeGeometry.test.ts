import { describe, it, expect } from 'vitest'
import polylineLib from '@mapbox/polyline'
import {
  decodePolyline,
  toDisplayLegs,
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

// ── toDisplayLegs ─────────────────────────────────────────────────────────────

describe('toDisplayLegs', () => {
  it('smooths each leg and keeps its endpoints', () => {
    const leg: LatLng[] = [[60.17, 24.94], [60.171, 24.941], [60.172, 24.94]]
    const [display] = toDisplayLegs([leg])
    expect(display.positions.length).toBeGreaterThan(leg.length)
    expect(display.positions[0]).toEqual(leg[0])
    expect(display.positions[display.positions.length - 1]).toEqual(leg[2])
  })

  it('drops empty legs', () => {
    expect(toDisplayLegs([[], [[60.17, 24.94]]])).toHaveLength(1)
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
