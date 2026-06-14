import { useState, useCallback } from 'react'

type Coords = { lat: number; lon: number }

type GeoState = {
  coords: Coords | null
  loading: boolean
  denied: boolean
}

export type UseGeolocationResult = GeoState & {
  request: () => void
}

export function useGeolocation(): UseGeolocationResult {
  const [state, setState] = useState<GeoState>({
    coords: null,
    loading: false,
    denied: false,
  })

  const request = useCallback(() => {
    if (!navigator.geolocation) return
    setState((prev) => ({ ...prev, loading: true }))
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setState({
          coords: { lat: pos.coords.latitude, lon: pos.coords.longitude },
          loading: false,
          denied: false,
        })
      },
      (err) => {
        const denied = err.code === GeolocationPositionError.PERMISSION_DENIED
        setState({ coords: null, loading: false, denied })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }, [])

  return { ...state, request }
}
