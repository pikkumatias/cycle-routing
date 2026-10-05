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
import { parseLatLon } from './api/digitransit'
import { defaultCard, fetchRoutePlan, type RoutePlan } from './api/routePlan'
import { RouteMap } from './components/RouteMap'
import { RouteCards, RouteCardsSkeleton } from './components/RouteCards'
import { SearchDrawer, type AddressOption } from './components/SearchDrawer'
import { AddressTrigger } from './components/AddressTrigger'
import { getBoundsFromLegsAndPoints, type LatLng } from './utils/routeGeometry'
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
import {
  getRecentSearches,
  addRecentSearch,
} from './utils/recentSearches'
import { useBottomSheet } from './hooks/useBottomSheet'
import { useGeolocation } from './hooks/useGeolocation'

type PlanState = {
  loading: boolean
  error: string | null
  plan: RoutePlan | null
  /** Route id of the selected card. */
  selectedId: string | null
}

function App() {
  const { t } = useTranslation()
  const [fromOption, setFromOption] = useState<AddressOption | null>(null)
  const [toOption, setToOption] = useState<AddressOption | null>(null)
  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')
  const [recentSearches, setRecentSearches] = useState(() => getRecentSearches())
  const [planState, setPlanState] = useState<PlanState>({
    loading: false,
    error: null,
    plan: null,
    selectedId: null,
  })
  const [lastCoords, setLastCoords] = useState<{
    from: LatLng
    to: LatLng
  } | null>(null)
  const [hazardsData, setHazardsData] = useState<{ loading: boolean; items: Hazard[] }>({ loading: false, items: [] })
  const hazardCacheRef = useRef<Record<string, Hazard[]>>({})
  // Raw hazards fetched once for the union bbox of all route variants; filtered
  // client-side per selected route so switching tabs needs no network round-trip.
  const rawHazardsRef = useRef<Hazard[] | null>(null)
  const prevPlanRef = useRef(planState.plan)
  const [showHazards, setShowHazards] = useState(false)
  const [showCityBikes, setShowCityBikes] = useState(true)
  const [cityBikesData, setCityBikesData] = useState<{ loading: boolean; items: CityBikeStation[] }>({ loading: false, items: [] })

  const geolocation = useGeolocation()
  const isCurrentLocationOriginRef = useRef(false)

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

  // Request location on mount
  useEffect(() => {
    geolocation.request()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-apply GPS coords as origin when location first arrives
  useEffect(() => {
    if (geolocation.coords && !fromOption && !fromInput) {
      const label = t('location.currentLocation')
      setFromOption({ label, lat: geolocation.coords.lat, lon: geolocation.coords.lon, group: 'Recent' })
      setFromInput(label)
      isCurrentLocationOriginRef.current = true
    }
  }, [geolocation.coords, fromOption, fromInput, t])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeField, setActiveField] = useState<'origin' | 'destination'>('origin')

  const { sheetRef, handleRef, contentRef, sheetStyle, contentStyle } = useBottomSheet()

  useEffect(() => {
    // Clear caches whenever a new plan is loaded
    if (planState.plan !== prevPlanRef.current) {
      hazardCacheRef.current = {}
      rawHazardsRef.current = null
      prevPlanRef.current = planState.plan
    }

    if (!showHazards || !planState.plan || !planState.selectedId || !lastCoords) return
    const routes = planState.plan.routes
    const selectedId = planState.selectedId
    const coords = lastCoords
    const selected = routes.find((r) => r.id === selectedId)
    if (!selected) return

    // Serve from per-route cache if this route was already filtered
    const cached = hazardCacheRef.current[selectedId]
    if (cached) {
      setHazardsData({ loading: false, items: cached })
      return
    }

    const polyline = selected.legs.flat()
    if (polyline.length === 0) return

    let cancelled = false
    void (async () => {
      setHazardsData((prev) => ({ ...prev, loading: true }))
      try {
        // Fetch the raw hazard set once, covering the union bbox of every route
        // variant. Subsequent tab switches reuse it and only re-filter locally.
        let raw = rawHazardsRef.current
        if (!raw) {
          const allLegs = routes.flatMap((r) => r.legs.map((positions) => ({ positions })))
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
          hazardCacheRef.current[selectedId] = filtered
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
  }, [showHazards, planState.selectedId, planState.plan, lastCoords])

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
    if (field === 'origin' && isCurrentLocationOriginRef.current) {
      geolocation.request()
    }
  }

  const handleDrawerSelect = (option: AddressOption) => {
    if (activeField === 'origin') {
      setFromOption(option)
      setFromInput(option.label)
      isCurrentLocationOriginRef.current = option.label === t('location.currentLocation')
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

      setPlanState({ loading: true, error: null, plan: null, selectedId: null })

      const plan = await fetchRoutePlan(from, to)

      if (fromOption) {
        addRecentSearch({ label: fromOption.label, lat: fromOption.lat, lon: fromOption.lon })
      }
      if (toOption) {
        addRecentSearch({ label: toOption.label, lat: toOption.lat, lon: toOption.lon })
      }
      setRecentSearches(getRecentSearches())

      setPlanState({
        loading: false,
        error: null,
        plan,
        selectedId: defaultCard(plan.cards)?.routeId ?? null,
      })
      setLastCoords({ from: fromLatLng, to: toLatLng })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error'
      setPlanState({ loading: false, error: message, plan: null, selectedId: null })
    }
  }

  const routesById = useMemo(
    () => Object.fromEntries((planState.plan?.routes ?? []).map((r) => [r.id, r])),
    [planState.plan],
  )
  const selectedRoute = planState.selectedId ? routesById[planState.selectedId] : undefined
  const trafficLights = useMemo(
    () => (selectedRoute?.signalStops ?? []).map((s) => s.at),
    [selectedRoute],
  )
  const alternativeRoutes = useMemo(
    () =>
      (planState.plan?.routes ?? [])
        .filter((r) => r.id !== planState.selectedId)
        .map((r) => ({ id: r.id, legs: r.legs })),
    [planState.plan, planState.selectedId],
  )

  const onSelectRoute = (id: string) =>
    setPlanState((prev) => ({ ...prev, selectedId: id }))

  return (
    <div className="app-layout">
      <div className="map-section">
        <RouteMap
          route={selectedRoute?.legs ?? null}
          from={lastCoords?.from}
          to={lastCoords?.to}
          height="100%"
          alternativeRoutes={alternativeRoutes}
          onSelectRoute={onSelectRoute}
          hazards={showHazards && planState.plan ? (DEBUG_SHOW_ALL_HAZARDS ? debugHazards : hazardsData.items) : []}
          hazardsLoading={hazardsData.loading}
          trafficLights={trafficLights}
          cityBikes={showCityBikes && planState.plan ? cityBikesData.items : []}
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
                  isCurrentLocation={isCurrentLocationOriginRef.current}
                  locationLoading={geolocation.loading && !fromOption}
                />
                {geolocation.denied && !fromOption && (
                  <Typography variant="caption" color="text.secondary" sx={{ pl: 1 }}>
                    {t('location.denied')}
                  </Typography>
                )}
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
              disabled={planState.loading}
              sx={{ mt: 2 }}
            >
              {planState.loading ? t('routes.findingRoutes') : t('routes.findRoutes')}
            </Button>
          </form>

          {planState.error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {planState.error}
            </Alert>
          )}

          {planState.loading && (
            <Box sx={{ mt: 2 }}>
              <RouteCardsSkeleton />
            </Box>
          )}

          {planState.plan && selectedRoute && (
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
                cards={planState.plan.cards}
                routesById={routesById}
                selectedId={planState.selectedId}
                onSelect={onSelectRoute}
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
        initialInputValue={
          activeField === 'origin' && isCurrentLocationOriginRef.current ? '' : activeField === 'origin' ? fromInput : toInput
        }
        recentSearches={recentSearches}
        locationCoords={geolocation.coords}
        locationLoading={geolocation.loading}
        locationDenied={geolocation.denied}
        onRequestLocation={geolocation.request}
      />
    </div>
  )
}

export default App
