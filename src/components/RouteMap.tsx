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

// Fix default marker icons in Leaflet when using bundlers
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})
L.Marker.prototype.options.icon = defaultIcon

export const HSL_TILE_CONFIG = {
  url: `https://cdn.digitransit.fi/map/v3/hsl-map-en/{z}/{x}/{y}.png?digitransit-subscription-key=${import.meta.env.VITE_DIGITRANSIT_API_KEY}`,
  tileSize: 512,
  zoomOffset: -1,
  attribution:
    'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, Tiles &copy; <a href="https://digitransit.fi">Digitransit</a>',
} as const

const ROUTE_COLOR = '#1976d2'
const ROUTE_WEIGHT = 5

type FitBoundsProps = {
  bounds: LatLng[] | null
  padding?: [number, number]
}

function FitBounds({ bounds, padding = [24, 24] }: FitBoundsProps) {
  const map = useMap()
  useEffect(() => {
    if (!bounds || bounds.length < 2) return
    map.fitBounds(bounds as L.LatLngBoundsExpression, { padding })
  }, [map, bounds, padding])
  return null
}

const ALT_ROUTE_COLOR = '#9e9e9e'
const ALT_ROUTE_WEIGHT = 3
const ALT_ROUTE_OPACITY = 0.4

export type RouteMapProps = {
  /** Digitransit plan API response (data with data.plan.itineraries[].legs) */
  routeResponse: any
  /** Start point [lat, lng] for marker */
  from?: LatLng
  /** End point [lat, lng] for marker */
  to?: LatLng
  /** Map container height */
  height?: number | string
  /** Other route responses to render as faded alternatives */
  alternativeResponses?: any[]
}

export function RouteMap({
  routeResponse,
  from,
  to,
  height = 400,
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
  const hasRoute = legs.length > 0
  const center: LatLng = useMemo(() => {
    if (bounds.length >= 2) {
      return [
        (bounds[0][0] + bounds[1][0]) / 2,
        (bounds[0][1] + bounds[1][1]) / 2,
      ]
    }
    if (from) return from
    if (to) return to
    return [60.1699, 24.9384] // Helsinki default
  }, [bounds, from, to])

  if (!hasRoute && !from && !to) return null

  return (
    <div style={{ height, width: '100%', minHeight: 300 }}>
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution={HSL_TILE_CONFIG.attribution}
          url={HSL_TILE_CONFIG.url}
          tileSize={HSL_TILE_CONFIG.tileSize}
          zoomOffset={HSL_TILE_CONFIG.zoomOffset}
        />
        <FitBounds bounds={bounds.length >= 2 ? bounds : null} />
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
          <Marker position={from}>
            <Popup>Start</Popup>
          </Marker>
        )}
        {to && (
          <Marker position={to}>
            <Popup>End</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  )
}
