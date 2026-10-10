import { useRef, useState, useEffect, useCallback, useMemo, type CSSProperties } from 'react'

/** Panel height as a fraction of the viewport; its top edge is the "full" snap. */
export const PANEL_FRACTION = 0.88
/** Collapsed height when there is no peek element to measure. */
const FALLBACK_COLLAPSED_FRACTION = 0.3
/** Collapsed never shows less than this, so the handle stays easy to grab. */
const MIN_COLLAPSED_PX = 120
const VELOCITY_THRESHOLD = 0.4 // px/ms
const DEAD_ZONE = 5 // px — ignore micro-movements (protects taps)
const HANDLE_HEIGHT = 28 // px — handle area
const SNAP_TRANSITION = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)'
const SNAP_DURATION = 350 // ms — safety timeout, slightly longer than transition

export type SnapPoint = 'collapsed' | 'expanded' | 'full'

export type SnapGeometry = {
  /** translateY of each snap; 0 is fully open. */
  full: number
  expanded: number
  collapsed: number
}

/**
 * Pick the snap point after a drag ends.
 *
 * - Fast swipe: steps exactly one snap level in the swipe direction.
 * - Slow drag: picks the nearest snap by position.
 *
 * Snap points within 10px of each other are merged, so 'full' and 'expanded'
 * collapse into one when the content fills the panel.
 */
export function pickSnap(ty: number, velocity: number, geometry: SnapGeometry): SnapPoint {
  const snaps: [SnapPoint, number][] = [
    ['full', geometry.full],
    ['expanded', geometry.expanded],
    ['collapsed', geometry.collapsed],
  ]
  const unique = snaps.filter(([, s], i) => !snaps.slice(0, i).some(([, prev]) => Math.abs(prev - s) < 10))

  if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
    if (velocity > 0) {
      // Swiping down — next snap with a larger translateY
      const next = unique.find(([, s]) => s > ty + 5)
      return next ? next[0] : unique[unique.length - 1][0]
    }
    // Swiping up — next snap with a smaller translateY
    const next = [...unique].reverse().find(([, s]) => s < ty - 5)
    return next ? next[0] : unique[0][0]
  }

  return unique.reduce((best, curr) => (Math.abs(curr[1] - ty) < Math.abs(best[1] - ty) ? curr : best))[0]
}

/**
 * Height the content needs, measured from its last child rather than
 * scrollHeight: the content box stretches to fill the panel, so its own
 * scrollHeight never reports less than the panel. Needs `position: relative`
 * on the content element so offsetTop is relative to it.
 */
function contentHeight(content: HTMLElement): number {
  const last = content.lastElementChild as HTMLElement | null
  const bottom = last ? last.offsetTop + last.offsetHeight : 0
  return bottom + parseFloat(getComputedStyle(content).paddingBottom || '0')
}

type Options = {
  /** False on wide screens, where the panel is a static side panel. */
  enabled: boolean
}

/**
 * A draggable bottom sheet with three snap points:
 * - collapsed: shows content down to the bottom of `peekRef` (the trip planner)
 * - expanded: shows all content, capped at the panel height
 * - full: the whole panel
 *
 * The transform is written straight to the DOM during drags so React never
 * re-renders per frame.
 */
