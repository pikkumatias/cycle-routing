import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getRecentSearches,
  addRecentSearch,
  clearRecentSearches,
  type RecentSearch,
} from './recentSearches'

const STORAGE_KEY = 'cycle-routing:recent-searches'

beforeEach(() => {
  localStorage.clear()
})

describe('getRecentSearches', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(getRecentSearches()).toEqual([])
  })

  it('returns stored entries', () => {
    const entries: RecentSearch[] = [
      { label: 'Helsinki', lat: 60.17, lon: 24.94 },
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    expect(getRecentSearches()).toEqual(entries)
  })

  it('returns empty array for invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')
    expect(getRecentSearches()).toEqual([])
  })

  it('returns empty array if stored value is not an array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ label: 'test' }))
    expect(getRecentSearches()).toEqual([])
  })

  it('caps at 10 entries', () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      label: `Place ${i}`,
      lat: 60 + i * 0.01,
      lon: 24 + i * 0.01,
    }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    expect(getRecentSearches()).toHaveLength(10)
  })
})

describe('addRecentSearch', () => {
  it('adds an entry to empty storage', () => {
    const entry: RecentSearch = { label: 'Helsinki', lat: 60.17, lon: 24.94 }
    addRecentSearch(entry)
    expect(getRecentSearches()).toEqual([entry])
  })

  it('prepends new entries', () => {
    const a: RecentSearch = { label: 'A', lat: 1, lon: 2 }
    const b: RecentSearch = { label: 'B', lat: 3, lon: 4 }
    addRecentSearch(a)
    addRecentSearch(b)
    const result = getRecentSearches()
    expect(result[0].label).toBe('B')
    expect(result[1].label).toBe('A')
  })

  it('deduplicates by label, keeping newest', () => {
    const a: RecentSearch = { label: 'Helsinki', lat: 60.17, lon: 24.94 }
    const b: RecentSearch = { label: 'Espoo', lat: 60.2, lon: 24.66 }
    const aUpdated: RecentSearch = { label: 'Helsinki', lat: 60.18, lon: 24.95 }
    addRecentSearch(a)
    addRecentSearch(b)
    addRecentSearch(aUpdated)
    const result = getRecentSearches()
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(aUpdated)
    expect(result[1]).toEqual(b)
  })

  it('caps at 10 entries', () => {
    for (let i = 0; i < 12; i++) {
      addRecentSearch({ label: `Place ${i}`, lat: i, lon: i })
    }
    expect(getRecentSearches()).toHaveLength(10)
    expect(getRecentSearches()[0].label).toBe('Place 11')
  })

  it('handles localStorage errors gracefully', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    // Should not throw
    expect(() =>
      addRecentSearch({ label: 'test', lat: 0, lon: 0 }),
    ).not.toThrow()
    vi.restoreAllMocks()
  })
})

describe('clearRecentSearches', () => {
  it('removes all entries', () => {
    addRecentSearch({ label: 'Helsinki', lat: 60.17, lon: 24.94 })
    clearRecentSearches()
    expect(getRecentSearches()).toEqual([])
  })
})
