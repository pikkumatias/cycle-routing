// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from './config'
import { calmBand, calmIndex, profileRoute, routePolyline } from './profile'
import { at, line, makeCandidate, makeLayers, pathStep, step, type TestRoad } from './testHelpers'
import type { OtpStep } from './types'

/** 1 km due east along y = 0. */
const EAST_1KM = line([[0, 0], [1000, 0]])

const profile = (layers: ReturnType<typeof makeLayers>, steps: OtpStep[] = [pathStep(1000)], poly = EAST_1KM) =>
  profileRoute(makeCandidate('r', [poly], 300, [steps]), layers, DEFAULT_CONFIG)

/** A north–south major road crossing the route at x. */
const crossRoad = (x: number, extra: Partial<TestRoad> = {}): TestRoad => ({
  cls: 'secondary',
  name: 'Poikkikatu',
  points: [[x, -300], [x, 300]],
  ...extra,
})

describe('routePolyline', () => {
  it('joins legs without repeating the shared via point', () => {
    const legs = [line([[0, 0], [100, 0]]), line([[100, 0], [100, 100]])]
    expect(routePolyline(legs)).toHaveLength(legs[0].length + legs[1].length - 1)
  })
})

describe('signal stops', () => {
  it('counts a signal node the route passes through', () => {
    const p = profile(makeLayers({ signals: [[500, 1]] }))
    expect(p.lights).toBe(1)
    expect(p.signalStops[0].rule).toBe('on')
  })

  it('merges the nodes of one junction into a single stop', () => {
    expect(profile(makeLayers({ signals: [[500, 1], [510, -2], [530, 2]] })).lights).toBe(1)
  })

  it('counts junctions 100 m apart separately', () => {
    expect(profile(makeLayers({ signals: [[300, 0], [400, 0]] })).lights).toBe(2)
  })

  it('ignores a signal beside the route that it never crosses', () => {
    expect(profile(makeLayers({ signals: [[500, 10]] })).lights).toBe(0)
  })

  it('counts crossing a major road next to one of its signals', () => {
    const p = profile(makeLayers({ roads: [crossRoad(600, { signals: [[600, 12]] })] }))
    expect(p.lights).toBe(1)
    expect(p.signalStops[0].rule).toBe('cross')
    expect(p.majorCrossings).toBe(0)
  })

  it('counts a crossing of an unsignalised major road, not a light', () => {
    const p = profile(makeLayers({ roads: [crossRoad(600)] }))
    expect(p.lights).toBe(0)
    expect(p.majorCrossings).toBe(1)
  })

  it('ignores grade-separated major roads', () => {
    const p = profile(makeLayers({ roads: [crossRoad(600, { grade: 'bridge', signals: [[600, 12]] })] }))
    expect(p.lights).toBe(0)
    expect(p.majorCrossings).toBe(0)
  })

  it('ignores the road and signals below while the route is on a bridge', () => {
    const layers = makeLayers({
      roads: [crossRoad(600, { signals: [[600, 2]] })],
      gradeSeparated: [[[550, 0], [650, 0]]],
    })
    const p = profile(layers)
    expect(p.lights).toBe(0)
    expect(p.majorCrossings).toBe(0)
  })

  it('counts signals near the route only where it crosses an open area', () => {
    const layers = makeLayers({ signals: [[500, 10]] })
    const steps = [pathStep(400), step(200, 'open area', { bogusName: true, area: true }), pathStep(400)]
    const p = profile(layers, steps)
    expect(p.lights).toBe(1)
    expect(p.signalStops[0].rule).toBe('near')
  })

  it('places a stop between its nodes and at the first hit along the route', () => {
    const p = profile(makeLayers({ signals: [[500, 2], [520, -2]] }))
    const [stop] = p.signalStops
    expect(stop.alongM).toBeCloseTo(500, -1)
    const mid = at(510, 0)
    expect(stop.at[0]).toBeCloseTo(mid[0], 5)
    expect(stop.at[1]).toBeCloseTo(mid[1], 5)
  })
})

