import { useEffect, useRef } from 'react'

export const LONG_PRESS_MS = 500
/** Finger travel that turns a press into a pan. */
export const LONG_PRESS_TOLERANCE_PX = 10

type Point = { x: number; y: number }

/**
 * Calls `onLongPress` with the client position when a single finger rests on
 * `target` for LONG_PRESS_MS without moving. iOS Safari never fires
 * `contextmenu` for touch, and MapLibre does not emulate it, so the map's
 * "set as start / destination" menu needs this for touch screens.
 */
export function useLongPress(
  target: HTMLElement | null,
  onLongPress: (at: Point) => void,
) {
  const callback = useRef(onLongPress)
  useEffect(() => {
    callback.current = onLongPress
  })

  useEffect(() => {
    if (!target) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let start: Point | null = null

    const cancel = () => {
      if (timer) clearTimeout(timer)
      timer = null
      start = null
    }

    const onStart = (e: TouchEvent) => {
      cancel()
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      start = { x: t.clientX, y: t.clientY }
      timer = setTimeout(() => {
        if (start) callback.current(start)
        cancel()
      }, LONG_PRESS_MS)
    }

    const onMove = (e: TouchEvent) => {
      if (!start) return
      const t = e.touches[0]
      if (e.touches.length !== 1 || Math.hypot(t.clientX - start.x, t.clientY - start.y) > LONG_PRESS_TOLERANCE_PX) {
        cancel()
      }
    }

    target.addEventListener('touchstart', onStart, { passive: true })
    target.addEventListener('touchmove', onMove, { passive: true })
    target.addEventListener('touchend', cancel, { passive: true })
    target.addEventListener('touchcancel', cancel, { passive: true })
    return () => {
      cancel()
      target.removeEventListener('touchstart', onStart)
      target.removeEventListener('touchmove', onMove)
      target.removeEventListener('touchend', cancel)
      target.removeEventListener('touchcancel', cancel)
    }
  }, [target])
}
