import { describe, it, expect } from 'vitest'
import { exposureRuns, exposureShares } from './exposure'

describe('exposureShares', () => {
  it('groups stress classes into buckets, calmest first, with whole percentages summing to 100', () => {
    const shares = exposureShares({ away: 620, quiet: 250, adjacent: 0, mixedLow: 50, mixedHigh: 80 })
    expect(shares).toEqual([
      { bucket: 'carFree', percent: 62 },
      { bucket: 'quiet', percent: 25 },
      { bucket: 'traffic', percent: 13 },
    ])
  })

  it('keeps the total at 100 when rounding would not', () => {
    const shares = exposureShares({ away: 1, quiet: 1, adjacent: 1, mixedLow: 0, mixedHigh: 0 })
    expect(shares.reduce((sum, s) => sum + s.percent, 0)).toBe(100)
  })

  it('is empty for a route of no length', () => {
    expect(exposureShares({ away: 0, quiet: 0, adjacent: 0, mixedLow: 0, mixedHigh: 0 })).toEqual([])
  })
})

describe('exposureRuns', () => {
  it('turns stress runs into bucket stretches as fractions of the route, merging neighbours', () => {
    const runs = exposureRuns([
      [200, 'away'],
      [500, 'mixedLow'],
      [600, 'mixedHigh'],
      [1000, 'quiet'],
    ])
    expect(runs).toEqual([
      { bucket: 'carFree', from: 0, to: 0.2 },
      { bucket: 'traffic', from: 0.2, to: 0.6 },
      { bucket: 'quiet', from: 0.6, to: 1 },
    ])
  })
})
