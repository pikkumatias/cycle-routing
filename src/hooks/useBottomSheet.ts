import { useRef, useState, useEffect, useCallback, useMemo } from 'react'

const COLLAPSED_FRACTION = 0.30
const MAX_EXPANDED_FRACTION = 0.85
const VELOCITY_THRESHOLD = 0.5 // px/ms
const DEAD_ZONE = 5 // px — ignore micro-movements (protects taps)
const HANDLE_HEIGHT = 36 // px — handle area including padding
const SNAP_TRANSITION = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)'
const SNAP_DURATION = 350 // ms — safety timeout, slightly longer than transition

type SnapPoint = 'collapsed' | 'expanded' | 'full'

function getViewportHeight() {
  return window.innerHeight
}

/** How far to push the panel down so only COLLAPSED_FRACTION is visible */
function getCollapsedTranslateY() {
  const vh = getViewportHeight()
  const panelHeight = vh * MAX_EXPANDED_FRACTION
  const collapsedVisible = vh * COLLAPSED_FRACTION
  return panelHeight - collapsedVisible
}

/**
 * How far to push the panel down when "expanded".
 * Only open as far as the content needs, capped at MAX_EXPANDED_FRACTION.
 */
function getExpandedTranslateY(contentEl: HTMLElement | null) {
  const vh = getViewportHeight()
  const panelHeight = vh * MAX_EXPANDED_FRACTION
  if (!contentEl) return 0

  const neededHeight = contentEl.scrollHeight + HANDLE_HEIGHT
  if (neededHeight >= panelHeight) return 0 // content fills the full panel

  // Panel only needs to show neededHeight, push the rest down
  return panelHeight - neededHeight
}

/**
 * Pick the best snap point after a drag ends.
 *
 * - Fast swipe: steps exactly one snap level in the swipe direction.
 * - Slow drag: picks the nearest snap by position.
 *
 * Snap points that fall within 10px of each other are deduplicated so that
 * 'full' and 'expanded' merge when content fills the panel.
 */
function pickSnap(ty: number, velocity: number, expandedTY: number): SnapPoint {
  const snaps: [SnapPoint, number][] = [
    ['full', 0],
    ['expanded', expandedTY],
    ['collapsed', getCollapsedTranslateY()],
  ]

  // Remove positions that are effectively identical to a higher-priority snap
  const unique = snaps.filter(([, s], i) =>
    !snaps.slice(0, i).some(([, prev]) => Math.abs(prev - s) < 10),
  )

  if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
    if (velocity > 0) {
      // Swiping down — step to next snap with higher translateY
      const next = unique.find(([, s]) => s > ty + 5)
      return next ? next[0] : unique[unique.length - 1][0]
    } else {
      // Swiping up — step to next snap with lower translateY
      const next = [...unique].reverse().find(([, s]) => s < ty - 5)
      return next ? next[0] : unique[0][0]
    }
  }

  // Slow drag — nearest snap by position
  return unique.reduce((best, curr) =>
    Math.abs(curr[1] - ty) < Math.abs(best[1] - ty) ? curr : best,
  )[0]
}

