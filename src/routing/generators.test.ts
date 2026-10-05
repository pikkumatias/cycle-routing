// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from './config'
import { calmVias, geometricVias, lightsVias } from './generators'
import { haversineDistance } from './geo'
import { at, makeLayers, withProfile } from './testHelpers'
import type { LatLon } from './types'

const STRAIGHT: Array<[number, number]> = [[0, 0], [2000, 0]]
const stops = (...alongs: number[]) => alongs.map((alongM) => ({ at: at(alongM, 0), alongM, rule: 'on' as const }))
const dist = (via: LatLon | undefined, east: number, north: number) => haversineDistance([via!.lat, via!.lon], at(east, north))

describe('lightsVias', () => {
  const fastest = withProfile('fast', STRAIGHT, 600, { signalStops: stops(200, 900, 1000, 1100, 1150) })

  it('steers around the densest signal cluster via nearby calm-network nodes', () => {
    const layers = makeLayers({ calmNodes: [[1000, 320], [1020, -610], [200, 300]] })
    const vias = lightsVias(fastest, layers, DEFAULT_CONFIG)
    expect(vias).toHaveLength(2)
    expect(vias.every((v) => v.name === 'via:lights')).toBe(true)
    expect(dist(vias[0].via, 1000, 320)).toBeLessThan(1)
    expect(dist(vias[1].via, 1020, -610)).toBeLessThan(1)
  })

  it('centres on the tightest of equally dense stretches', () => {
    // 300–1100 and 800–1250 both hold four stops; the second is tighter (centre 1025 m)
    const spread = withProfile('fast', STRAIGHT, 600, { signalStops: stops(300, 800, 950, 1100, 1250) })
    const layers = makeLayers({ calmNodes: [[1025, 300], [700, 300]] })
    const [via] = lightsVias(spread, layers, DEFAULT_CONFIG)
    expect(dist(via.via, 1025, 300)).toBeLessThan(1)
  })

  it('skips calm nodes too close to the fastest route', () => {
    const layers = makeLayers({ calmNodes: [[1000, 100]] })
    expect(lightsVias(fastest, layers, DEFAULT_CONFIG)).toEqual([])
  })

  it('does nothing when the fastest route has fewer than two stops', () => {
    const lonely = withProfile('fast', STRAIGHT, 600, { signalStops: stops(500) })
    expect(lightsVias(lonely, makeLayers({ calmNodes: [[500, 300]] }), DEFAULT_CONFIG)).toEqual([])
  })
})

describe('calmVias', () => {
  const fastest = withProfile('fast', STRAIGHT, 600, {})

  it('snaps lateral targets onto calm-network nodes', () => {
    const layers = makeLayers({ calmNodes: [[1000, 310], [1000, -290]] })
    const vias = calmVias(at(0, 0), at(2000, 0), fastest, layers, DEFAULT_CONFIG)
    expect(vias).toHaveLength(2)
    expect(vias.every((v) => v.name === 'via:calm')).toBe(true)
  })

  it('drops waypoints whose straight-line detour exceeds the calm cap', () => {
    const cfg = { ...DEFAULT_CONFIG, caps: { ...DEFAULT_CONFIG.caps, calm: { frac: 0.05, minSec: 0 } } }
    const layers = makeLayers({ calmNodes: [[1000, 600]] })
    expect(calmVias(at(0, 0), at(2000, 0), fastest, layers, cfg)).toEqual([])
  })
})

describe('geometricVias', () => {
  it('returns twelve unsnapped lateral waypoints', () => {
    const vias = geometricVias(at(0, 0), at(2000, 0))
    expect(vias).toHaveLength(12)
    expect(dist(vias[0].via, 1000, -300) < 1 || dist(vias[0].via, 1000, 300) < 1).toBe(true)
  })
})
