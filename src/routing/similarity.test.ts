// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from './config'
import { buildShape, distinctLengthM, isDistinct } from './similarity'
import { line } from './testHelpers'

const cfg = DEFAULT_CONFIG

/** A route along y = 0 that detours `offset` metres sideways over [from, to]. */
const detour = (length: number, from: number, to: number, offset: number) =>
  buildShape(line([[0, 0], [from, 0], [from, offset], [to, offset], [to, 0], [length, 0]]))

describe('distinctLengthM', () => {
  it('is zero for the same route', () => {
    const a = buildShape(line([[0, 0], [1000, 0]]))
    expect(distinctLengthM(a, [a], cfg.similarity.tolM)).toBe(0)
  })

  it('counts metres farther than the tolerance from every other route', () => {
    const base = buildShape(line([[0, 0], [1000, 0]]))
    const other = detour(1000, 300, 700, 100)
    // the 400 m offset leg plus the stretches of the sideways legs beyond 25 m
    const distinct = distinctLengthM(other, [base], cfg.similarity.tolM)
    expect(distinct).toBeGreaterThan(500)
    expect(distinct).toBeLessThan(600)
  })

  it('treats a parallel street within the tolerance as the same route', () => {
    const base = buildShape(line([[0, 0], [1000, 0]]))
    const parallel = buildShape(line([[0, 20], [1000, 20]]))
    expect(distinctLengthM(parallel, [base], cfg.similarity.tolM)).toBe(0)
  })
})

describe('isDistinct', () => {
  const short = buildShape(line([[0, 0], [1500, 0]]))
  const long = buildShape(line([[0, 0], [10_000, 0]]))

  it('treats any route as distinct when nothing is shown', () => {
    expect(isDistinct(short, [], cfg)).toBe(true)
  })

  it('needs at least 400 m of difference on a short trip', () => {
    expect(isDistinct(detour(1500, 600, 800, 100), [short], cfg)).toBe(false) // ~350 m differs
    expect(isDistinct(detour(1500, 400, 1000, 100), [short], cfg)).toBe(true) // ~750 m differs
  })

  it('needs 20 % of the length on a long trip', () => {
    expect(isDistinct(detour(10_000, 4000, 5500, 200), [long], cfg)).toBe(false) // ~1.85 km of 10.3
    expect(isDistinct(detour(10_000, 3000, 6000, 200), [long], cfg)).toBe(true) // ~3.35 km of 10.4
  })
})
