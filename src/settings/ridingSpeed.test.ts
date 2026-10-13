import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('riding speed', () => {
  it('defaults to normal and remembers a choice', async () => {
    const { setRidingSpeed, useRidingSpeed, RIDING_SPEED_KMH } = await import('./ridingSpeed')
    const { result } = renderHook(() => useRidingSpeed())
    expect(result.current).toBe('normal')
    act(() => setRidingSpeed('fast'))
    expect(result.current).toBe('fast')
    expect(RIDING_SPEED_KMH.fast).toBe(25)
    expect(localStorage.getItem('cycle-routing:speed')).toBe('fast')
  })

  it('reads a stored choice and ignores junk', async () => {
    localStorage.setItem('cycle-routing:speed', 'relaxed')
    expect((await import('./ridingSpeed')).getRidingSpeed()).toBe('relaxed')
    vi.resetModules()
    localStorage.setItem('cycle-routing:speed', 'warp')
    expect((await import('./ridingSpeed')).getRidingSpeed()).toBe('normal')
  })
})
