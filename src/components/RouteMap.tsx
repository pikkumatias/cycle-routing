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

export type RouteMapProps = {
  /** Digitransit plan API response (data with data.plan.itineraries[].legs) */
  routeResponse: any
  /** Start point [lat, lng] for marker */
  from?: LatLng
  /** End point [lat, lng] for marker */
  to?: LatLng
  /** Map container height */
  height?: number | string
}

export function RouteMap({
  routeResponse,
  from,
  to,
  height = 400,
}: RouteMapProps) {
  const legs = useMemo(
    () => getRouteLegsFromPlanResponse(routeResponse),
    [routeResponse],
  )
  const bounds = useMemo(
    () => getBoundsFromLegsAndPoints(legs, from, to),
    [legs, from, to],
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
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds bounds={bounds.length >= 2 ? bounds : null} />
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
