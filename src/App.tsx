import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import './App.css'
import {
  parseLatLon,
  requestAllRouteVariants,
  type RoutePresetKey,
} from './api/digitransit'
import { RouteMap } from './components/RouteMap'
import { RouteCards, type ScoredRoute } from './components/RouteCards'
import {
  getRouteLegsFromPlanResponse,
  getBoundsFromLegsAndPoints,
  type LatLng,
} from './utils/routeGeometry'
import { fetchParksAndWater, boundsToBbox } from './utils/overpass'
import { scorePoisNearRoute } from './utils/scenicScore'

type RouteFormState = {
  from: string
  to: string
}

type RoutesState = {
  loading: boolean
  error: string | null
  routes: Record<RoutePresetKey, ScoredRoute> | null
  selectedRoute: RoutePresetKey
}

function App() {
  const [form, setForm] = useState<RouteFormState>({
    from: '',
    to: '',
  })
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

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()

    try {
      const from = parseLatLon(form.from)
      const to = parseLatLon(form.to)
      const fromLatLng: LatLng = [from.lat, from.lon]
      const toLatLng: LatLng = [to.lat, to.lon]

      setRoutesState({ loading: true, error: null, routes: null, selectedRoute: 'scenic' })

      // 1. Fetch all 3 route variants in parallel
      const rawRoutes = await requestAllRouteVariants(from, to)

      // 2. Compute combined bounds across all routes for the Overpass query
      const allLegs = Object.values(rawRoutes).flatMap((r) =>
        getRouteLegsFromPlanResponse(r),
      )
      const combinedBounds = getBoundsFromLegsAndPoints(
        allLegs,
        fromLatLng,
        toLatLng,
      )
      const bbox = boundsToBbox(combinedBounds)

      // 3. Fetch POIs within the combined bounding box
      const pois = bbox ? await fetchParksAndWater(bbox) : []

      // 4. Score each route
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

      setRoutesState({
        loading: false,
        error: null,
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
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h4" gutterBottom>
              Cycle Routing (HSL / Digitransit)
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Enter start and destination coordinates to find{' '}
              <strong>bicycle</strong> routes with scenic scoring.
            </Typography>
          </Box>

          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                label='From (lat,lon), e.g. "60.192059,24.945831"'
                value={form.from}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, from: e.target.value }))
                }
                fullWidth
                required
              />
              <TextField
                label='To (lat,lon), e.g. "60.169857,24.938379"'
                value={form.to}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, to: e.target.value }))
                }
                fullWidth
                required
              />
              <Box>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={routesState.loading}
                >
                  {routesState.loading
                    ? 'Finding routes\u2026'
                    : 'Find routes'}
                </Button>
              </Box>
            </Stack>
          </Box>

          {routesState.error && (
            <Alert severity="error">{routesState.error}</Alert>
          )}

          {routesState.routes && selectedRouteData && (
            <>
              <RouteCards
                routes={routesState.routes}
                selectedRoute={routesState.selectedRoute}
                onSelect={(key) =>
                  setRoutesState((prev) => ({ ...prev, selectedRoute: key }))
                }
              />
              <RouteMap
                routeResponse={selectedRouteData.response}
                from={lastCoords?.from}
                to={lastCoords?.to}
                height={400}
                alternativeResponses={alternativeResponses}
              />
            </>
          )}
        </Stack>
      </Paper>
    </Container>
  )
}

export default App
