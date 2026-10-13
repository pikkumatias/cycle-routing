import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import {
  defaultCard,
  fetchRoutePlan,
  RETRYABLE,
  RoutePlanError,
  type Endpoints,
  type PlanFailure,
  type RoutePlan,
} from './api/routePlan'
import type { MapInsets } from './components/RouteMap'
import { RouteOptions, RouteOptionsSkeleton } from './components/RouteOptions'
import { TripPlanner, type TripField } from './components/TripPlanner'
import { OptionsMenu } from './components/OptionsMenu'
import { useBottomSheet } from './hooks/useBottomSheet'
import { useCityBikes } from './hooks/useCityBikes'
import { useGeolocation } from './hooks/useGeolocation'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useOnline } from './hooks/useOnline'
import { useRoadworks } from './hooks/useRoadworks'
import type { AddressOption } from './utils/address'
import { useRidingSpeed } from './settings/ridingSpeed'
import { addRecentSearch, getRecentSearches } from './utils/recentSearches'
import type { LatLng } from './utils/routeGeometry'
import { haversineDistance } from './routing/geo'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

type PlanState = {
  loading: boolean
  error: PlanFailure | null
  plan: RoutePlan | null
  /** Route id of the selected card. */
  selectedId: string | null
  /** Where the plan goes from and to; overlays are fetched around these. */
  endpoints: Endpoints | null
}

const toLatLng = (o: AddressOption | null): LatLng | undefined => (o ? [o.lat, o.lon] : undefined)
const tripKey = (from: AddressOption, to: AddressOption, speed: string) => `${from.lat},${from.lon}>${to.lat},${to.lon}@${speed}`

// The map (MapLibre, ~1 MB) and the place search load after the panel, so the trip planner is
// usable first. The search is fetched right after the first paint, before anyone taps a field.
const RouteMap = lazy(() => import('./components/RouteMap').then((m) => ({ default: m.RouteMap })))
const loadSearchPanel = () => import('./components/SearchPanel')
const SearchPanel = lazy(() => loadSearchPanel().then((m) => ({ default: m.SearchPanel })))

/** A "Your location" start follows a new fix only past this distance, so jitter doesn't re-plan. */
const LOCATION_MOVED_M = 30

/** Side panel width on wide screens, plus its 16px inset. */
const SIDE_PANEL_PX = 400 + 16

