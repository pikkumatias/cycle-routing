import { useState, useEffect, useRef, useMemo } from 'react'
import type { FormEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import i18n from './i18n'
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
import {
  fetchCityBikeStations,
  filterStationsNearEndpoints,
  type CityBikeStation,
} from './services/citybikes'
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
  const { t } = useTranslation()
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
  const hazardCacheRef = useRef<Partial<Record<RouteCategory, Hazard[]>>>({})
  // Raw hazards fetched once for the union bbox of all route variants; filtered
  // client-side per selected route so switching tabs needs no network round-trip.
  const rawHazardsRef = useRef<Hazard[] | null>(null)
  const prevRoutesRef = useRef(routesState.routes)
  const [showHazards, setShowHazards] = useState(true)
  const [showCityBikes, setShowCityBikes] = useState(false)
  const [cityBikesData, setCityBikesData] = useState<{ loading: boolean; items: CityBikeStation[] }>({ loading: false, items: [] })

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
    // Clear caches whenever a new set of routes is loaded
    if (routesState.routes !== prevRoutesRef.current) {
      hazardCacheRef.current = {}
      rawHazardsRef.current = null
      prevRoutesRef.current = routesState.routes
    }

    if (!routesState.routes || !lastCoords) return
    const routes = routesState.routes
    const coords = lastCoords
    const selectedRouteData = routes[routesState.selectedRoute]
    if (!selectedRouteData) return

    // Serve from per-route cache if this route was already filtered
    const cached = hazardCacheRef.current[routesState.selectedRoute]
    if (cached) {
      setHazardsData({ loading: false, items: cached })
      return
    }

    const legs = getRouteLegsFromPlanResponse(selectedRouteData.response)
    const polyline = legs.flatMap((leg) => leg.positions)
    if (polyline.length === 0) return

    let cancelled = false
    void (async () => {
      setHazardsData((prev) => ({ ...prev, loading: true }))
      try {
        // Fetch the raw hazard set once, covering the union bbox of every route
        // variant. Subsequent tab switches reuse it and only re-filter locally.
        let raw = rawHazardsRef.current
        if (!raw) {
          const allLegs = Object.values(routes).flatMap((r) =>
            getRouteLegsFromPlanResponse(r.response),
          )
          const bounds = getBoundsFromLegsAndPoints(allLegs, coords.from, coords.to)
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
          rawHazardsRef.current = fetched
        }
        // Filter in chunks of 10, yielding between each so the map stays
        // interactive and the route card paints before heavy work begins.
        const filtered: Hazard[] = []
        for (let i = 0; i < raw.length; i += 10) {
          if (cancelled) return
          filtered.push(...filterHazardsNearRoute(raw.slice(i, i + 10), polyline))
          if (i + 10 < raw.length) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
          }
        }
        if (!cancelled) {
          hazardCacheRef.current[routesState.selectedRoute] = filtered
          setHazardsData({ loading: false, items: filtered })
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

  useEffect(() => {
    // Stations are filtered to a radius around the origin/destination, so the
    // result is independent of which route variant is selected. The map already
    // hides stations when the toggle is off (cityBikes={[]}), so we just skip
    // fetching here rather than clearing state synchronously.
    if (!showCityBikes || !lastCoords) return
    const coords = lastCoords

    let cancelled = false
    void (async () => {
      setCityBikesData((prev) => ({ ...prev, loading: true }))
      try {
        const raw = await fetchCityBikeStations()
        if (cancelled) return
        const filtered = filterStationsNearEndpoints(raw, coords.from, coords.to)
        if (!cancelled) setCityBikesData({ loading: false, items: filtered })
      } catch (err) {
        if (!cancelled) {
          console.warn('[App] city bike fetch failed:', err)
          setCityBikesData((prev) => ({ ...prev, loading: false }))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showCityBikes, lastCoords])

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
        error: poisFailed ? t('routes.scoringUnavailable') : null,
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
  const trafficLights = useMemo(
    () => (selectedRouteData?.nearbyPois ?? []).filter((p) => p.category === 'traffic_signal'),
    [selectedRouteData],
  )
  const alternativeRoutes = useMemo(
    () =>
      routesState.routes
        ? (Object.entries(routesState.routes) as [RouteCategory, ScoredRoute][])
            .filter(([key]) => key !== routesState.selectedRoute)
            .map(([key, route]) => ({ category: key, response: route.response }))
        : [],
    [routesState.routes, routesState.selectedRoute],
  )

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
          hazards={showHazards && routesState.routes ? (DEBUG_SHOW_ALL_HAZARDS ? debugHazards : hazardsData.items) : []}
          hazardsLoading={hazardsData.loading}
          trafficLights={trafficLights}
          cityBikes={showCityBikes && routesState.routes ? cityBikesData.items : []}
          onSetOrigin={handleSetOriginFromMap}
          onSetDestination={handleSetDestinationFromMap}
        />
      </div>

      <div className="bottom-panel-wrapper" ref={sheetRef} style={sheetStyle}>
        {showHazards && hazardsData.loading && (
          <Box
            sx={{
              position: 'absolute',
              bottom: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              mb: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              bgcolor: 'rgba(0,0,0,0.65)',
              borderRadius: '20px',
              px: 1.5,
              py: 0.75,
              whiteSpace: 'nowrap',
              backdropFilter: 'blur(4px)',
            }}
          >
            <CircularProgress size={14} thickness={5} sx={{ color: 'white' }} />
            <Typography variant="caption" sx={{ color: 'white', fontWeight: 500 }}>
              {t('routes.checkingHazards')}
            </Typography>
          </Box>
        )}
        <div className="bottom-panel">
        <div className="bottom-panel-handle" ref={handleRef} />
        <div className="bottom-panel-content" ref={contentRef} style={contentStyle}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
            <ButtonBase
              onClick={() => i18n.changeLanguage(i18n.language.startsWith('fi') ? 'en' : 'fi')}
              sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary', px: 1, py: 0.5, borderRadius: 1 }}
            >
              {i18n.language.startsWith('fi') ? 'EN' : 'FI'}
            </ButtonBase>
          </Box>
          <form onSubmit={handleSubmit}>
            <div className="address-fields">
              <Stack spacing={1.5}>
                <AddressTrigger
                  icon="origin"
                  placeholder={t('search.origin')}
                  value={fromOption?.label ?? ''}
                  onClick={() => openDrawer('origin')}
                />
                <AddressTrigger
                  icon="destination"
                  placeholder={t('search.whereTo')}
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
              {routesState.loading ? t('routes.findingRoutes') : t('routes.findRoutes')}
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
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={showCityBikes}
                      onChange={(e) => setShowCityBikes(e.target.checked)}
                      size="small"
                    />
                  }
                  label={t('routes.showCityBikes')}
                  sx={{ m: 0 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={showHazards}
                      onChange={(e) => setShowHazards(e.target.checked)}
                      size="small"
                    />
                  }
                  label={t('routes.showHazards')}
                  sx={{ m: 0 }}
                />
              </Box>
              {showHazards && hazardsData.loading && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={14} thickness={5} />
                  <Typography variant="caption" color="text.secondary">
                    {t('routes.checkingHazards')}
                  </Typography>
                </Box>
              )}
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
