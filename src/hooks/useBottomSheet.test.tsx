import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { pickSnap, useBottomSheet, type SnapGeometry } from './useBottomSheet'

const g: SnapGeometry = { full: 0, expanded: 200, collapsed: 500 }

describe('pickSnap', () => {
  it('picks the nearest snap on a slow drag', () => {
    expect(pickSnap(40, 0, g)).toBe('full')
    expect(pickSnap(260, 0, g)).toBe('expanded')
    expect(pickSnap(420, 0, g)).toBe('collapsed')
  })

  it('steps one level in the direction of a fast swipe', () => {
    expect(pickSnap(480, -1, g)).toBe('expanded') // up from near collapsed
    expect(pickSnap(190, -1, g)).toBe('full')
    expect(pickSnap(210, 1, g)).toBe('collapsed') // down from near expanded
  })

  it('stays at the end when swiping past it', () => {
    expect(pickSnap(0, -1, g)).toBe('full')
    expect(pickSnap(500, 1, g)).toBe('collapsed')
  })

  it('merges expanded into full when the content fills the panel', () => {
    const filled: SnapGeometry = { full: 0, expanded: 4, collapsed: 500 }
    expect(pickSnap(300, -1, filled)).toBe('full')
    expect(pickSnap(2, 0, filled)).toBe('full')
  })
})

describe('useBottomSheet', () => {
  type Observer = { callback: () => void; targets: Element[] }
  let observers: Observer[] = []

  beforeEach(() => {
    observers = []
    vi.useFakeTimers()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        o: Observer
        constructor(callback: () => void) {
          this.o = { callback, targets: [] }
          observers.push(this.o)
        }
        observe(el: Element) {
          this.o.targets.push(el)
        }
        disconnect() {
          this.o.targets = []
        }
      },
    )
    vi.stubGlobal('innerHeight', 1000)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** Give an element a fixed layout box; jsdom has no layout. */
  function box(el: HTMLElement, top: number, height: number) {
    Object.defineProperty(el, 'offsetTop', { configurable: true, get: () => top })
    Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height })
  }

  function Harness() {
    const { sheetRef, handleRef, contentRef, peekRef, snapTo, snapPoint } = useBottomSheet({ enabled: true })
    return (
      <div ref={sheetRef} data-testid="sheet" data-snap={snapPoint}>
        <button ref={handleRef} type="button" aria-label="Panel size" />
        <button type="button" onClick={() => snapTo('expanded')}>
          expand
        </button>
        <div ref={contentRef}>
          <div ref={peekRef} data-testid="peek" />
          <div data-testid="body" />
        </div>
      </div>
    )
  }

  function setup() {
    render(<Harness />)
    box(screen.getByTestId('peek'), 0, 100)
    box(screen.getByTestId('body'), 100, 200)
    const sheet = screen.getByTestId('sheet')
    return {
      expand: () => act(() => fireEvent.click(screen.getByRole('button', { name: 'expand' }))),
      snap: () => sheet.dataset.snap,
      transform: () => sheet.style.transform,
    }
  }

  const resized = () => act(() => observers.forEach((o) => o.targets.length && o.callback()))

  it('re-fits the expanded sheet when its content grows', () => {
    const { expand, transform } = setup()
    expand()
    act(() => vi.advanceTimersByTime(400))
    // panel 880, needed 28 + 300 → translateY 552
    expect(transform()).toBe('translateY(552px)')
    box(screen.getByTestId('body'), 100, 400)
    resized()
    expect(transform()).toBe('translateY(352px)')
  })

  it('re-fits after a snap animation that was running when the content changed', () => {
    const { expand, transform } = setup()
    expand()
    box(screen.getByTestId('body'), 100, 400)
    resized()
    act(() => vi.advanceTimersByTime(400))
    act(() => vi.advanceTimersByTime(400))
    expect(transform()).toBe('translateY(352px)')
  })

  it('steps between snaps with the arrow keys on the handle', () => {
    const { snap } = setup()
    const handle = screen.getByRole('button', { name: 'Panel size' })
    expect(snap()).toBe('collapsed')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(snap()).toBe('expanded')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(snap()).toBe('full')
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(snap()).toBe('expanded')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(snap()).toBe('collapsed')
    fireEvent.keyDown(handle, { key: 'End' })
    expect(snap()).toBe('full')
  })

  it('toggles between collapsed and expanded on click', () => {
    const { snap } = setup()
    const handle = screen.getByRole('button', { name: 'Panel size' })
    fireEvent.click(handle)
    expect(snap()).toBe('expanded')
    fireEvent.click(handle)
    expect(snap()).toBe('collapsed')
  })
})
