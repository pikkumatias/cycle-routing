import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useGeolocation } from './useGeolocation'

type Success = (pos: { coords: { latitude: number; longitude: number } }) => void
type Failure = (err: { code: number }) => void

const PERMISSION_DENIED = 1
const POSITION_UNAVAILABLE = 2
const TIMEOUT = 3

let pending: { ok: Success; fail: Failure }[] = []
const getCurrentPosition = vi.fn((ok: Success, fail: Failure) => {
  pending.push({ ok, fail })
})

function resolveFix(lat: number, lon: number) {
  act(() => pending.shift()!.ok({ coords: { latitude: lat, longitude: lon } }))
}
function rejectFix(code: number) {
  act(() => pending.shift()!.fail({ code }))
}

beforeEach(() => {
  pending = []
  getCurrentPosition.mockClear()
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } })
  vi.stubGlobal('GeolocationPositionError', { PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useGeolocation', () => {
  it('stores a fix', () => {
    const { result } = renderHook(() => useGeolocation())
    act(() => result.current.request())
    expect(result.current.loading).toBe(true)
    resolveFix(60.17, 24.94)
    expect(result.current).toMatchObject({ coords: { lat: 60.17, lon: 24.94 }, loading: false, denied: false })
  })

  it('keeps the last known position when a later request fails', () => {
    const { result } = renderHook(() => useGeolocation())
    act(() => result.current.request())
    resolveFix(60.17, 24.94)
    act(() => result.current.request())
    rejectFix(TIMEOUT)
    expect(result.current.coords).toEqual({ lat: 60.17, lon: 24.94 })
    expect(result.current.error?.kind).toBe('timeout')
  })

  it.each([
    [PERMISSION_DENIED, 'denied'],
    [POSITION_UNAVAILABLE, 'unavailable'],
    [TIMEOUT, 'timeout'],
  ] as const)('reports error code %i as %s', (code, kind) => {
    const { result } = renderHook(() => useGeolocation())
    act(() => result.current.request())
    rejectFix(code)
    expect(result.current.error?.kind).toBe(kind)
    expect(result.current.denied).toBe(kind === 'denied')
  })

  it('reports each failure as a new error so repeated failures can be shown again', () => {
    const { result } = renderHook(() => useGeolocation())
    act(() => result.current.request())
    rejectFix(TIMEOUT)
    const first = result.current.error
    act(() => result.current.request())
    rejectFix(TIMEOUT)
    expect(result.current.error).not.toBe(first)
  })

  it('stays quiet about failures of automatic requests, except a denial', () => {
    const { result } = renderHook(() => useGeolocation())
    act(() => result.current.request({ quiet: true }))
    rejectFix(TIMEOUT)
    expect(result.current.error).toBeNull()
    act(() => result.current.request({ quiet: true }))
    rejectFix(PERMISSION_DENIED)
    expect(result.current.denied).toBe(true)
  })

  it('refresh() skips the request while the last fix is fresh', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useGeolocation())
    act(() => result.current.refresh())
    resolveFix(60.17, 24.94)
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    act(() => result.current.refresh())
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(61_000))
    act(() => result.current.refresh())
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it('refresh() runs in the background without reporting failures', () => {
    const { result } = renderHook(() => useGeolocation())
    act(() => result.current.refresh())
    rejectFix(PERMISSION_DENIED)
    expect(result.current.error).toBeNull()
    expect(result.current.denied).toBe(true)
  })
})
