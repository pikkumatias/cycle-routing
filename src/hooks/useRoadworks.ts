import { useEffect, useRef, useState } from 'react'
import type { RoutePlan } from '../api/routePlan'
import { fetchHazards, filterHazardsNearRoute, type Hazard } from '../services/hazards'
import { getBoundsFromLegsAndPoints, type LatLng } from '../utils/routeGeometry'

type Endpoints = { from: LatLng; to: LatLng }

/**
 * Roadworks (Helsinki excavation, traffic-arrangement and area-rental permits)
 * near the selected route. Raw roadworks are fetched once per plan for the
 * union bbox of every route, then filtered per route locally and cached, so
 * switching routes needs no network round-trip.
 */
export function useRoadworks(
  enabled: boolean,
  plan: RoutePlan | null,
  selectedId: string | null,
  endpoints: Endpoints | null,
): { loading: boolean; items: Hazard[] } {
  const [state, setState] = useState<{ loading: boolean; items: Hazard[] }>({ loading: false, items: [] })
  const cacheRef = useRef<Record<string, Hazard[]>>({})
  const rawRef = useRef<Hazard[] | null>(null)
  const prevPlanRef = useRef(plan)

  useEffect(() => {
    // Clear caches whenever a new plan is loaded
    if (plan !== prevPlanRef.current) {
      cacheRef.current = {}
      rawRef.current = null
      prevPlanRef.current = plan
    }

    if (!enabled || !plan || !selectedId || !endpoints) return
    const routes = plan.routes
    const selected = routes.find((r) => r.id === selectedId)
    if (!selected) return

    const cached = cacheRef.current[selectedId]
    if (cached) {
      setState({ loading: false, items: cached })
      return
    }

    const polyline = selected.legs.flat()
    if (polyline.length === 0) return

    let cancelled = false
    void (async () => {
      setState((prev) => ({ ...prev, loading: true }))
      try {
        let raw = rawRef.current
        if (!raw) {
          const allLegs = routes.flatMap((r) => r.legs.map((positions) => ({ positions })))
          const bounds = getBoundsFromLegsAndPoints(allLegs, endpoints.from, endpoints.to)
          if (bounds.length < 2) return
          const BUFFER = 0.0003 // ~30m in degrees
          const fetched = await fetchHazards({
            minLat: bounds[0][0] - BUFFER,
            minLon: bounds[0][1] - BUFFER,
            maxLat: bounds[1][0] + BUFFER,
            maxLon: bounds[1][1] + BUFFER,
          })
          if (cancelled) return
          raw = fetched
          rawRef.current = fetched
        }
        // Filter in chunks of 10, yielding between each so the map stays
        // interactive and the route rows paint before heavy work begins.
        const filtered: Hazard[] = []
        for (let i = 0; i < raw.length; i += 10) {
          if (cancelled) return
          filtered.push(...filterHazardsNearRoute(raw.slice(i, i + 10), polyline))
          if (i + 10 < raw.length) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
          }
        }
        if (!cancelled) {
          cacheRef.current[selectedId] = filtered
          setState({ loading: false, items: filtered })
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[useRoadworks] fetch failed:', err)
          setState((prev) => ({ ...prev, loading: false }))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, selectedId, plan, endpoints])

  return state
}
