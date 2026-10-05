// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from './config'
import { trimSpur } from './spur'
import { line, pathStep } from './testHelpers'

const steps = [[pathStep(500), pathStep(100)], [pathStep(100), pathStep(500)]]

describe('trimSpur', () => {
  it('leaves single-leg routes alone', () => {
    const legs = [line([[0, 0], [500, 0]])]
    expect(trimSpur(legs, [[pathStep(500)]], DEFAULT_CONFIG)).toEqual({ legs, legSteps: [[pathStep(500)]], trimmedM: 0 })
  })

  it('leaves via routes without a stub alone', () => {
    const legs = [line([[0, 0], [500, 0]]), line([[500, 0], [500, 500]])]
    expect(trimSpur(legs, steps, DEFAULT_CONFIG)?.trimmedM).toBe(0)
  })

  it('removes an out-and-back stub to the via point and shortens the steps around it', () => {
    // East 500 m, up a 60 m dead end to the via point, back down, then on east
    const legs = [line([[0, 0], [500, 0], [500, 60]]), line([[500, 60], [500, 0], [1000, 0]])]
    const result = trimSpur(legs, steps, DEFAULT_CONFIG)!
    expect(result.trimmedM).toBeCloseTo(60, 0)
    expect(result.legs[0][result.legs[0].length - 1]).toEqual(legs[0][50]) // back at (500, 0)
    expect(result.legs[1][0]).toEqual(legs[1][6])
    expect(result.legSteps[0][1].distance).toBeCloseTo(40, 0)
    expect(result.legSteps[1][0].distance).toBeCloseTo(40, 0)
  })

  it('rejects routes whose stub is longer than the limit', () => {
    const legs = [line([[0, 0], [500, 0], [500, 200]]), line([[500, 200], [500, 0], [1000, 0]])]
    expect(trimSpur(legs, steps, DEFAULT_CONFIG)).toBeNull()
  })
})
