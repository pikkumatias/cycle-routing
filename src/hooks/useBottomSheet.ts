import { useRef, useState, useEffect, useCallback, useMemo } from 'react'

const EXPANDED_FRACTION = 0.85
const COLLAPSED_FRACTION = 0.20
const VELOCITY_THRESHOLD = 0.5 // px/ms
const DEAD_ZONE = 5 // px — ignore micro-movements (protects taps)
const HANDLE_HEIGHT = 36 // px — handle area including margin
const SNAP_TRANSITION = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)'

function getViewportHeight() {
  return window.innerHeight
}

function getMaxTranslateY() {
  const vh = getViewportHeight()
  return vh * (EXPANDED_FRACTION - COLLAPSED_FRACTION)
}

export function useBottomSheet() {
  const sheetRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const [snapPoint, setSnapPoint] = useState<'collapsed' | 'expanded'>('collapsed')
  const [translateY, setTranslateY] = useState(() => getMaxTranslateY())

  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartTranslateY = useRef(0)
  const prevY = useRef(0)
  const prevTime = useRef(0)
  const currentTranslateY = useRef(getMaxTranslateY())
  const isAnimating = useRef(false)

  // Keep ref in sync with state
  useEffect(() => {
    currentTranslateY.current = translateY
  }, [translateY])

  const snapTo = useCallback((target: 'collapsed' | 'expanded') => {
    const maxTY = getMaxTranslateY()
    const newTY = target === 'collapsed' ? maxTY : 0

    isAnimating.current = true
    const sheet = sheetRef.current
    if (sheet) {
      sheet.style.transition = SNAP_TRANSITION
      const onEnd = () => {
        sheet.style.transition = ''
        isAnimating.current = false
        sheet.removeEventListener('transitionend', onEnd)
      }
      sheet.addEventListener('transitionend', onEnd)
    }

    setTranslateY(newTY)
    setSnapPoint(target)
  }, [])

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
      const maxTY = getMaxTranslateY()
      const newTY = Math.max(0, Math.min(maxTY, dragStartTranslateY.current + delta))
      applyTranslateY(newTY)
      prevY.current = touch.clientY
      prevTime.current = Date.now()
    }

    const onTouchEnd = () => {
      if (!isDragging.current) return
      isDragging.current = false
      const maxTY = getMaxTranslateY()
      const velocity = (prevY.current - dragStartY.current) / (Date.now() - prevTime.current + 1)
      const ty = currentTranslateY.current

      if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
        snapTo(velocity > 0 ? 'collapsed' : 'expanded')
      } else {
        snapTo(ty > maxTY / 2 ? 'collapsed' : 'expanded')
      }
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
        const maxTY = getMaxTranslateY()
        const newTY = Math.max(0, Math.min(maxTY, dragStartTranslateY.current + delta))
        applyTranslateY(newTY)
        prevY.current = ev.clientY
        prevTime.current = Date.now()
      }

      const onMouseUp = () => {
        if (!isDragging.current) return
        isDragging.current = false
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)

        const maxTY = getMaxTranslateY()
        const velocity = (prevY.current - dragStartY.current) / (Date.now() - prevTime.current + 1)
        const ty = currentTranslateY.current

        if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
          snapTo(velocity > 0 ? 'collapsed' : 'expanded')
        } else {
          snapTo(ty > maxTY / 2 ? 'collapsed' : 'expanded')
        }
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
    let startScrollTop = 0
    let isExpanding = false

    const onTouchStart = (e: TouchEvent) => {
      if (isAnimating.current || isDragging.current) return
      startY = e.touches[0].clientY
      startScrollTop = content.scrollTop
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
      const isFullyExpanded = ty <= 0

      if (!isFullyExpanded) {
        // Panel not fully expanded — move the panel
        if (Math.abs(deltaFromStart) < DEAD_ZONE && !isExpanding) return
        isExpanding = true
        e.preventDefault()
        const maxTY = getMaxTranslateY()
        const newTY = Math.max(0, Math.min(maxTY, ty - incrementalDelta))
        applyTranslateY(newTY)
      } else {
        // Panel is fully expanded
        if (content.scrollTop <= 0 && incrementalDelta < 0) {
          // At top of scroll, pulling down — collapse
          e.preventDefault()
          const maxTY = getMaxTranslateY()
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

      const maxTY = getMaxTranslateY()
      const ty = currentTranslateY.current
      const velocity = (prevY.current - startY) / (Date.now() - prevTime.current + 1)

      if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
        snapTo(velocity > 0 ? 'collapsed' : 'expanded')
      } else {
        snapTo(ty > maxTY / 2 ? 'collapsed' : 'expanded')
      }
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
      const maxTY = getMaxTranslateY()
      const newTY = snapPoint === 'collapsed' ? maxTY : 0
      setTranslateY(newTY)
      // Also apply immediately in case state batching delays
      applyTranslateY(newTY)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [snapPoint, applyTranslateY])

  const sheetStyle = useMemo<React.CSSProperties>(() => ({
    transform: `translateY(${translateY}px)`,
  }), [translateY])

  const contentStyle = useMemo<React.CSSProperties>(() => {
    const vh = getViewportHeight()
    const panelHeight = vh * EXPANDED_FRACTION
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
