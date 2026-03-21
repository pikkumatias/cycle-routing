import { useEffect, useMemo } from 'react'
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  getRouteLegsFromPlanResponse,
  getBoundsFromLegsAndPoints,
  type LatLng,
} from '../utils/routeGeometry'

const originIcon = L.divIcon({
  className: '',
  html: '<div style="width:20px;height:20px;border-radius:50%;background:#4CAF50;border:3px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

const destinationIcon = L.divIcon({
  className: '',
  html: '<div style="width:20px;height:20px;border-radius:50%;background:#E91E63;border:3px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

export const HSL_TILE_CONFIG = {
  url: `https://cdn.digitransit.fi/map/v3/hsl-map-en/{z}/{x}/{y}{r}.png?digitransit-subscription-key=${import.meta.env.VITE_DIGITRANSIT_API_KEY}`,
  minZoom: 5,
  maxZoom: 20,
  maxNativeZoom: 18,
  attribution:
    'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, Tiles &copy; <a href="https://digitransit.fi">Digitransit</a>',
} as const

const ROUTE_COLOR = '#007AC9'
const ROUTE_WEIGHT = 5

type FitBoundsProps = {
  bounds: LatLng[] | null
  from?: LatLng
  to?: LatLng
}

function FitBounds({ bounds, from, to }: FitBoundsProps) {
  const map = useMap()
  // Only re-fit when the origin/destination changes, not on route variant switch
  useEffect(() => {
    if (!bounds || bounds.length < 2) return
    map.fitBounds(bounds as L.LatLngBoundsExpression, {
      paddingTopLeft: [40, 40],
      paddingBottomRight: [40, 200],
      maxZoom: 16,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, from?.[0], from?.[1], to?.[0], to?.[1]])
  return null
}

const ALT_ROUTE_COLOR = '#9e9e9e'
const ALT_ROUTE_WEIGHT = 3
const ALT_ROUTE_OPACITY = 0.4

export type RouteMapProps = {
  routeResponse: any
  from?: LatLng
  to?: LatLng
  height?: number | string
  alternativeResponses?: any[]
}

export function RouteMap({
  routeResponse,
  from,
  to,
  height = '100%',
  alternativeResponses,
}: RouteMapProps) {
  const legs = useMemo(
    () => getRouteLegsFromPlanResponse(routeResponse),
    [routeResponse],
  )
  const altLegsArrays = useMemo(
    () => (alternativeResponses ?? []).map((r) => getRouteLegsFromPlanResponse(r)),
    [alternativeResponses],
  )
  const allLegs = useMemo(() => {
    const all = [...legs]
    altLegsArrays.forEach((a) => all.push(...a))
    return all
  }, [legs, altLegsArrays])
  const bounds = useMemo(
    () => getBoundsFromLegsAndPoints(allLegs, from, to),
    [allLegs, from, to],
  )
  const center: LatLng = useMemo(() => {
    if (bounds.length >= 2) {
      return [
        (bounds[0][0] + bounds[1][0]) / 2,
        (bounds[0][1] + bounds[1][1]) / 2,
      ]
    }
    if (from) return from
    if (to) return to
    return [60.1699, 24.9384]
  }, [bounds, from, to])

  return (
    <div style={{ height, width: '100%' }}>
      <MapContainer
        center={center}
        zoom={13}
        minZoom={HSL_TILE_CONFIG.minZoom}
        maxZoom={HSL_TILE_CONFIG.maxZoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
        zoomControl={false}
      >
        <TileLayer
          attribution={HSL_TILE_CONFIG.attribution}
          url={HSL_TILE_CONFIG.url}
          minZoom={HSL_TILE_CONFIG.minZoom}
          maxZoom={HSL_TILE_CONFIG.maxZoom}
          maxNativeZoom={HSL_TILE_CONFIG.maxNativeZoom}
          detectRetina={true}
          eventHandlers={{
            tileerror: (e) => {
              console.warn('Tile failed to load:', e.tile.src)
            },
          }}
        />
        <FitBounds bounds={bounds.length >= 2 ? bounds : null} from={from} to={to} />
        {altLegsArrays.map((altLegs, altIdx) =>
          altLegs.map((leg, legIdx) => (
            <Polyline
              key={`alt-${altIdx}-${legIdx}`}
              positions={leg.positions}
              pathOptions={{
                color: ALT_ROUTE_COLOR,
                weight: ALT_ROUTE_WEIGHT,
                opacity: ALT_ROUTE_OPACITY,
              }}
            />
          )),
        )}
        {legs.map((leg, i) => (
          <Polyline
            key={i}
            positions={leg.positions}
            pathOptions={{
              color: ROUTE_COLOR,
              weight: ROUTE_WEIGHT,
              opacity: 0.9,
            }}
          />
        ))}
        {from && (
          <Marker position={from} icon={originIcon}>
            <Popup>Start</Popup>
          </Marker>
        )}
        {to && (
          <Marker position={to} icon={destinationIcon}>
            <Popup>End</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  )
}
