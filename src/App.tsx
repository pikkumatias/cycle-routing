import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  Stack,
} from '@mui/material'
import './App.css'
import {
  parseLatLon,
  fetchCandidateRoutes,
  type RouteCategory,
} from './api/digitransit'
import { RouteMap } from './components/RouteMap'
import { RouteCards, RouteCardsSkeleton, type ScoredRoute } from './components/RouteCards'
import { SearchDrawer, type AddressOption } from './components/SearchDrawer'
import { AddressTrigger } from './components/AddressTrigger'
import {
  estimateBboxFromEndpoints,
  getRouteLegsFromPlanResponse,
  getBoundsFromLegsAndPoints,
  type LatLng,
} from './utils/routeGeometry'
import {
  fetchHazards,
  filterHazardsNearRoute,
  type Hazard,
} from './services/hazards'
import { fetchPoisAndInfrastructure, boundsToBbox } from './utils/overpass'
import type { OsmPoi } from './utils/overpass'
import { deduplicateRoutes, selectRoutes } from './utils/routeSelection'
import {
  getRecentSearches,
  addRecentSearch,
} from './utils/recentSearches'
import { useBottomSheet } from './hooks/useBottomSheet'

type RoutesState = {
  loading: boolean
  error: string | null
  routes: Record<RouteCategory, ScoredRoute> | null
  selectedRoute: RouteCategory
}

