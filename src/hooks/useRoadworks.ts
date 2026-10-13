import { useEffect, useRef, useState } from 'react'
import type { Endpoints, RoutePlan } from '../api/routePlan'
import { fetchHazards, filterHazardsNearRoute, type Hazard } from '../services/hazards'
import { getBoundsFromLegsAndPoints } from '../utils/routeGeometry'

export type RoadworksState = {
  loading: boolean
  /** The roadworks couldn't be loaded; `items` is empty then, not "no roadworks". */
  failed: boolean
  items: Hazard[]
}

const IDLE: RoadworksState = { loading: false, failed: false, items: [] }

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
): RoadworksState {
  const [state, setState] = useState<RoadworksState>(IDLE)
  const cacheRef = useRef<Record<string, Hazard[]>>({})
  const rawRef = useRef<Hazard[] | null>(null)
  const prevPlanRef = useRef(plan)

  useEffect(() => {
    // A new plan: forget the old one's roadworks, and don't show them meanwhile
    if (plan !== prevPlanRef.current) {
      cacheRef.current = {}
      rawRef.current = null
      prevPlanRef.current = plan
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(IDLE)
    }

    if (!enabled || !plan || !selectedId || !endpoints) return
    const routes = plan.routes
    const selected = routes.find((r) => r.id === selectedId)
    if (!selected) return

    const cached = cacheRef.current[selectedId]
    if (cached) {
      setState({ loading: false, failed: false, items: cached })
      return
    }

    const polyline = selected.legs.flat()
    const bounds = getBoundsFromLegsAndPoints(
      routes.flatMap((r) => r.legs),
      endpoints.from,
      endpoints.to,
    )
    if (polyline.length === 0 || bounds.length < 2) return

    const controller = new AbortController()
    let cancelled = false
    void (async () => {
      setState((prev) => ({ ...prev, loading: true, failed: false }))
      try {
        let raw = rawRef.current
        if (!raw) {
          const BUFFER = 0.0003 // ~30m in degrees
          raw = await fetchHazards(
            {
              minLat: bounds[0][0] - BUFFER,
              minLon: bounds[0][1] - BUFFER,
              maxLat: bounds[1][0] + BUFFER,
              maxLon: bounds[1][1] + BUFFER,
            },
            controller.signal,
          )
          if (cancelled) return
          rawRef.current = raw
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
          setState({ loading: false, failed: false, items: filtered })
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[useRoadworks] fetch failed:', err)
          setState({ loading: false, failed: true, items: [] })
        }
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [enabled, selectedId, plan, endpoints])

  // Switched off mid-fetch: the fetch is abandoned, so it isn't loading any more
  return enabled ? state : { ...state, loading: false }
}