function App() {
  const { t } = useTranslation()
  const wide = useMediaQuery('(min-width: 768px)')

  const [from, setFrom] = useState<AddressOption | null>(null)
  const [to, setTo] = useState<AddressOption | null>(null)
  const [recentSearches, setRecentSearches] = useState(() => getRecentSearches())
  const [planState, setPlanState] = useState<PlanState>({
    loading: false,
    error: null,
    plan: null,
    selectedId: null,
    endpoints: null,
  })
  const [showRoadworks, setShowRoadworks] = useState(false)
  const [showCityBikes, setShowCityBikes] = useState(true)
  const [search, setSearch] = useState<{ open: boolean; field: TripField }>({ open: false, field: 'origin' })

  const geolocation = useGeolocation()
  const speed = useRidingSpeed()
  const online = useOnline()
  const { sheetRef, handleRef, contentRef, peekRef, sheetStyle, contentStyle, snapTo, snapPoint, visibleHeight } =
    useBottomSheet({ enabled: !wide })

  const roadworks = useRoadworks(showRoadworks, planState.plan, planState.selectedId, planState.endpoints)
  const cityBikes = useCityBikes(showCityBikes, planState.endpoints)

  useEffect(() => {
    void loadSearchPanel()
  }, [])

  // Locate on start only if already allowed; otherwise the browser asks when the person
  // first reaches for their location (the start field or the locate button)
  const { request: requestLocation } = geolocation
  useEffect(() => {
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((status) => status.state === 'granted' && requestLocation({ quiet: true }))
      .catch(() => {})
  }, [requestLocation])

  // A location fix becomes the start unless one was chosen, and moves a "Your location" start
  // that it has left behind
  useEffect(() => {
    const coords = geolocation.coords
    if (!coords) return
    setFrom((prev) => {
      const moved = prev ? haversineDistance([prev.lat, prev.lon], [coords.lat, coords.lon]) : Infinity
      if (prev && (prev.group !== 'Location' || moved < LOCATION_MOVED_M)) return prev
      return { label: '', ...coords, group: 'Location' }
    })
  }, [geolocation.coords])

  useEffect(() => {
    if (geolocation.error) toast.error(t(`location.error_${geolocation.error.kind}`))
  }, [geolocation.error, t])

  // --- Planning: runs whenever both ends are set and differ from the last plan ---

  const requestRef = useRef<AbortController | null>(null)
  const plannedKey = useRef<string | null>(null)

  const plan = useCallback(async (start: AddressOption, end: AddressOption) => {
    // A newer trip supersedes the one in flight
    requestRef.current?.abort()
    const request = new AbortController()
    requestRef.current = request
    plannedKey.current = tripKey(start, end, speed)
    setPlanState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const result = await fetchRoutePlan(
        { lat: start.lat, lon: start.lon },
        { lat: end.lat, lon: end.lon },
        request.signal,
        speed,
      )
      if (request !== requestRef.current) return
      for (const o of [start, end]) {
        if (o.group !== 'Location') addRecentSearch({ label: o.label, lat: o.lat, lon: o.lon })
      }
      setRecentSearches(getRecentSearches())
      setPlanState({
        loading: false,
        error: null,
        plan: result,
        selectedId: defaultCard(result.cards)?.routeId ?? null,
        endpoints: { from: [start.lat, start.lon], to: [end.lat, end.lon] },
      })
    } catch (error) {
      if (request !== requestRef.current) return
      plannedKey.current = null
      setPlanState({
        loading: false,
        error: error instanceof RoutePlanError ? error.code : 'SERVER_ERROR',
        plan: null,
        selectedId: null,
        endpoints: null,
      })
    }
  }, [speed])

  useEffect(() => {
    if (!from || !to) return
    // A new riding speed re-plans too: `plan` changes with it
    if (plannedKey.current === tripKey(from, to, speed)) return
    void plan(from, to)
  }, [from, to, speed, plan])

  // Offline: say so while it lasts. Back online: retry a plan that failed for want of a connection.
  useEffect(() => {
    if (!online) {
      toast(t('app.offline'), { id: 'offline', duration: Infinity, icon: <WifiOff className="size-4" /> })
      return
    }
    toast.dismiss('offline')
    if (from && to && (planState.error === 'OFFLINE' || planState.error === 'NETWORK')) void plan(from, to)
    // Only on a change of connection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  // Open the sheet to show what is happening and what came back
  const hasPlan = planState.plan !== null
  useEffect(() => {
    if (planState.loading || hasPlan || planState.error) snapTo('expanded')
  }, [planState.loading, hasPlan, planState.error, snapTo])

  // --- Editing the trip ---

  const openSearch = (field: TripField) => {
    setSearch({ open: true, field })
    if (field === 'origin') geolocation.refresh()
  }

  const setField = (field: TripField, option: AddressOption) => {
    if (field === 'origin') setFrom(option)
    else setTo(option)
  }

  const handleSearchSelect = (option: AddressOption) => {
    setField(search.field, option)
    setSearch((s) => ({ ...s, open: false }))
  }

  const swap = () => {
    setFrom(to)
    setTo(from)
  }

  const findRoutes = () => {
    if (from && to) void plan(from, to)
  }

  // --- Derived ---

  const routes = useMemo(() => planState.plan?.routes ?? [], [planState.plan])
  const routesById = useMemo(() => Object.fromEntries(routes.map((r) => [r.id, r])), [routes])
  const onSelectRoute = useCallback((id: string) => setPlanState((prev) => ({ ...prev, selectedId: id })), [])

  const insets = useMemo<MapInsets>(
    () =>
      wide
        ? { top: 0, right: 64, bottom: 0, left: SIDE_PANEL_PX }
        : { top: 64, right: 0, bottom: visibleHeight, left: 0 },
    [wide, visibleHeight],
  )

  const userLocation = geolocation.coords ? ([geolocation.coords.lat, geolocation.coords.lon] as LatLng) : undefined
  const showFindButton = !hasPlan
  const canRetry = planState.error !== null && RETRYABLE.has(planState.error)
  const searchField = search.field === 'origin' ? from : to

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background">
      <section
        ref={sheetRef}
        style={sheetStyle}
        aria-label={t('app.title')}
        className={cn(
          'absolute z-10 flex flex-col bg-background',
          wide
            ? 'top-4 bottom-4 left-4 w-[400px] rounded-xl border shadow-lg'
            : 'inset-x-0 bottom-0 rounded-t-xl border-t shadow-[0_-4px_16px_rgb(0_0_0/0.08)] will-change-transform',
        )}
      >
        {!wide && (
          <button
            ref={handleRef}
            type="button"
            aria-label={t('map.dragHandle')}
            aria-expanded={snapPoint !== 'collapsed'}
            className="flex h-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-t-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
          >
            <span className="h-1.5 w-12 rounded-full bg-muted" />
          </button>
        )}

        <div
          ref={contentRef}
          style={contentStyle}
          className={cn(
            'relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4',
            wide ? 'pt-5 pb-5' : 'pb-[max(16px,env(safe-area-inset-bottom))]',
          )}
        >
          <div ref={peekRef} className="flex flex-col gap-3">
            <h1 className={wide ? 'px-1 text-sm font-medium text-muted-foreground' : 'sr-only'}>{t('app.title')}</h1>
            <TripPlanner
              from={from}
              to={to}
              onEdit={openSearch}
              onSwap={swap}
              locationLoading={geolocation.loading}
              locationDenied={geolocation.denied}
            />
            {showFindButton && (
              <Button
                type="button"
                onClick={findRoutes}
                disabled={!from || !to || planState.loading}
                size="lg"
                className="h-11 w-full"
              >
                {planState.loading && <Loader2 className="size-4 animate-spin" />}
                {planState.loading ? t('routes.findingRoutes') : canRetry ? t('routes.retry') : t('routes.findRoutes')}
              </Button>
            )}
          </div>

          {/* Off-screen while the sheet is collapsed: keep it out of the tab order */}
          <div inert={!wide && snapPoint === 'collapsed'} className="flex flex-col">
            {planState.error && (
              <Alert variant="destructive" className="mt-3">
                <AlertCircle />
                <AlertTitle>{t('routes.error')}</AlertTitle>
                <AlertDescription>{t(`planErrors.${planState.error}`)}</AlertDescription>
              </Alert>
            )}

            {planState.loading && !hasPlan && (
              <div className="mt-2">
                <RouteOptionsSkeleton />
              </div>
            )}

            {planState.plan && (
              <div className={cn('mt-2 transition-opacity', planState.loading && 'opacity-50')}>
                <RouteOptions
                  cards={planState.plan.cards}
                  routesById={routesById}
                  selectedId={planState.selectedId}
                  onSelect={onSelectRoute}
                  roadworks={{ enabled: showRoadworks, ...roadworks }}
                />
              </div>
            )}
          </div>
        </div>
      </section>

      <OptionsMenu
        showCityBikes={showCityBikes}
        onShowCityBikes={setShowCityBikes}
        showRoadworks={showRoadworks}
        onShowRoadworks={setShowRoadworks}
        className="absolute top-[max(16px,calc(env(safe-area-inset-top)+8px))] right-4 z-20"
      />

      {/* After the panel in the DOM so keyboard focus reaches the panel first; z-0 keeps it underneath */}
      <div className="absolute inset-0 z-0">
        <Suspense fallback={null}>
          <RouteMap
            routes={routes}
            selectedId={planState.selectedId}
            onSelectRoute={onSelectRoute}
            from={toLatLng(from)}
            to={toLatLng(to)}
            userLocation={userLocation}
            fromIsUser={from?.group === 'Location'}
            onLocate={() => geolocation.request()}
            hazards={showRoadworks && hasPlan ? roadworks.items : []}
            cityBikes={showCityBikes && hasPlan ? cityBikes.items : []}
            onSetOrigin={(o) => setField('origin', o)}
            onSetDestination={(o) => setField('destination', o)}
            insets={insets}
            wide={wide}
          />
        </Suspense>
      </div>

      <Suspense fallback={null}>
        <SearchPanel
          open={search.open}
          onClose={() => setSearch((s) => ({ ...s, open: false }))}
          onSelect={handleSearchSelect}
          field={search.field}
          initialInputValue={searchField && searchField.group !== 'Location' ? searchField.label : ''}
          recentSearches={recentSearches}
          locationCoords={geolocation.coords}
          locationLoading={geolocation.loading}
          locationDenied={geolocation.denied}
          onRequestLocation={() => geolocation.request()}
        />
      </Suspense>

      <Toaster position="top-center" />
    </div>
  )
}

export default App
