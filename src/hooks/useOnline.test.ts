import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useOnline } from './useOnline'

describe('useOnline', () => {
  it('follows the browser going offline and back', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const { result } = renderHook(() => useOnline())
    expect(result.current).toBe(true)
    onLine.mockReturnValue(false)
    act(() => window.dispatchEvent(new Event('offline')))
    expect(result.current).toBe(false)
    onLine.mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('online')))
    expect(result.current).toBe(true)
    onLine.mockRestore()
  })
})