export function useBottomSheet({ enabled }: Options) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const peekRef = useRef<HTMLDivElement>(null)

  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  const [snapPoint, setSnapPoint] = useState<SnapPoint>('collapsed')
  const [translateY, setTranslateY] = useState(() => window.innerHeight * PANEL_FRACTION * 0.6)

  const isDragging = useRef(false)
  const currentTranslateY = useRef(translateY)
  const isAnimating = useRef(false)
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Last two pointer samples, for release velocity
  const lastY = useRef(0)
  const lastTime = useRef(0)
  const velocity = useRef(0)

  const panelHeight = viewportHeight * PANEL_FRACTION

  const geometry = useCallback((): SnapGeometry => {
    const content = contentRef.current
    const peek = peekRef.current
    let collapsedVisible = viewportHeight * FALLBACK_COLLAPSED_FRACTION
    if (content && peek) {
      // offsetTop is relative to the (positioned) content box; add the handle above it
      collapsedVisible = HANDLE_HEIGHT + peek.offsetTop + peek.offsetHeight + 12
    }
    collapsedVisible = Math.min(panelHeight, Math.max(MIN_COLLAPSED_PX, collapsedVisible))
    const needed = content ? HANDLE_HEIGHT + contentHeight(content) : panelHeight
    return {
      full: 0,
      expanded: needed >= panelHeight ? 0 : panelHeight - needed,
      collapsed: panelHeight - collapsedVisible,
    }
  }, [panelHeight, viewportHeight])

  const finishAnimation = useCallback(() => {
    isAnimating.current = false
    if (animationTimer.current) {
      clearTimeout(animationTimer.current)
      animationTimer.current = null
    }
    const sheet = sheetRef.current
    if (sheet) sheet.style.transition = ''
  }, [])

  const applyTranslateY = useCallback((ty: number) => {
    const sheet = sheetRef.current
    if (sheet) sheet.style.transform = `translateY(${ty}px)`
    currentTranslateY.current = ty
  }, [])

  const snapTo = useCallback(
    (target: SnapPoint) => {
      if (!enabled) return
      const newTY = geometry()[target]
      setSnapPoint(target)
      setTranslateY(newTY)

      if (Math.abs(currentTranslateY.current - newTY) < 1) {
        applyTranslateY(newTY)
        isAnimating.current = false
        return
      }

      isAnimating.current = true
      const sheet = sheetRef.current
      if (sheet) {
        sheet.style.transition = SNAP_TRANSITION
        const onEnd = () => {
          sheet.removeEventListener('transitionend', onEnd)
          finishAnimation()
        }
        sheet.addEventListener('transitionend', onEnd)
      }
      if (animationTimer.current) clearTimeout(animationTimer.current)
      animationTimer.current = setTimeout(finishAnimation, SNAP_DURATION)
      applyTranslateY(newTY)
    },
    [enabled, geometry, applyTranslateY, finishAnimation],
  )

  const trackPointer = (y: number) => {
    const now = performance.now()
    const dt = now - lastTime.current
    if (dt > 0) velocity.current = (y - lastY.current) / dt
    lastY.current = y
    lastTime.current = now
  }

  const startPointer = (y: number) => {
    lastY.current = y
    lastTime.current = performance.now()
    velocity.current = 0
  }

  /** Velocity at release; a pause before lifting the finger counts as a slow drag. */
  const releaseVelocity = () => (performance.now() - lastTime.current > 80 ? 0 : velocity.current)

  const clampTY = useCallback((ty: number) => Math.max(0, Math.min(geometry().collapsed, ty)), [geometry])

  // --- Handle drag (touch + mouse) ---
  useEffect(() => {
    const handle = handleRef.current
    if (!handle || !enabled) return

    let startY = 0
    let startTY = 0

    const begin = (y: number) => {
      isDragging.current = true
      startY = y
      startTY = currentTranslateY.current
      startPointer(y)
      const sheet = sheetRef.current
      if (sheet) sheet.style.transition = ''
    }
    const move = (y: number) => {
      applyTranslateY(clampTY(startTY + (y - startY)))
      trackPointer(y)
    }
    const end = () => {
      isDragging.current = false
      snapTo(pickSnap(currentTranslateY.current, releaseVelocity(), geometry()))
    }

    const onTouchStart = (e: TouchEvent) => {
      if (isAnimating.current) finishAnimation()
      begin(e.touches[0].clientY)
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current) return
      e.preventDefault()
      move(e.touches[0].clientY)
    }
    const onTouchEnd = () => {
      if (isDragging.current) end()
    }
    const onMouseDown = (e: MouseEvent) => {
      if (isAnimating.current) finishAnimation()
      e.preventDefault()
      begin(e.clientY)
      const onMouseMove = (ev: MouseEvent) => move(ev.clientY)
      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
        end()
      }
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    }

    handle.addEventListener('touchstart', onTouchStart, { passive: true })
    handle.addEventListener('touchmove', onTouchMove, { passive: false })
    handle.addEventListener('touchend', onTouchEnd, { passive: true })
    handle.addEventListener('touchcancel', onTouchEnd, { passive: true })
    handle.addEventListener('mousedown', onMouseDown)
    return () => {
      handle.removeEventListener('touchstart', onTouchStart)
      handle.removeEventListener('touchmove', onTouchMove)
      handle.removeEventListener('touchend', onTouchEnd)
      handle.removeEventListener('touchcancel', onTouchEnd)
      handle.removeEventListener('mousedown', onMouseDown)
    }
     
  }, [enabled, applyTranslateY, clampTY, snapTo, geometry, finishAnimation])

  // --- Content drag: moves the sheet until it is open, then scrolls natively ---
  useEffect(() => {
    const content = contentRef.current
    if (!content || !enabled) return

    let startY = 0
    let moving = false

    const onTouchStart = (e: TouchEvent) => {
      if (isAnimating.current || isDragging.current) return
      startY = e.touches[0].clientY
      startPointer(startY)
      moving = false
    }

    const onTouchMove = (e: TouchEvent) => {
      if (isDragging.current || isAnimating.current) return
      const y = e.touches[0].clientY
      const step = y - lastY.current // positive = finger down
      const ty = currentTranslateY.current
      const g = geometry()
      const open = ty <= g.expanded + 1

      if (!open) {
        if (!moving && Math.abs(y - startY) < DEAD_ZONE) return
        moving = true
        e.preventDefault()
        applyTranslateY(clampTY(ty + step))
      } else if (moving || (content.scrollTop <= 0 && step > 0)) {
        // At the top of the scroll and pulling down: move the sheet instead
        moving = true
        e.preventDefault()
        applyTranslateY(clampTY(ty + step))
      }
      trackPointer(y)
    }

    const onTouchEnd = () => {
      if (isDragging.current || !moving) return
      moving = false
      snapTo(pickSnap(currentTranslateY.current, releaseVelocity(), geometry()))
    }

    content.addEventListener('touchstart', onTouchStart, { passive: true })
    content.addEventListener('touchmove', onTouchMove, { passive: false })
    content.addEventListener('touchend', onTouchEnd, { passive: true })
    content.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      content.removeEventListener('touchstart', onTouchStart)
      content.removeEventListener('touchmove', onTouchMove)
      content.removeEventListener('touchend', onTouchEnd)
      content.removeEventListener('touchcancel', onTouchEnd)
    }
     
  }, [enabled, applyTranslateY, clampTY, snapTo, geometry])

  // --- Viewport resize ---
  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Re-apply the current snap when the viewport or enabled state changes;
  // as a side panel the sheet has no transform at all
  useEffect(() => {
    if (enabled) snapTo(snapPoint)
    else if (sheetRef.current) sheetRef.current.style.transform = ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportHeight, enabled])

  useEffect(
    () => () => {
      if (animationTimer.current) clearTimeout(animationTimer.current)
    },
    [],
  )

  const sheetStyle = useMemo<CSSProperties>(
    () => (enabled ? { height: panelHeight, transform: `translateY(${translateY}px)` } : {}),
    [enabled, panelHeight, translateY],
  )

  const contentStyle = useMemo<CSSProperties>(
    () => (enabled ? { maxHeight: panelHeight - HANDLE_HEIGHT } : {}),
    [enabled, panelHeight],
  )

  /** Height of the sheet currently covering the map, for map padding. */
  const visibleHeight = enabled ? Math.max(0, panelHeight - translateY) : 0

  return { sheetRef, handleRef, contentRef, peekRef, sheetStyle, contentStyle, snapTo, snapPoint, visibleHeight }
}
