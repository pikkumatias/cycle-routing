import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { resolveScheme, setThemePreference, THEME_STORAGE_KEY, useColorScheme } from './colorScheme'

describe('resolveScheme', () => {
  it('follows the system in system mode', () => {
    expect(resolveScheme('system', true)).toBe('dark')
    expect(resolveScheme('system', false)).toBe('light')
  })

  it('overrides the system otherwise', () => {
    expect(resolveScheme('light', true)).toBe('light')
    expect(resolveScheme('dark', false)).toBe('dark')
  })
})

describe('setThemePreference', () => {
  beforeEach(() => act(() => setThemePreference('system')))

  it('applies the dark class and persists an explicit choice', () => {
    const { result } = renderHook(() => useColorScheme())
    act(() => setThemePreference('dark'))
    expect(result.current).toEqual({ preference: 'dark', scheme: 'dark' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    act(() => setThemePreference('light'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('forgets the stored choice when going back to system', () => {
    act(() => setThemePreference('dark'))
    act(() => setThemePreference('system'))
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })
})
