import { useEffect, useState } from 'react'
import { fetchCityBikeStations, filterStationsNearEndpoints, type CityBikeStation } from '../services/citybikes'
import type { LatLng } from '../utils/routeGeometry'

/**
 * City bike stations near the trip's start and destination. Independent of
 * which route is selected. When disabled the last result is kept but callers
 * hide it, so toggling back on shows it instantly.
 */
export function useCityBikes(
  enabled: boolean,
  endpoints: { from: LatLng; to: LatLng } | null,
): { loading: boolean; items: CityBikeStation[] } {
  const [state, setState] = useState<{ loading: boolean; items: CityBikeStation[] }>({ loading: false, items: [] })

  useEffect(() => {
    if (!enabled || !endpoints) return
    let cancelled = false
    void (async () => {
      setState((prev) => ({ ...prev, loading: true }))
      try {
        const raw = await fetchCityBikeStations()
        if (cancelled) return
        setState({ loading: false, items: filterStationsNearEndpoints(raw, endpoints.from, endpoints.to) })
      } catch (err) {
        if (!cancelled) {
          console.warn('[useCityBikes] fetch failed:', err)
          setState((prev) => ({ ...prev, loading: false }))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, endpoints])

  return state
}
