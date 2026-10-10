import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Map, {
  AttributionControl,
  Layer,
  Marker,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'
import type { GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../map/worker'
import { toast } from 'sonner'
import { LocateFixed } from 'lucide-react'
import type { PlannedRoute } from '../api/routePlan'
import { appLanguage } from '../i18n'
import { bikeFeatures, hazardFeatures, pointFeatures, routeFeatures } from '../map/features'
import { buildMapStyle } from '../map/mapStyle'
import { readMapPalette } from '../map/palette'
import { mostDistinctPoint } from '../map/routeProgress'
import type { CityBikeStation } from '../services/citybikes'
import type { Hazard } from '../services/hazards'
import { useColorScheme } from '../theme/colorScheme'
import type { AddressOption } from '../utils/address'
import { getBoundsFromLegsAndPoints, toDisplayLegs, type LatLng } from '../utils/routeGeometry'
import { MapContextMenu } from './MapContextMenu'
import { RoadworkDetails } from './RoadworkDetails'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const HELSINKI: LatLng = [60.1699, 24.9384]

/** Free space around routes when fitting the view, on top of the panels. */
export type MapInsets = { top: number; right: number; bottom: number; left: number }

type RouteMapProps = {
  routes: PlannedRoute[]
  selectedId: string | null
  onSelectRoute: (id: string) => void
  from?: LatLng
  to?: LatLng
  userLocation?: LatLng
  /** The start is the device location; its pin already marks it. */
  fromIsUser?: boolean
  onLocate: () => void
  hazards: Hazard[]
  cityBikes: CityBikeStation[]
  onSetOrigin: (option: AddressOption) => void
  onSetDestination: (option: AddressOption) => void
  /** Space the sheet or side panel covers; routes are fitted inside the rest. */
  insets: MapInsets
  /** Whether the layout is the wide one (side panel). */
  wide: boolean
}

// Layer ids that respond to taps
const ROUTE_HIT = 'route-alt-hit'
const BIKE_POINTS = 'bike-points'
const BIKE_CLUSTERS = 'bike-clusters'
const WORKS_POINTS = 'works-points'
const WORKS_CLUSTERS = 'works-clusters'
const INTERACTIVE = [WORKS_POINTS, WORKS_CLUSTERS, BIKE_POINTS, BIKE_CLUSTERS, ROUTE_HIT]
/** Route lines sit under all basemap labels. */
const BELOW_LABELS = 'label-water'

const minutes = (sec: number) => Math.round(sec / 60)
/** Space kept around the trip when framing it, inside the free map area. */
const FIT_MARGIN = 40

export function RouteMap({
  routes,
  selectedId,
  onSelectRoute,
  from,
  to,
  userLocation,
  fromIsUser,
  onLocate,
  hazards,
  cityBikes,
  onSetOrigin,
  onSetDestination,
  insets,
  wide,
}: RouteMapProps) {
  const { t, i18n } = useTranslation()
  const { scheme } = useColorScheme()
  const lang = appLanguage(i18n.language)
  const mapRef = useRef<MapRef>(null)
  const [mapKey, setMapKey] = useState(0)
  const [cursor, setCursor] = useState<string>('')
  const [bikePopup, setBikePopup] = useState<CityBikeStation | null>(null)
  const [hazardId, setHazardId] = useState<string | null>(null)
  const contextMenuHandler = useRef<((e: MapLayerMouseEvent) => void) | null>(null)
  const loaded = useRef(false)
  // Whether the person has moved the map since we last framed the trip
  const userMoved = useRef(false)

  // scheme and lang are read so the style rebuilds when either changes; the
  // palette itself comes from the CSS tokens, already switched by then.
  const palette = useMemo(() => readMapPalette(), [scheme]) // eslint-disable-line react-hooks/exhaustive-deps
  const mapStyle = useMemo(() => buildMapStyle(palette, lang), [palette, lang])

  const selected = routes.find((r) => r.id === selectedId)
  const routeData = useMemo(() => routeFeatures(routes, selectedId), [routes, selectedId])
  const signalData = useMemo(() => pointFeatures((selected?.signalStops ?? []).map((s) => s.at)), [selected])
  const bikeData = useMemo(() => bikeFeatures(cityBikes), [cityBikes])
  const hazardData = useMemo(() => hazardFeatures(hazards), [hazards])
  const hazard = hazards.find((h) => h.id === hazardId) ?? null

  // Label anchors: where each route is most clearly its own line. Computed per
  // plan, not per selection, so labels stay put when switching.
  const labelAnchors = useMemo(() => {
    const anchors: Record<string, LatLng> = {}
    for (const r of routes) {
      const others = routes.filter((o) => o.id !== r.id).flatMap((o) => o.legs)
      const at = mostDistinctPoint(r.legs, others)
      if (at) anchors[r.id] = at
    }
    return anchors
  }, [routes])

  // --- Framing ---------------------------------------------------------------

  // The panels' footprint is the map's persistent padding: the camera centres
  // in the free area, and MapLibre adds any per-call padding on top of it.
  const padding = useMemo(() => {
    const map = mapRef.current
    const h = map?.getContainer().clientHeight ?? window.innerHeight
    const w = map?.getContainer().clientWidth ?? window.innerWidth
    // Always leave some map between the paddings
    const room = 2 * FIT_MARGIN + 120
    return {
      top: insets.top,
      right: insets.right,
      bottom: Math.max(0, Math.min(insets.bottom, h - insets.top - room)),
      left: Math.max(0, Math.min(insets.left, w - insets.right - room)),
    }
  }, [insets])

  const frame = useCallback(
    (animate: boolean) => {
      const map = mapRef.current
      if (!map) return
      const legs = routes.flatMap((r) => toDisplayLegs(r.legs))
      const bounds = getBoundsFromLegsAndPoints(legs, from, to)
      if (bounds.length < 2) return
      const [[s, w], [n, e]] = bounds
      if (s === n && w === e) {
        map.easeTo({ center: [w, s], zoom: Math.max(map.getZoom(), 14), duration: animate ? 600 : 0 })
      } else {
        map.fitBounds(
          [
            [w, s],
            [e, n],
          ],
          { padding: FIT_MARGIN, maxZoom: 16, duration: animate ? 700 : 0 },
        )
      }
      userMoved.current = false
    },
    [routes, from, to],
  )

  // New trip or new endpoints: frame them
  const routesKey = routes.map((r) => r.id).join('|')
  const endpointsKey = `${from?.join(',')}>${to?.join(',')}`
  useEffect(() => {
    if (loaded.current) frame(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesKey, endpointsKey])

  // Panel resized: move the free area, and re-frame unless the person has been
  // exploring the map
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded.current) return
    map.setPadding(padding)
    if (!userMoved.current) frame(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padding])

  // First location fix: centre on it when there is nothing else to show
  const centredOnUser = useRef(false)
  useEffect(() => {
    if (!userLocation || centredOnUser.current || from || to || routes.length) return
    const map = mapRef.current
    if (!map || !loaded.current) return
    centredOnUser.current = true
    map.easeTo({ center: [userLocation[1], userLocation[0]], zoom: 14, duration: 600 })
  }, [userLocation, from, to, routes.length])

  const locate = () => {
    onLocate()
    const map = mapRef.current
    if (map && userLocation) {
      map.easeTo({ center: [userLocation[1], userLocation[0]], zoom: Math.max(map.getZoom(), 15), duration: 600 })
    }
  }

  // --- Interaction -----------------------------------------------------------

  const onClick = (e: MapLayerMouseEvent) => {
    const feature = e.features?.[0]
    if (!feature) return
    const layer = feature.layer.id
    const map = mapRef.current
    if (layer === WORKS_POINTS) {
      setHazardId(String(feature.properties.id))
    } else if (layer === BIKE_POINTS) {
      setBikePopup(cityBikes.find((s) => s.stationId === String(feature.properties.id)) ?? null)
    } else if ((layer === BIKE_CLUSTERS || layer === WORKS_CLUSTERS) && map && feature.geometry.type === 'Point') {
      const source = map.getSource(feature.source) as GeoJSONSource | undefined
      const center = feature.geometry.coordinates as [number, number]
      void source
        ?.getClusterExpansionZoom(Number(feature.properties.cluster_id))
        .then((zoom) => map.easeTo({ center, zoom, duration: 400 }))
    } else if (layer === ROUTE_HIT) {
      onSelectRoute(String(feature.properties.id))
    }
  }

  const onError = (e: { error?: Error }) => {
    // Tile hiccups after load are retried by MapLibre as you pan; only a
    // failure to load the style itself leaves the map blank.
    if (loaded.current) return
    console.warn('[RouteMap] map failed to load:', e.error)
    toast.error(t('map.mapError'), {
      id: 'map-error',
      duration: Infinity,
      action: { label: t('map.retry'), onClick: () => setMapKey((k) => k + 1) },
    })
  }

  const sheetCoversMap = insets.bottom > window.innerHeight * 0.6

  const bindContextMenu = useCallback((handler: (e: MapLayerMouseEvent) => void) => {
    contextMenuHandler.current = handler
  }, [])

  return (
    <div className="relative size-full">
      <Map
        key={mapKey}
        ref={mapRef}
        mapStyle={mapStyle}
        initialViewState={{ longitude: HELSINKI[1], latitude: HELSINKI[0], zoom: 12 }}
        minZoom={5}
        maxZoom={19}
        dragRotate={false}
        touchPitch={false}
        pitchWithRotate={false}
        attributionControl={false}
        interactiveLayerIds={INTERACTIVE}
        cursor={cursor}
        onMouseEnter={() => setCursor('pointer')}
        onMouseLeave={() => setCursor('')}
        onClick={onClick}
        onContextMenu={(e) => contextMenuHandler.current?.(e)}
        onMoveStart={(e) => {
          if ('originalEvent' in e && e.originalEvent) userMoved.current = true
        }}
        onLoad={(e) => {
          loaded.current = true
          e.target.setPadding(padding)
          // Compact attribution starts expanded; keep it as the (i) button until tapped
          e.target.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
          toast.dismiss('map-error')
          if (routes.length || from || to) frame(false)
        }}
        onError={onError}
        style={{ width: '100%', height: '100%' }}
      >
        <AttributionControl
          key={wide ? 'wide' : 'narrow'}
          position={wide ? 'bottom-right' : 'top-left'}
          compact
        />

        {/* City bikes sit under the routes: context, not the subject */}
        <Source
          id="bikes"
          type="geojson"
          data={bikeData}
          cluster
          clusterRadius={28}
          clusterProperties={{ bikes: ['+', ['get', 'bikes']] }}
        >
          <Layer
            id={BIKE_CLUSTERS}
            type="circle"
            beforeId={BELOW_LABELS}
            filter={['has', 'point_count']}
            paint={{
              'circle-color': palette.bike,
              'circle-radius': 11,
              'circle-stroke-color': palette.routeCasing,
              'circle-stroke-width': 1.5,
            }}
          />
          <Layer
            id={BIKE_POINTS}
            type="circle"
            beforeId={BELOW_LABELS}
            filter={['!', ['has', 'point_count']]}
            paint={{
              // An empty station reads as greyed out
              'circle-color': ['case', ['>', ['get', 'bikes'], 0], palette.bike, palette.path],
              'circle-radius': 8,
              'circle-stroke-color': palette.routeCasing,
              'circle-stroke-width': 1.5,
            }}
          />
          <Layer
            id="bike-count"
            type="symbol"
            beforeId={BELOW_LABELS}
            layout={{
              'text-field': ['to-string', ['get', 'bikes']],
              'text-font': ['Noto Sans Bold'],
              'text-size': 10,
              'text-allow-overlap': true,
            }}
            paint={{ 'text-color': palette.bikeInk }}
          />
        </Source>

        <Source id="routes" type="geojson" data={routeData}>
          <Layer
            id="route-alt-casing"
            type="line"
            beforeId={BELOW_LABELS}
            filter={['==', ['get', 'selected'], false]}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': palette.routeCasing, 'line-width': 7 }}
          />
          <Layer
            id="route-alt"
            type="line"
            beforeId={BELOW_LABELS}
            filter={['==', ['get', 'selected'], false]}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': palette.routeAlt, 'line-width': 4 }}
          />
          <Layer
            id={ROUTE_HIT}
            type="line"
            filter={['==', ['get', 'selected'], false]}
            paint={{ 'line-color': '#000000', 'line-opacity': 0.01, 'line-width': 24 }}
          />
          <Layer
            id="route-selected-casing"
            type="line"
            beforeId={BELOW_LABELS}
            filter={['==', ['get', 'selected'], true]}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': palette.routeCasing, 'line-width': 10 }}
          />
          <Layer
            id="route-selected"
            type="line"
            beforeId={BELOW_LABELS}
            filter={['==', ['get', 'selected'], true]}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': palette.routeSelected, 'line-width': 6 }}
          />
        </Source>

        <Source id="works" type="geojson" data={hazardData.areas}>
          <Layer
            id="works-area"
            type="fill"
            beforeId={BELOW_LABELS}
            paint={{ 'fill-color': palette.works, 'fill-opacity': 0.18 }}
          />
          <Layer
            id="works-outline"
            type="line"
            beforeId={BELOW_LABELS}
            paint={{ 'line-color': palette.works, 'line-width': 1.5, 'line-opacity': 0.7 }}
          />
        </Source>

        <Source id="signals" type="geojson" data={signalData}>
          <Layer
            id="signals"
            type="circle"
            paint={{
              'circle-color': palette.signal,
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 6],
              'circle-stroke-color': palette.routeCasing,
              'circle-stroke-width': 2,
            }}
          />
        </Source>

        <Source id="works-points" type="geojson" data={hazardData.points} cluster clusterRadius={36}>
          <Layer
            id={WORKS_CLUSTERS}
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': palette.works,
              'circle-radius': 13,
              'circle-stroke-color': palette.routeCasing,
              'circle-stroke-width': 2,
            }}
          />
          <Layer
            id="works-cluster-count"
            type="symbol"
            filter={['has', 'point_count']}
            layout={{ 'text-field': ['get', 'point_count'], 'text-font': ['Noto Sans Bold'], 'text-size': 12 }}
            paint={{ 'text-color': '#ffffff' }}
          />
          <Layer
            id={WORKS_POINTS}
            type="circle"
            filter={['!', ['has', 'point_count']]}
            paint={{
              'circle-color': palette.works,
              'circle-radius': 8,
              'circle-stroke-color': palette.routeCasing,
              'circle-stroke-width': 2,
            }}
          />
          <Layer
            id="works-point-mark"
            type="symbol"
            filter={['!', ['has', 'point_count']]}
            layout={{ 'text-field': '!', 'text-font': ['Noto Sans Bold'], 'text-size': 12 }}
            paint={{ 'text-color': '#ffffff' }}
          />
        </Source>


        {routes.length > 1 &&
          routes.map((r) => {
            const at = labelAnchors[r.id]
            if (!at) return null
            const isSelected = r.id === selectedId
            return (
              <Marker key={r.id} longitude={at[1]} latitude={at[0]} anchor="bottom" style={{ zIndex: isSelected ? 2 : 1 }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectRoute(r.id)
                  }}
                  aria-pressed={isSelected}
                  className={cn(
                    'tabular mb-1.5 flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-background text-foreground',
                  )}
                >
                  {t('routes.minutes', { count: minutes(r.durationSec) })}
                  <span aria-hidden className="size-2 rounded-full bg-signal" />
                  <span className="sr-only">{t('routes.lights', { count: r.lights })}</span>
                  <span aria-hidden>{r.lights}</span>
                </button>
              </Marker>
            )
          })}

        {userLocation && !fromIsUser && (
          <Marker longitude={userLocation[1]} latitude={userLocation[0]} anchor="center">
            <span aria-hidden className="block size-4 rounded-full bg-primary ring-[3px] ring-background shadow-[0_0_0_8px_color-mix(in_oklab,var(--primary)_15%,transparent)]" />
          </Marker>
        )}
        {from && (
          <Marker longitude={from[1]} latitude={from[0]} anchor="center">
            <span
              role="img"
              aria-label={t('map.start')}
              className="block size-[18px] rounded-full border-4 border-[var(--pin)] bg-[var(--pin-ring)] shadow-md"
            />
          </Marker>
        )}
        {to && (
          <Marker longitude={to[1]} latitude={to[0]} anchor="center">
            <span
              role="img"
              aria-label={t('map.end')}
              className="block size-[18px] rounded-full bg-[var(--pin)] ring-[3px] ring-[var(--pin-ring)] shadow-md"
            />
          </Marker>
        )}

        {bikePopup && (
          <Popup
            longitude={bikePopup.lon}
            latitude={bikePopup.lat}
            anchor="bottom"
            offset={14}
            closeButton={false}
            onClose={() => setBikePopup(null)}
          >
            <div className="flex flex-col px-4 py-3">
              <span className="text-sm font-medium">{bikePopup.name}</span>
              <span className="text-xs text-muted-foreground">
                {t('cityBikes.bikesAvailable', { count: bikePopup.bikesAvailable })}
              </span>
            </div>
          </Popup>
        )}

        <RoadworkDetails hazard={hazard} wide={wide} onClose={() => setHazardId(null)} />

        <MapContextMenu
          onSetOrigin={onSetOrigin}
          onSetDestination={onSetDestination}
          bindContextMenu={bindContextMenu}
        />
      </Map>

      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={locate}
        aria-label={t('map.locate')}
        // Hidden while the sheet covers most of the screen
        tabIndex={sheetCoversMap ? -1 : 0}
        aria-hidden={sheetCoversMap}
        className={cn(
          'absolute right-4 z-10 size-11 shadow-md transition-[bottom,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] dark:bg-background dark:hover:bg-accent',
          sheetCoversMap && 'pointer-events-none opacity-0',
        )}
        style={{ bottom: insets.bottom + 16 }}
      >
        <LocateFixed className="size-5" />
      </Button>
    </div>
  )
}