export function useBottomSheet() {
  const sheetRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const [snapPoint, setSnapPoint] = useState<SnapPoint>('collapsed')
  const [translateY, setTranslateY] = useState(() => getCollapsedTranslateY())

  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartTranslateY = useRef(0)
  const prevY = useRef(0)
  const prevTime = useRef(0)
  const currentTranslateY = useRef(getCollapsedTranslateY())
  const isAnimating = useRef(false)
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep ref in sync with state
  useEffect(() => {
    currentTranslateY.current = translateY
  }, [translateY])

  const finishAnimation = useCallback(() => {
    isAnimating.current = false
    if (animationTimer.current) {
      clearTimeout(animationTimer.current)
      animationTimer.current = null
    }
    const sheet = sheetRef.current
    if (sheet) sheet.style.transition = ''
  }, [])

  const snapTo = useCallback((target: SnapPoint) => {
    const newTY =
      target === 'collapsed' ? getCollapsedTranslateY()
      : target === 'full'   ? 0
      :                        getExpandedTranslateY(contentRef.current)

    // If already at target, skip animation entirely
    if (Math.abs(currentTranslateY.current - newTY) < 1) {
      currentTranslateY.current = newTY
      setTranslateY(newTY)
      setSnapPoint(target)
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

    // Safety timeout: clear isAnimating even if transitionend doesn't fire
    if (animationTimer.current) clearTimeout(animationTimer.current)
    animationTimer.current = setTimeout(finishAnimation, SNAP_DURATION)

    // Apply transform directly to DOM so it's immediate
    if (sheet) {
      sheet.style.transform = `translateY(${newTY}px)`
    }
    currentTranslateY.current = newTY
    setTranslateY(newTY)
    setSnapPoint(target)
  }, [finishAnimation])

  const applyTranslateY = useCallback((ty: number) => {
    const sheet = sheetRef.current
    if (sheet) {
      sheet.style.transform = `translateY(${ty}px)`
    }
    currentTranslateY.current = ty
  }, [])

  // --- Handle drag (touch + mouse) ---
  useEffect(() => {
    const handle = handleRef.current
    if (!handle) return

    const getClampRange = () => ({
      minTY: 0,
      maxTY: getCollapsedTranslateY(),
    })

    const onTouchStart = (e: TouchEvent) => {
      if (isAnimating.current) return
      const touch = e.touches[0]
      isDragging.current = true
      dragStartY.current = touch.clientY
      dragStartTranslateY.current = currentTranslateY.current
      prevY.current = touch.clientY
      prevTime.current = Date.now()
      const sheet = sheetRef.current
      if (sheet) sheet.style.transition = ''
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current) return
      e.preventDefault()
      const touch = e.touches[0]
      const delta = touch.clientY - dragStartY.current
      const { minTY, maxTY } = getClampRange()
      const newTY = Math.max(minTY, Math.min(maxTY, dragStartTranslateY.current + delta))
      applyTranslateY(newTY)
      prevY.current = touch.clientY
      prevTime.current = Date.now()
    }

    const onTouchEnd = () => {
      if (!isDragging.current) return
      isDragging.current = false
      const velocity = (prevY.current - dragStartY.current) / (Date.now() - prevTime.current + 1)
      const expandedTY = getExpandedTranslateY(contentRef.current)
      snapTo(pickSnap(currentTranslateY.current, velocity, expandedTY))
    }

    // Mouse events for desktop
    const onMouseDown = (e: MouseEvent) => {
      if (isAnimating.current) return
      e.preventDefault()
      isDragging.current = true
      dragStartY.current = e.clientY
      dragStartTranslateY.current = currentTranslateY.current
      prevY.current = e.clientY
      prevTime.current = Date.now()
      const sheet = sheetRef.current
      if (sheet) sheet.style.transition = ''

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging.current) return
        const delta = ev.clientY - dragStartY.current
        const { minTY, maxTY } = getClampRange()
        const newTY = Math.max(minTY, Math.min(maxTY, dragStartTranslateY.current + delta))
        applyTranslateY(newTY)
        prevY.current = ev.clientY
        prevTime.current = Date.now()
      }

      const onMouseUp = () => {
        if (!isDragging.current) return
        isDragging.current = false
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)

        const velocity = (prevY.current - dragStartY.current) / (Date.now() - prevTime.current + 1)
        const expandedTY = getExpandedTranslateY(contentRef.current)
        snapTo(pickSnap(currentTranslateY.current, velocity, expandedTY))
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    }

    handle.addEventListener('touchstart', onTouchStart, { passive: true })
    handle.addEventListener('touchmove', onTouchMove, { passive: false })
    handle.addEventListener('touchend', onTouchEnd, { passive: true })
    handle.addEventListener('mousedown', onMouseDown)

    return () => {
      handle.removeEventListener('touchstart', onTouchStart)
      handle.removeEventListener('touchmove', onTouchMove)
      handle.removeEventListener('touchend', onTouchEnd)
      handle.removeEventListener('mousedown', onMouseDown)
    }
  }, [applyTranslateY, snapTo])

  // --- Content scroll-to-expand (touch) ---
  useEffect(() => {
    const content = contentRef.current
    if (!content) return

    let startY = 0
    let isExpanding = false

    const onTouchStart = (e: TouchEvent) => {
      if (isAnimating.current || isDragging.current) return
      startY = e.touches[0].clientY
      prevY.current = startY
      prevTime.current = Date.now()
      isExpanding = false
    }

    const onTouchMove = (e: TouchEvent) => {
      if (isDragging.current || isAnimating.current) return
      const touch = e.touches[0]
      const deltaFromStart = startY - touch.clientY // positive = finger up
      const incrementalDelta = prevY.current - touch.clientY

      const ty = currentTranslateY.current
      const expandedTY = getExpandedTranslateY(content)
      const isFullyExpanded = ty <= expandedTY

      if (!isFullyExpanded) {
        // Panel not fully expanded — move the panel
        if (Math.abs(deltaFromStart) < DEAD_ZONE && !isExpanding) return
        isExpanding = true
        e.preventDefault()
        const maxTY = getCollapsedTranslateY()
        const newTY = Math.max(0, Math.min(maxTY, ty - incrementalDelta))
        applyTranslateY(newTY)
      } else {
        // Panel is fully expanded (at expanded or full position)
        if (content.scrollTop <= 0 && incrementalDelta < 0) {
          // At top of scroll, pulling down — step down one snap level
          e.preventDefault()
          const maxTY = getCollapsedTranslateY()
          const newTY = Math.max(0, Math.min(maxTY, ty - incrementalDelta))
          applyTranslateY(newTY)
          isExpanding = true
        }
        // Otherwise let browser handle native scroll
      }

      prevY.current = touch.clientY
      prevTime.current = Date.now()
    }

    const onTouchEnd = () => {
      if (isDragging.current) return
      if (!isExpanding) return
      isExpanding = false

      const ty = currentTranslateY.current
      const velocity = (prevY.current - startY) / (Date.now() - prevTime.current + 1)
      const expandedTY = getExpandedTranslateY(content)
      snapTo(pickSnap(ty, velocity, expandedTY))
    }

    content.addEventListener('touchstart', onTouchStart, { passive: true })
    content.addEventListener('touchmove', onTouchMove, { passive: false })
    content.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      content.removeEventListener('touchstart', onTouchStart)
      content.removeEventListener('touchmove', onTouchMove)
      content.removeEventListener('touchend', onTouchEnd)
    }
  }, [applyTranslateY, snapTo])

  // --- Viewport resize ---
  useEffect(() => {
    const handleResize = () => {
      const newTY =
        snapPoint === 'collapsed' ? getCollapsedTranslateY()
        : snapPoint === 'full'   ? 0
        :                           getExpandedTranslateY(contentRef.current)
      setTranslateY(newTY)
      applyTranslateY(newTY)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [snapPoint, applyTranslateY])

  // Cleanup animation timer on unmount
  useEffect(() => {
    return () => {
      if (animationTimer.current) clearTimeout(animationTimer.current)
    }
  }, [])

  const sheetStyle = useMemo<React.CSSProperties>(() => ({
    transform: `translateY(${translateY}px)`,
  }), [translateY])

  const contentStyle = useMemo<React.CSSProperties>(() => {
    const vh = getViewportHeight()
    const panelHeight = vh * MAX_EXPANDED_FRACTION
    const maxHeight = panelHeight - HANDLE_HEIGHT
    return {
      maxHeight,
      overflowY: 'auto' as const,
    }
  }, [translateY]) // recalc when snap changes (viewport may have changed)

  return {
    sheetRef,
    handleRef,
    contentRef,
    sheetStyle,
    contentStyle,
  }
}
