// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { climbM } from './elevation'
import { pathStep } from './testHelpers'
import type { OtpStep } from './types'

/** One step of `lengthM` whose elevation follows `f` every 10 m. */
const profiled = (lengthM: number, f: (m: number) => number): OtpStep => ({
  ...pathStep(lengthM),
  elevation: Array.from({ length: lengthM / 10 + 1 }, (_, i) => [i * 10, f(i * 10)] as [number, number]),
})

describe('climbM', () => {
  it('is 0 without elevation data', () => {
    expect(climbM([pathStep(500)])).toBe(0)
  })

  it('measures a steady climb', () => {
    // The averaging window trims a little off each end
    const climb = climbM([profiled(1000, (m) => m / 50)])
    expect(climb).toBeGreaterThan(18.5)
    expect(climb).toBeLessThanOrEqual(20)
  })

  it('ignores a descent', () => {
    expect(climbM([profiled(1000, (m) => 20 - m / 50)])).toBe(0)
  })

  it('ignores metre-scale noise on flat ground', () => {
    // ±1 m jitter every 10 m, as the elevation model gives on a flat street
    expect(climbM([profiled(2000, (m) => 5 + ((m / 10) % 2 === 0 ? 1 : -1))])).toBeLessThan(0.5)
  })

  it('follows the profile across steps, each measured from its own start', () => {
    const up = profiled(500, (m) => m / 50) // 0 → 10 m
    const upMore = profiled(500, (m) => 10 + m / 50) // 10 → 20 m
    const climb = climbM([up, upMore])
    expect(climb).toBeGreaterThan(18.5)
    expect(climb).toBeLessThanOrEqual(20)
  })
})
