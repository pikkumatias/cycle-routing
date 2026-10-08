import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { LONG_PRESS_MS, useLongPress } from './useLongPress'

function touch(target: HTMLElement, type: string, points: [number, number][]) {
  const event = new Event(type, { bubbles: true }) as Event & { touches: { clientX: number; clientY: number }[] }
  Object.defineProperty(event, 'touches', { value: points.map(([clientX, clientY]) => ({ clientX, clientY })) })
  target.dispatchEvent(event)
}

describe('useLongPress', () => {
  let el: HTMLDivElement
  beforeEach(() => {
    vi.useFakeTimers()
    el = document.createElement('div')
  })
  afterEach(() => vi.useRealTimers())

  it('fires with the press position after holding still', () => {
    const onLongPress = vi.fn()
    renderHook(() => useLongPress(el, onLongPress))
    touch(el, 'touchstart', [[10, 20]])
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    expect(onLongPress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onLongPress).toHaveBeenCalledWith({ x: 10, y: 20 })
  })

  it('is cancelled by moving the finger (a pan)', () => {
    const onLongPress = vi.fn()
    renderHook(() => useLongPress(el, onLongPress))
    touch(el, 'touchstart', [[10, 20]])
    touch(el, 'touchmove', [[30, 20]])
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('tolerates a small wobble', () => {
    const onLongPress = vi.fn()
    renderHook(() => useLongPress(el, onLongPress))
    touch(el, 'touchstart', [[10, 20]])
    touch(el, 'touchmove', [[14, 23]])
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('is cancelled by lifting the finger or a second finger (a pinch)', () => {
    const onLongPress = vi.fn()
    renderHook(() => useLongPress(el, onLongPress))
    touch(el, 'touchstart', [[10, 20]])
    touch(el, 'touchend', [])
    touch(el, 'touchstart', [
      [10, 20],
      [50, 60],
    ])
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(onLongPress).not.toHaveBeenCalled()
  })
})
