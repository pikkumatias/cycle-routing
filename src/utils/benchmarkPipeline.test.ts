import { describe, it, expect } from 'vitest'
import {
  computeOverlap,
  buildOverlapMatrix,
  deduplicateWithTracking,
  formatDuration,
  selectWithLabels,
} from './benchmarkPipeline'
import type { LabeledCandidate } from './benchmarkPipeline'

// Helsinki-area straight-line polylines, clearly separated
const lineA: [number, number][] = [
  [60.16, 24.93],
  [60.17, 24.93],
  [60.18, 24.93],
]
const lineB: [number, number][] = [
  [60.50, 25.50],
  [60.51, 25.50],
  [60.52, 25.50],
]

function makeCandidate(
  label: string,
  durationSec: number,
  poly: [number, number][],
): LabeledCandidate {
  return { presetLabel: label, durationSec, distanceKm: 1, polyline: poly }
}

// ── computeOverlap ────────────────────────────────────────────────────────────

describe('computeOverlap', () => {
  it('identical polylines → 1.0', () => {
    expect(computeOverlap(lineA, lineA)).toBe(1)
  })

  it('geographically disjoint polylines → 0', () => {
    expect(computeOverlap(lineA, lineB)).toBe(0)
  })

  it('empty polylineA → 0', () => {
    expect(computeOverlap([], lineA)).toBe(0)
  })

  it('overlap is not necessarily symmetric', () => {
    // longer polyline covering shorter → different in each direction
    const short: [number, number][] = [[60.17, 24.93]]
    const long: [number, number][] = [[60.16, 24.93], [60.17, 24.93], [60.18, 24.93]]
    const shortToLong = computeOverlap(short, long)
    const longToShort = computeOverlap(long, short)
    expect(shortToLong).toBe(1) // all of short is within long
    expect(longToShort).toBeGreaterThan(0)
    expect(longToShort).toBeLessThan(1)
  })
})

// ── buildOverlapMatrix ────────────────────────────────────────────────────────

describe('buildOverlapMatrix', () => {
  it('diagonal is always 1', () => {
    const candidates = [makeCandidate('a', 600, lineA), makeCandidate('b', 700, lineB)]
    const matrix = buildOverlapMatrix(candidates)
    expect(matrix[0][0]).toBe(1)
    expect(matrix[1][1]).toBe(1)
  })

  it('off-diagonal for disjoint routes is 0', () => {
    const candidates = [makeCandidate('a', 600, lineA), makeCandidate('b', 700, lineB)]
    const matrix = buildOverlapMatrix(candidates)
    expect(matrix[0][1]).toBe(0)
    expect(matrix[1][0]).toBe(0)
  })

  it('returns N×N matrix', () => {
    const candidates = [
      makeCandidate('a', 600, lineA),
      makeCandidate('b', 700, lineB),
      makeCandidate('c', 800, lineA),
    ]
    const matrix = buildOverlapMatrix(candidates)
    expect(matrix).toHaveLength(3)
    expect(matrix[0]).toHaveLength(3)
  })
})

// ── deduplicateWithTracking ───────────────────────────────────────────────────

describe('deduplicateWithTracking', () => {
  it('keeps all when routes are geographically distinct', () => {
    const candidates = [makeCandidate('a', 600, lineA), makeCandidate('b', 700, lineB)]
    const { kept, dropped } = deduplicateWithTracking(candidates)
    expect(kept).toHaveLength(2)
    expect(dropped).toHaveLength(0)
  })

  it('drops duplicate and keeps the faster one', () => {
    const fast = makeCandidate('fast', 600, lineA)
    const slow = makeCandidate('slow', 900, lineA) // same route, slower
    const { kept, dropped } = deduplicateWithTracking([fast, slow])
    expect(kept).toHaveLength(1)
    expect(kept[0].presetLabel).toBe('fast')
    expect(dropped).toHaveLength(1)
    expect(dropped[0].candidate.presetLabel).toBe('slow')
    expect(dropped[0].duplicateOf.presetLabel).toBe('fast')
  })

  it('input order does not affect which duplicate survives', () => {
    const fast = makeCandidate('fast', 600, lineA)
    const slow = makeCandidate('slow', 900, lineA)
    const { kept: kept1 } = deduplicateWithTracking([slow, fast])
    const { kept: kept2 } = deduplicateWithTracking([fast, slow])
    expect(kept1[0].presetLabel).toBe('fast')
    expect(kept2[0].presetLabel).toBe('fast')
  })

  it('three identical routes → keeps only fastest', () => {
    const candidates = [
      makeCandidate('x', 900, lineA),
      makeCandidate('y', 700, lineA),
      makeCandidate('z', 500, lineA),
    ]
    const { kept, dropped } = deduplicateWithTracking(candidates)
    expect(kept).toHaveLength(1)
    expect(kept[0].presetLabel).toBe('z')
    expect(dropped).toHaveLength(2)
  })
})

// ── formatDuration ────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('0s → "0m 0s"', () => expect(formatDuration(0)).toBe('0m 0s'))
  it('59s → "0m 59s"', () => expect(formatDuration(59)).toBe('0m 59s'))
  it('60s → "1m 0s"', () => expect(formatDuration(60)).toBe('1m 0s'))
  it('90s → "1m 30s"', () => expect(formatDuration(90)).toBe('1m 30s'))
  it('3661s → "61m 1s"', () => expect(formatDuration(3661)).toBe('61m 1s'))
})

// ── selectWithLabels ──────────────────────────────────────────────────────────

describe('selectWithLabels', () => {
  it('throws when given no candidates', () => {
    expect(() => selectWithLabels([], [])).toThrow()
  })

  it('fastest is always the candidate with lowest durationSec', () => {
    const candidates = [
      makeCandidate('slow', 900, lineA),
      makeCandidate('fast', 500, lineB),
    ]
    const { fastest } = selectWithLabels(candidates, [])
    expect(fastest.presetLabel).toBe('fast')
  })

  it('works with a single candidate — all three categories point to it', () => {
    const candidates = [makeCandidate('only', 600, lineA)]
    const { fastest, scenic, calm } = selectWithLabels(candidates, [])
    expect(fastest.presetLabel).toBe('only')
    expect(scenic.presetLabel).toBe('only')
    expect(calm.presetLabel).toBe('only')
  })

  it('with two candidates, scenic and calm are not the fastest', () => {
    const candidates = [
      makeCandidate('fast', 500, lineA),
      makeCandidate('other', 800, lineB),
    ]
    const { fastest, scenic, calm } = selectWithLabels(candidates, [])
    expect(fastest.presetLabel).toBe('fast')
    // scenic and calm must pick from the remaining pool (only 'other' available)
    expect(scenic.presetLabel).toBe('other')
    expect(calm.presetLabel).toBe('other')
  })
})
