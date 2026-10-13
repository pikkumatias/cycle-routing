// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from './config'
import { trimSpur } from './spur'
import { line, pathStep, step } from './testHelpers'

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

  it('takes a stub spanning several steps off all of them, so later steps stay aligned', () => {
    // The 60 m stub is two short steps on each side of the via point (30 m + 40 m)
    const legs = [line([[0, 0], [500, 0], [500, 60]]), line([[500, 60], [500, 0], [1000, 0]])]
    const multi = [
      [pathStep(500), step(40, 'Umpikuja'), step(30, 'Pätkä')],
      [step(30, 'Pätkä'), step(40, 'Umpikuja'), pathStep(500)],
    ]
    const result = trimSpur(legs, multi, DEFAULT_CONFIG)!
    expect(result.legSteps[0].map((s) => Math.round(s.distance))).toEqual([500, 10, 0])
    expect(result.legSteps[1].map((s) => Math.round(s.distance))).toEqual([0, 10, 500])
    // Steps add up to the trimmed geometry again
    const total = result.legSteps.flat().reduce((sum, s) => sum + s.distance, 0)
    expect(total).toBeCloseTo(500 + 10 + 10 + 500, 0)
  })

  it('trims the stub out of the elevation profiles too', () => {
    const legs = [line([[0, 0], [500, 0], [500, 60]]), line([[500, 60], [500, 0], [1000, 0]])]
    const withElevation = (s: ReturnType<typeof pathStep>) => ({
      ...s,
      elevation: Array.from({ length: s.distance / 10 + 1 }, (_, i) => [i * 10, i] as [number, number]),
    })
    const elevSteps = [[pathStep(500), withElevation(pathStep(100))], [withElevation(pathStep(100)), pathStep(500)]]
    const result = trimSpur(legs, elevSteps, DEFAULT_CONFIG)!
    // 60 m off the end of leg 1's last step and the start of leg 2's first step
    expect(result.legSteps[0][1].elevation!.at(-1)![0]).toBeLessThanOrEqual(40)
    expect(result.legSteps[1][0].elevation![0][0]).toBeCloseTo(0, 0)
    expect(result.legSteps[1][0].elevation![0][1]).toBe(6) // the point that was 60 m in
  })
})