describe('traffic stress', () => {
  const alongRoad = (extra: Partial<TestRoad>): TestRoad => ({ cls: 'primary', name: 'Isotie', points: [[-100, 0], [1100, 0]], ...extra })
  const onRoadSteps = [step(1000, 'Isotie')]

  it('rates a car-free path away from roads as fully calm', () => {
    const p = profile(makeLayers({}))
    expect(p.stressM.away).toBeCloseTo(1000, -1)
    expect(p.calmIndex).toBe(100)
    expect(p.calmBand).toBe('veryCalm')
  })

  it('rates a separated path beside a major road as adjacent', () => {
    const p = profile(makeLayers({ roads: [alongRoad({ points: [[-100, 12], [1100, 12]] })] }))
    expect(p.stressM.adjacent).toBeCloseTo(1000, -1)
    expect(p.calmIndex).toBe(65)
  })

  it('rates riding on a major road as mixed traffic', () => {
    const p = profile(makeLayers({ roads: [alongRoad({})] }), onRoadSteps)
    expect(p.stressM.mixedHigh).toBeCloseTo(1000, -1)
    expect(p.calmIndex).toBe(0)
    expect(p.calmBand).toBe('busy')
  })

  it('rates a painted lane or a 30 km/h limit as lower-stress mixed traffic', () => {
    expect(profile(makeLayers({ roads: [alongRoad({ bikeLane: true })] }), onRoadSteps).stressM.mixedLow).toBeCloseTo(1000, -1)
    expect(profile(makeLayers({ roads: [alongRoad({ maxspeed: 30 })] }), onRoadSteps).calmIndex).toBe(40)
  })

  it('rates tram streets as high stress even with a painted lane', () => {
    const p = profile(makeLayers({ roads: [alongRoad({ bikeLane: true, tram: true })] }), onRoadSteps)
    expect(p.stressM.mixedHigh).toBeCloseTo(1000, -1)
  })

  it('rates other named streets as quiet', () => {
    const p = profile(makeLayers({}), [step(1000, 'Pikkukatu')])
    expect(p.stressM.quiet).toBeCloseTo(1000, -1)
    expect(p.calmIndex).toBe(85)
  })

  it('treats a track named after the major road next to it as adjacent', () => {
    const p = profile(makeLayers({ roads: [alongRoad({ points: [[-100, 12], [1100, 12]] })] }), onRoadSteps)
    expect(p.stressM.adjacent).toBeCloseTo(1000, -1)
  })

  it('maps steps onto the route by distance travelled', () => {
    const p = profile(makeLayers({}), [pathStep(500), step(500, 'Pikkukatu')])
    expect(p.stressM.away).toBeCloseTo(500, -1)
    expect(p.stressM.quiet).toBeCloseTo(500, -1)
  })

  it('counts metres walked with the bike', () => {
    const p = profile(makeLayers({}), [pathStep(800), step(200, 'stairs', { bogusName: true, walkingBike: true })])
    expect(p.walkM).toBeCloseTo(200, -1)
  })

  it('penalises unsignalised major crossings in the calm index', () => {
    // 50 m crossing penalty + the 40 m of path within 20 m of the road counted as adjacent
    expect(profile(makeLayers({ roads: [crossRoad(600)] })).calmIndex).toBe(94)
  })
})

describe('calmIndex', () => {
  const none = { away: 0, quiet: 0, adjacent: 0, mixedLow: 0, mixedHigh: 0 }

  it('is absolute: depends only on the route', () => {
    expect(calmIndex({ ...none, away: 500, quiet: 500 }, 0, 1000, DEFAULT_CONFIG)).toBe(93)
  })

  it('is clamped to 0–100', () => {
    expect(calmIndex({ ...none, mixedHigh: 1000 }, 10, 1000, DEFAULT_CONFIG)).toBe(0)
    expect(calmIndex(none, 0, 0, DEFAULT_CONFIG)).toBe(100)
  })

  it('maps to bands', () => {
    expect(calmBand(90, DEFAULT_CONFIG)).toBe('veryCalm')
    expect(calmBand(70, DEFAULT_CONFIG)).toBe('calm')
    expect(calmBand(55, DEFAULT_CONFIG)).toBe('mixed')
    expect(calmBand(10, DEFAULT_CONFIG)).toBe('busy')
  })
})
