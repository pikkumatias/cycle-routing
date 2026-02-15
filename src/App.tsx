import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  Alert,
  Button,
  Stack,
} from '@mui/material'
import './App.css'
import {
  parseLatLon,
  requestAllRouteVariants,
  type RoutePresetKey,
} from './api/digitransit'
import { RouteMap } from './components/RouteMap'
import { RouteCards, type ScoredRoute } from './components/RouteCards'
import { SearchDrawer, type AddressOption } from './components/SearchDrawer'
import { AddressTrigger } from './components/AddressTrigger'
import {
  getRouteLegsFromPlanResponse,
  getBoundsFromLegsAndPoints,
  type LatLng,
} from './utils/routeGeometry'
import { fetchParksAndWater, boundsToBbox } from './utils/overpass'
import { scorePoisNearRoute } from './utils/scenicScore'
import {
  getRecentSearches,
  addRecentSearch,
} from './utils/recentSearches'
import { useBottomSheet } from './hooks/useBottomSheet'

type RoutesState = {
  loading: boolean
  error: string | null
  routes: Record<RoutePresetKey, ScoredRoute> | null
  selectedRoute: RoutePresetKey
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
    selectedRoute: 'scenic',
  })
  const [lastCoords, setLastCoords] = useState<{
    from: LatLng
    to: LatLng
  } | null>(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeField, setActiveField] = useState<'origin' | 'destination'>('origin')

  const { sheetRef, handleRef, contentRef, sheetStyle, contentStyle } = useBottomSheet()

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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()

    try {
      const from = resolveCoords(fromOption, fromInput)
      const to = resolveCoords(toOption, toInput)
      const fromLatLng: LatLng = [from.lat, from.lon]
      const toLatLng: LatLng = [to.lat, to.lon]

      setRoutesState({ loading: true, error: null, routes: null, selectedRoute: 'scenic' })

      const rawRoutes = await requestAllRouteVariants(from, to)

      const allLegs = Object.values(rawRoutes).flatMap((r) =>
        getRouteLegsFromPlanResponse(r),
      )
      const combinedBounds = getBoundsFromLegsAndPoints(
        allLegs,
        fromLatLng,
        toLatLng,
      )
      const bbox = boundsToBbox(combinedBounds)

      let pois: Awaited<ReturnType<typeof fetchParksAndWater>> = []
      let poisFailed = false
      if (bbox) {
        try {
          pois = await fetchParksAndWater(bbox)
        } catch {
          poisFailed = true
        }
      }

      const scored = {} as Record<RoutePresetKey, ScoredRoute>
      for (const [key, response] of Object.entries(rawRoutes) as [
        RoutePresetKey,
        any,
      ][]) {
        const legs = getRouteLegsFromPlanResponse(response)
        const polyline = legs.flatMap((l) => l.positions)
        const itinerary = response?.data?.plan?.itineraries?.[0]
        const durationSec = itinerary?.duration ?? 0
        const distanceKm =
          (itinerary?.legs ?? []).reduce(
            (sum: number, leg: any) => sum + (leg?.distance ?? 0),
            0,
          ) / 1000
        const { count } = scorePoisNearRoute(pois, polyline)
        scored[key] = { response, durationSec, distanceKm, scenicScore: count }
      }

      if (fromOption) {
        addRecentSearch({ label: fromOption.label, lat: fromOption.lat, lon: fromOption.lon })
      }
      if (toOption) {
        addRecentSearch({ label: toOption.label, lat: toOption.lat, lon: toOption.lon })
      }
      setRecentSearches(getRecentSearches())

      setRoutesState({
        loading: false,
        error: poisFailed ? 'Scenic scoring unavailable \u2014 Overpass API timed out.' : null,
        routes: scored,
        selectedRoute: 'scenic',
      })
      setLastCoords({ from: fromLatLng, to: toLatLng })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error'
      setRoutesState({
        loading: false,
        error: message,
        routes: null,
        selectedRoute: 'scenic',
      })
    }
  }

  const selectedRouteData = routesState.routes?.[routesState.selectedRoute]
  const alternativeResponses = routesState.routes
    ? Object.entries(routesState.routes)
        .filter(([key]) => key !== routesState.selectedRoute)
        .map(([, route]) => route.response)
    : []

  return (
    <div className="app-layout">
      <div className="map-section">
        <RouteMap
          routeResponse={selectedRouteData?.response ?? null}
          from={lastCoords?.from}
          to={lastCoords?.to}
          height="100%"
          alternativeResponses={alternativeResponses}
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

          {routesState.routes && selectedRouteData && (
            <Stack spacing={2} sx={{ mt: 2 }}>
              <RouteCards
                routes={routesState.routes}
                selectedRoute={routesState.selectedRoute}
                onSelect={(key) =>
                  setRoutesState((prev) => ({ ...prev, selectedRoute: key }))
                }
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