function App() {
  const [fromOption, setFromOption] = useState<AddressOption | null>(null)
  const [toOption, setToOption] = useState<AddressOption | null>(null)
  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')
  const [recentSearches, setRecentSearches] = useState(() => getRecentSearches())
  const [routesState, setRoutesState] = useState<RoutesState>({
    loading: false,
    error: null,
    routes: null,
    selectedRoute: 'calm',
  })
  const [lastCoords, setLastCoords] = useState<{
    from: LatLng
    to: LatLng
  } | null>(null)
  const [hazardsData, setHazardsData] = useState<{ loading: boolean; items: Hazard[] }>({ loading: false, items: [] })

  // Debug flag: set to true to show all active construction work across Helsinki regardless of route
  const DEBUG_SHOW_ALL_HAZARDS = false
  const [debugHazards, setDebugHazards] = useState<Hazard[]>([])
  useEffect(() => {
    if (!DEBUG_SHOW_ALL_HAZARDS) return
    const HELSINKI_BOUNDS = { minLat: 60.05, minLon: 24.70, maxLat: 60.35, maxLon: 25.20 }
    let cancelled = false
    void (async () => {
      try {
        const hazards = await fetchHazards(HELSINKI_BOUNDS)
        if (!cancelled) setDebugHazards(hazards)
      } catch (err) {
        console.warn('[App] debug hazard fetch failed:', err)
      }
    })()
    return () => { cancelled = true }
  }, [DEBUG_SHOW_ALL_HAZARDS])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeField, setActiveField] = useState<'origin' | 'destination'>('origin')

  const { sheetRef, handleRef, contentRef, sheetStyle, contentStyle } = useBottomSheet()

  useEffect(() => {
    if (!routesState.routes || !lastCoords) return
    const selectedRouteData = routesState.routes[routesState.selectedRoute]
    if (!selectedRouteData) return

    const legs = getRouteLegsFromPlanResponse(selectedRouteData.response)
    const bounds = getBoundsFromLegsAndPoints(legs, lastCoords.from, lastCoords.to)
    if (bounds.length < 2) return

    const BUFFER = 0.002 // ~200m in degrees
    const hazardBounds = {
      minLat: bounds[0][0] - BUFFER,
      minLon: bounds[0][1] - BUFFER,
      maxLat: bounds[1][0] + BUFFER,
      maxLon: bounds[1][1] + BUFFER,
    }
    const polyline = legs.flatMap((leg) => leg.positions)

    let cancelled = false
    void (async () => {
      setHazardsData({ loading: true, items: [] })
      try {
        const raw = await fetchHazards(hazardBounds)
        if (!cancelled) {
          setHazardsData({ loading: false, items: filterHazardsNearRoute(raw, polyline) })
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[App] hazard fetch failed:', err)
          setHazardsData((prev) => ({ ...prev, loading: false }))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [routesState.selectedRoute, routesState.routes, lastCoords])

const resolveCoords = (option: AddressOption | null, input: string) => {
    if (option) return { lat: option.lat, lon: option.lon }
    return parseLatLon(input)
  }

  const openDrawer = (field: 'origin' | 'destination') => {
    setActiveField(field)
    setDrawerOpen(true)
  }

  const handleDrawerSelect = (option: AddressOption) => {
    if (activeField === 'origin') {
      setFromOption(option)
      setFromInput(option.label)
    } else {
      setToOption(option)
      setToInput(option.label)
    }
    setDrawerOpen(false)
  }

  const handleDrawerClose = () => {
    setDrawerOpen(false)
  }

  const handleSetOriginFromMap = (option: AddressOption) => {
    setFromOption(option)
    setFromInput(option.label)
  }

  const handleSetDestinationFromMap = (option: AddressOption) => {
    setToOption(option)
    setToInput(option.label)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()

    try {
      const from = resolveCoords(fromOption, fromInput)
      const to = resolveCoords(toOption, toInput)
      const fromLatLng: LatLng = [from.lat, from.lon]
      const toLatLng: LatLng = [to.lat, to.lon]

      setRoutesState({ loading: true, error: null, routes: null, selectedRoute: 'calm' })

      // Estimate bbox from endpoints so Overpass can start in parallel with routes
      const estimatedBounds = estimateBboxFromEndpoints(fromLatLng, toLatLng)
      const estimatedBbox = boundsToBbox(estimatedBounds)

      // Launch routes + Overpass in parallel
      const [candidates, poisResult] = await Promise.all([
        fetchCandidateRoutes(from, to),
        estimatedBbox
          ? fetchPoisAndInfrastructure(estimatedBbox).then(
              (pois) => ({ pois, failed: false }),
              () => ({ pois: [] as OsmPoi[], failed: true }),
            )
          : Promise.resolve({ pois: [] as OsmPoi[], failed: false }),
      ])

      const { pois, failed: poisFailed } = poisResult

      // De-duplicate near-identical routes, then select best per category
      const unique = deduplicateRoutes(candidates)
      const scored = selectRoutes(unique, pois)

      if (fromOption) {
        addRecentSearch({ label: fromOption.label, lat: fromOption.lat, lon: fromOption.lon })
      }
      if (toOption) {
        addRecentSearch({ label: toOption.label, lat: toOption.lat, lon: toOption.lon })
      }
      setRecentSearches(getRecentSearches())

      setRoutesState({
        loading: false,
        error: poisFailed ? 'Scoring unavailable \u2014 Overpass API timed out.' : null,
        routes: scored,
        selectedRoute: 'calm',
      })
      setLastCoords({ from: fromLatLng, to: toLatLng })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error'
      setRoutesState({
        loading: false,
        error: message,
        routes: null,
        selectedRoute: 'calm',
      })
    }
  }

  const selectedRouteData = routesState.routes?.[routesState.selectedRoute]
  const alternativeRoutes = routesState.routes
    ? (Object.entries(routesState.routes) as [RouteCategory, ScoredRoute][])
        .filter(([key]) => key !== routesState.selectedRoute)
        .map(([key, route]) => ({ category: key, response: route.response }))
    : []

  return (
    <div className="app-layout">
      <div className="map-section">
        <RouteMap
          routeResponse={selectedRouteData?.response ?? null}
          from={lastCoords?.from}
          to={lastCoords?.to}
          height="100%"
          alternativeRoutes={alternativeRoutes}
          onSelectRoute={(key) =>
            setRoutesState((prev) => ({ ...prev, selectedRoute: key }))
          }
          hazards={DEBUG_SHOW_ALL_HAZARDS ? debugHazards : hazardsData.items}
          hazardsLoading={hazardsData.loading}
          onSetOrigin={handleSetOriginFromMap}
          onSetDestination={handleSetDestinationFromMap}
        />
      </div>

      <div className="bottom-panel" ref={sheetRef} style={sheetStyle}>
        <div className="bottom-panel-handle" ref={handleRef} />
        <div className="bottom-panel-content" ref={contentRef} style={contentStyle}>
          <form onSubmit={handleSubmit}>
            <div className="address-fields">
              <Stack spacing={1.5}>
                <AddressTrigger
                  icon="origin"
                  placeholder="Origin"
                  value={fromOption?.label ?? ''}
                  onClick={() => openDrawer('origin')}
                />
                <AddressTrigger
                  icon="destination"
                  placeholder="Where to?"
                  value={toOption?.label ?? ''}
                  onClick={() => openDrawer('destination')}
                />
              </Stack>
            </div>
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={routesState.loading}
              sx={{ mt: 2 }}
            >
              {routesState.loading
                ? 'Finding routes\u2026'
                : 'Find routes'}
            </Button>
          </form>

          {routesState.error && (
            <Alert severity={routesState.routes ? 'warning' : 'error'} sx={{ mt: 2 }}>
              {routesState.error}
            </Alert>
          )}

          {routesState.loading && (
            <Box sx={{ mt: 2 }}>
              <RouteCardsSkeleton />
            </Box>
          )}

          {routesState.routes && selectedRouteData && (
            <Stack spacing={2} sx={{ mt: 2 }}>
              <RouteCards
                routes={routesState.routes}
                selectedRoute={routesState.selectedRoute}
                onSelect={(key) =>
                  setRoutesState((prev) => ({ ...prev, selectedRoute: key }))
                }
                hazardCount={hazardsData.items.length}
                hazardsLoading={hazardsData.loading}
              />
            </Stack>
          )}
        </div>
      </div>

      <SearchDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        onSelect={handleDrawerSelect}
        fieldType={activeField}
        initialInputValue={activeField === 'origin' ? fromInput : toInput}
        recentSearches={recentSearches}
      />
    </div>
  )
}

export default App
