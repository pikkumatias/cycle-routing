import { describe, it, expect } from 'vitest'
import { fractionsAlongRoute, mostDistinctPoint } from './routeProgress'
import type { LatLng } from '../utils/routeGeometry'

// A straight line east along 60°N, ~1.1 km long
const line: LatLng[] = [
  [60, 24.0],
  [60, 24.01],
  [60, 24.02],
]

describe('fractionsAlongRoute', () => {
  it('places points by distance along the route', () => {
    const [start, middle, end] = fractionsAlongRoute([line], [[60, 24.0], [60, 24.01], [60, 24.02]])
    expect(start).toBeCloseTo(0, 3)
    expect(middle).toBeCloseTo(0.5, 3)
    expect(end).toBeCloseTo(1, 3)
  })

  it('projects off-route points onto the nearest segment', () => {
    const [f] = fractionsAlongRoute([line], [[60.0005, 24.005]])
    expect(f).toBeCloseTo(0.25, 2)
  })

  it('treats legs as one continuous route', () => {
    const [f] = fractionsAlongRoute([line.slice(0, 2), line.slice(1)], [[60, 24.015]])
    expect(f).toBeCloseTo(0.75, 2)
  })

  it('returns nothing for an empty route', () => {
    expect(fractionsAlongRoute([], [[60, 24]])).toEqual([])
  })
})

describe('mostDistinctPoint', () => {
  it('picks the point farthest from the reference route', () => {
    // A detour north in the middle of the line
    const detour: LatLng[] = [
      [60, 24.0],
      [60, 24.008],
      [60.005, 24.01],
      [60, 24.012],
      [60, 24.02],
    ]
    const at = mostDistinctPoint([detour], [line])!
    expect(at[0]).toBeGreaterThan(60.004)
    expect(at[1]).toBeCloseTo(24.01, 2)
  })

  it('falls back to the midpoint when routes overlap', () => {
    const at = mostDistinctPoint([line], [line])!
    expect(at[1]).toBeCloseTo(24.01, 2)
  })

  it('returns null for an empty route', () => {
    expect(mostDistinctPoint([], [line])).toBeNull()
  })
})
