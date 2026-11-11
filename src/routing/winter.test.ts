// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from './config'
import { profileRoute } from './profile'
import { line, makeCandidate, makeLayers, pathStep } from './testHelpers'

/** 1 km due east along y = 0. */
const EAST_1KM = line([[0, 0], [1000, 0]])

const winterM = (layers: ReturnType<typeof makeLayers>) =>
  profileRoute(makeCandidate('r', [EAST_1KM], 300, [[pathStep(1000)]]), layers, DEFAULT_CONFIG).winterM

describe('winter maintenance', () => {
  it('counts the metres ridden along a winter route, per kind', () => {
    const m = winterM(
      makeLayers({
        winter: [
          { kind: 'brush', points: [[0, 3], [400, 3]] },
          { kind: 'plough', points: [[600, -5], [1000, -5]] },
        ],
      }),
    )
    expect(m.brush).toBeGreaterThan(380)
    expect(m.brush).toBeLessThan(420)
    expect(m.plough).toBeGreaterThan(380)
    expect(m.plough).toBeLessThan(420)
  })

  it('does not count a winter route that is only crossed', () => {
    expect(winterM(makeLayers({ winter: [{ kind: 'brush', points: [[500, -300], [500, 300]] }] }))).toEqual({
      brush: 0,
      plough: 0,
    })
  })

  it('does not count a parallel winter route farther than the match distance', () => {
    const far = DEFAULT_CONFIG.winter.matchM + 5
    expect(winterM(makeLayers({ winter: [{ kind: 'plough', points: [[0, far], [1000, far]] }] })).plough).toBe(0)
  })

  it('counts brush-salting where both kinds overlap', () => {
    const m = winterM(
      makeLayers({
        winter: [
          { kind: 'plough', points: [[0, 2], [1000, 2]] },
          { kind: 'brush', points: [[0, -2], [1000, -2]] },
        ],
      }),
    )
    expect(m.plough).toBe(0)
    expect(m.brush).toBeGreaterThan(990)
  })

  it('is zero without winter data', () => {
    expect(winterM(makeLayers({}))).toEqual({ brush: 0, plough: 0 })
  })
})
