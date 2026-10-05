// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  GridIndex,
  bearingDeg,
  hashGeometry,
  haversineDistance,
  lineAngleDiff,
  nearestOnPolyline,
  polylineLength,
  resample,
  segmentIntersection,
  toLocal,
} from './geo'
import { at, line } from './testHelpers'

describe('haversineDistance', () => {
  it('is zero for the same point', () => {
    expect(haversineDistance(at(0, 0), at(0, 0))).toBe(0)
  })

  it('matches metre offsets within 0.5 %', () => {
    expect(haversineDistance(at(0, 0), at(300, 400))).toBeCloseTo(500, -1)
  })
})

describe('toLocal', () => {
  it('inverts the metre offset used to build the point', () => {
    const [x, y] = toLocal(at(120, -80), at(0, 0))
    expect(x).toBeCloseTo(120, 0)
    expect(y).toBeCloseTo(-80, 0)
  })
})

describe('resample', () => {
  it('emits evenly spaced points and keeps both ends', () => {
    const poly = line([[0, 0], [95, 0]], 50)
    const pts = resample(poly, 10)
    expect(pts).toHaveLength(11) // 0,10,…,90 and the end at 95
    expect(haversineDistance(pts[1], pts[2])).toBeCloseTo(10, 0)
    expect(pts[pts.length - 1]).toEqual(poly[poly.length - 1])
  })

  it('carries spacing across vertices', () => {
    const pts = resample(line([[0, 0], [15, 0], [15, 15]], 15), 10)
    expect(pts).toHaveLength(4) // at 0, 10, 20 (5 m up the second leg), end at 30
    expect(haversineDistance(pts[2], at(15, 5))).toBeLessThan(0.5)
  })
})

describe('nearestOnPolyline', () => {
  it('returns perpendicular distance and distance travelled', () => {
    const poly = line([[0, 0], [100, 0], [100, 100]], 100)
    const hit = nearestOnPolyline(at(100 + 4, 60), poly)
    expect(hit.distanceM).toBeCloseTo(4, 0)
    expect(hit.alongM).toBeCloseTo(160, 0)
    expect(hit.segment).toBe(1)
  })

  it('handles empty and single-point polylines', () => {
    expect(nearestOnPolyline(at(0, 0), []).distanceM).toBe(Infinity)
    expect(nearestOnPolyline(at(3, 4), [at(0, 0)]).distanceM).toBeCloseTo(5, 0)
  })
})

describe('segmentIntersection', () => {
  it('finds the crossing point of two crossing segments', () => {
    const hit = segmentIntersection(at(0, -10), at(0, 10), at(-10, 0), at(10, 0))
    expect(hit).not.toBeNull()
    expect(hit!.t).toBeCloseTo(0.5, 3)
    expect(haversineDistance(hit!.point, at(0, 0))).toBeLessThan(0.1)
  })

  it('ignores segments that only touch at an endpoint or are parallel', () => {
    expect(segmentIntersection(at(0, 0), at(0, 10), at(0, 0), at(10, 0))).toBeNull()
    expect(segmentIntersection(at(0, 0), at(10, 0), at(0, 5), at(10, 5))).toBeNull()
  })
})

describe('bearings', () => {
  it('measures compass bearing', () => {
    expect(bearingDeg(at(0, 0), at(0, 10))).toBeCloseTo(0, 0)
    expect(bearingDeg(at(0, 0), at(10, 0))).toBeCloseTo(90, 0)
  })

  it('compares lines regardless of direction', () => {
    expect(lineAngleDiff(10, 190)).toBe(0)
    expect(lineAngleDiff(0, 100)).toBe(80)
  })
})

describe('GridIndex', () => {
  it('returns items within the radius and skips far ones', () => {
    const index = new GridIndex<string>(50)
    index.insert('near', [at(30, 0)])
    index.insert('far', [at(500, 0)])
    index.insert('segment', [at(-200, 40), at(200, 40)])
    const found = index.near(at(0, 0), 60)
    expect(found).toContain('near')
    expect(found).toContain('segment')
    expect(found).not.toContain('far')
  })
})

describe('hashGeometry', () => {
  it('gives the same id for the same path split into legs', () => {
    const poly = line([[0, 0], [200, 0], [200, 200]])
    const split = [poly.slice(0, 11), poly.slice(10)] // shared via point repeated
    expect(hashGeometry(split)).toBe(hashGeometry([poly]))
  })

  it('differs for different paths', () => {
    expect(hashGeometry([line([[0, 0], [200, 0]])])).not.toBe(hashGeometry([line([[0, 0], [0, 200]])]))
  })
})

describe('polylineLength', () => {
  it('sums segment lengths', () => {
    expect(polylineLength(line([[0, 0], [100, 0], [100, 50]]))).toBeCloseTo(150, 0)
  })
})
