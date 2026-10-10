import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2 } from 'lucide-react'
import { defaultCard, fetchRoutePlan, type RoutePlan } from './api/routePlan'
import { RouteMap, type MapInsets } from './components/RouteMap'
import { RouteOptions, RouteOptionsSkeleton } from './components/RouteOptions'
import { SearchPanel } from './components/SearchPanel'
import { TripPlanner, type TripField } from './components/TripPlanner'
import { OptionsMenu } from './components/OptionsMenu'
import { useBottomSheet } from './hooks/useBottomSheet'
import { useCityBikes } from './hooks/useCityBikes'
import { useGeolocation } from './hooks/useGeolocation'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useRoadworks } from './hooks/useRoadworks'
import type { AddressOption } from './utils/address'
import { addRecentSearch, getRecentSearches } from './utils/recentSearches'
import type { LatLng } from './utils/routeGeometry'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

type Endpoints = { from: LatLng; to: LatLng }

type PlanState = {
  loading: boolean
  error: string | null
  plan: RoutePlan | null
  /** Route id of the selected card. */
  selectedId: string | null
  /** Where the plan goes from and to; overlays are fetched around these. */
  endpoints: Endpoints | null
}

const toLatLng = (o: AddressOption | null): LatLng | undefined => (o ? [o.lat, o.lon] : undefined)
const tripKey = (from: AddressOption, to: AddressOption) => `${from.lat},${from.lon}>${to.lat},${to.lon}`

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
  const sheet = useBottomSheet({ enabled: !wide })
  const { snapTo } = sheet

  const roadworks = useRoadworks(showRoadworks, planState.plan, planState.selectedId, planState.endpoints)
  const cityBikes = useCityBikes(showCityBikes, planState.endpoints)

  // Ask for the location once on start
  useEffect(() => {
    geolocation.request()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The first location fix becomes the start, unless one was already chosen
  useEffect(() => {
    if (geolocation.coords && !from) {
       
      setFrom({ label: '', ...geolocation.coords, group: 'Location' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geolocation.coords])

  // --- Planning: runs whenever both ends are set and differ from the last plan ---

  const requestRef = useRef(0)
  const plannedKey = useRef<string | null>(null)

  const plan = useCallback(async (start: AddressOption, end: AddressOption) => {
    const request = ++requestRef.current
    plannedKey.current = tripKey(start, end)
    setPlanState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const result = await fetchRoutePlan({ lat: start.lat, lon: start.lon }, { lat: end.lat, lon: end.lon })
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
        error: error instanceof Error ? error.message : String(error),
        plan: null,
        selectedId: null,
        endpoints: null,
      })
    }
  }, [])

  useEffect(() => {
    if (!from || !to) return
    if (plannedKey.current === tripKey(from, to)) return
    void plan(from, to)
  }, [from, to, plan])

  // Open the sheet to show what is happening and what came back
  const hasPlan = planState.plan !== null
  useEffect(() => {
    if (planState.loading || hasPlan || planState.error) snapTo('expanded')
  }, [planState.loading, hasPlan, planState.error, snapTo])

  // --- Editing the trip ---

  const openSearch = (field: TripField) => {
    setSearch({ open: true, field })
    if (field === 'origin') geolocation.request()
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
        : { top: 64, right: 0, bottom: sheet.visibleHeight, left: 0 },
    [wide, sheet.visibleHeight],
  )

  const userLocation = geolocation.coords ? ([geolocation.coords.lat, geolocation.coords.lon] as LatLng) : undefined
  const showFindButton = !hasPlan

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background">
      <div className="absolute inset-0">
        <RouteMap
          routes={routes}
          selectedId={planState.selectedId}
          onSelectRoute={onSelectRoute}
          from={toLatLng(from)}
          to={toLatLng(to)}
          userLocation={userLocation}
          fromIsUser={from?.group === 'Location'}
          onLocate={geolocation.request}
          hazards={showRoadworks && hasPlan ? roadworks.items : []}
          cityBikes={showCityBikes && hasPlan ? cityBikes.items : []}
          onSetOrigin={(o) => setField('origin', o)}
          onSetDestination={(o) => setField('destination', o)}
          insets={insets}
          wide={wide}
        />
      </div>

      <OptionsMenu
        showCityBikes={showCityBikes}
        onShowCityBikes={setShowCityBikes}
        showRoadworks={showRoadworks}
        onShowRoadworks={setShowRoadworks}
        className="absolute top-[max(16px,calc(env(safe-area-inset-top)+8px))] right-4 z-20"
      />

      <section
        ref={sheet.sheetRef}
        style={sheet.sheetStyle}
        aria-label={t('app.title')}
        className={cn(
          'absolute z-10 flex flex-col bg-background',
          wide
            ? 'top-4 bottom-4 left-4 w-[400px] rounded-xl border shadow-lg'
            : 'inset-x-0 bottom-0 rounded-t-xl border-t shadow-[0_-4px_16px_rgb(0_0_0/0.08)] will-change-transform',
        )}
      >
        {!wide && (
          <div
            ref={sheet.handleRef}
            aria-label={t('map.dragHandle')}
            className="flex h-7 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          >
            <span className="h-1.5 w-12 rounded-full bg-muted" />
          </div>
        )}

        <div
          ref={sheet.contentRef}
          style={sheet.contentStyle}
          className={cn(
            'relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4',
            wide ? 'pt-5 pb-5' : 'pb-[max(16px,env(safe-area-inset-bottom))]',
          )}
        >
          <div ref={sheet.peekRef} className="flex flex-col gap-3">
            {wide && <h1 className="px-1 text-sm font-medium text-muted-foreground">{t('app.title')}</h1>}
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
                {planState.loading ? t('routes.findingRoutes') : t('routes.findRoutes')}
              </Button>
            )}
          </div>

          {planState.error && (
            <Alert variant="destructive" className="mt-3">
              <AlertCircle />
              <AlertTitle>{t('routes.error')}</AlertTitle>
              <AlertDescription>{planState.error}</AlertDescription>
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
                roadworks={{ enabled: showRoadworks, loading: roadworks.loading, count: roadworks.items.length }}
              />
            </div>
          )}
        </div>
      </section>

      <SearchPanel
        open={search.open}
        onClose={() => setSearch((s) => ({ ...s, open: false }))}
        onSelect={handleSearchSelect}
        field={search.field}
        initialInputValue={(() => {
          const current = search.field === 'origin' ? from : to
          return current && current.group !== 'Location' ? current.label : ''
        })()}
        recentSearches={recentSearches}
        locationCoords={geolocation.coords}
        locationLoading={geolocation.loading}
        locationDenied={geolocation.denied}
        onRequestLocation={geolocation.request}
      />

      <Toaster position="top-center" />
    </div>
  )
}

export default App
