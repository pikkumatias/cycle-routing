import { describe, it, expect } from 'vitest'
import { isWinterSeason } from './winterSeason'

describe('isWinterSeason', () => {
  it.each([
    ['2026-01-10', true],
    ['2026-03-31', true],
    ['2026-04-15', true],
    ['2026-04-16', false],
    ['2026-07-01', false],
    ['2026-10-14', false],
    ['2026-10-15', true],
    ['2026-12-24', true],
  ])('%s → %s', (iso, expected) => {
    expect(isWinterSeason(new Date(`${iso}T12:00:00`))).toBe(expected)
  })
})
