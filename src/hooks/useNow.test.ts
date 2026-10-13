import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useNow } from './useNow'

afterEach(() => vi.useRealTimers())

describe('useNow', () => {
  it('ticks over on each new minute', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-13T08:41:30'))
    const { result } = renderHook(() => useNow())
    expect(result.current.getMinutes()).toBe(41)
    act(() => vi.advanceTimersByTime(30_000))
    expect(result.current.getMinutes()).toBe(42)
    act(() => vi.advanceTimersByTime(60_000))
    expect(result.current.getMinutes()).toBe(43)
  })
})
