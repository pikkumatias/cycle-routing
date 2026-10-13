import { useState, useCallback, useRef } from 'react'

type Coords = { lat: number; lon: number }

export type GeoErrorKind = 'denied' | 'unavailable' | 'timeout'

type GeoState = {
  /** The last known position; kept when a later request fails. */
  coords: Coords | null
  loading: boolean
  denied: boolean
  /** The last failure of a request someone asked for; a new object each time. */
  error: { kind: GeoErrorKind } | null
}

export type UseGeolocationResult = GeoState & {
  /** Ask for a fix now. `quiet` requests (not started by the person) don't report failures. */
  request: (options?: { quiet?: boolean }) => void
  /** Quietly ask for a fix in the background, unless the last one is still fresh. */
  refresh: () => void
}

/** A fix younger than this is good enough to reuse. */
const FRESH_MS = 60_000

function errorKind(code: number): GeoErrorKind {
  if (code === GeolocationPositionError.PERMISSION_DENIED) return 'denied'
  if (code === GeolocationPositionError.TIMEOUT) return 'timeout'
  return 'unavailable'
}

export function useGeolocation(): UseGeolocationResult {
  const [state, setState] = useState<GeoState>({ coords: null, loading: false, denied: false, error: null })
  const fixedAt = useRef(0)

  const request = useCallback((options?: { quiet?: boolean }) => {
    if (!navigator.geolocation) return
    setState((prev) => ({ ...prev, loading: true }))
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        fixedAt.current = Date.now()
        setState({
          coords: { lat: pos.coords.latitude, lon: pos.coords.longitude },
          loading: false,
          denied: false,
          error: null,
        })
      },
      (err) => {
        const kind = errorKind(err.code)
        setState((prev) => ({
          ...prev,
          loading: false,
          denied: kind === 'denied',
          error: options?.quiet ? prev.error : { kind },
        }))
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: FRESH_MS },
    )
  }, [])

  const refresh = useCallback(() => {
    if (Date.now() - fixedAt.current > FRESH_MS) request({ quiet: true })
  }, [request])

  return { ...state, request, refresh }
}
