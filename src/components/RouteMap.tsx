import { useEffect, useMemo } from 'react'
import {
  MapContainer,
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
import type { RouteCategory } from '../api/digitransit'
import type { Hazard } from '../services/hazards'
import { hazardToLatLng } from '../services/hazards'

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

const retinaParam = window.devicePixelRatio > 1 ? '@2x' : ''

export const HSL_TILE_CONFIG = {
  url: `https://cdn.digitransit.fi/map/v3/hsl-map-en/{z}/{x}/{y}${retinaParam}.png?digitransit-subscription-key=${import.meta.env.VITE_DIGITRANSIT_API_KEY}`,
  minZoom: 5,
  maxZoom: 20,
  maxNativeZoom: 18,
  tileSize: 256,
  attribution:
    'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, Tiles &copy; <a href="https://digitransit.fi">Digitransit</a>',
} as const

const TILE_CACHE_NAME = 'hsl-tiles-v1'

const makeHazardIcon = (emoji: string, bg: string) =>
  L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${bg};border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:14px">${emoji}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })

const HAZARD_ICONS = {
  excavation: makeHazardIcon('⚠️', '#FF8C00'),
  traffic_arrangement: makeHazardIcon('🚧', '#D32F2F'),
  area_rental: makeHazardIcon('🏗️', '#F9A825'),
}

const HAZARD_TYPE_LABELS: Record<Hazard['type'], string> = {
  excavation: 'Excavation',
  traffic_arrangement: 'Traffic works',
  area_rental: 'Area rental',
}

class HslCachingTileLayer extends L.TileLayer {
  tileBlobUrls = new WeakMap<HTMLElement, string>()

  override createTile(coords: L.Coords, done?: L.DoneCallback): HTMLElement {
    const img = document.createElement('img')
    if (!done) return img
    const url = this.getTileUrl(coords)

    let settled = false
    const settle = (err: Error | undefined) => {
      if (settled) return
      settled = true
      done(err, img)
    }

    const setImgSrc = (blob: Blob, attemptsLeft: number) => {
      // Revoke any previous blob URL held by this img (retry path)
      const prev = this.tileBlobUrls.get(img)
      if (prev) URL.revokeObjectURL(prev)

      const objUrl = URL.createObjectURL(blob)
      this.tileBlobUrls.set(img, objUrl)
      img.onload = () => settle(undefined)
      img.onerror = () => {
        if (attemptsLeft > 1) {
          setTimeout(() => load(attemptsLeft - 1), 400)
        } else {
          URL.revokeObjectURL(objUrl)
          this.tileBlobUrls.delete(img)
          settle(new Error('img load'))
        }
      }
      img.src = objUrl
    }

    const load = async (attemptsLeft: number): Promise<void> => {
      try {
        if (typeof caches !== 'undefined') {
          const cache = await caches.open(TILE_CACHE_NAME)
          const cached = await cache.match(url)
          if (cached) {
            const blob = await cached.blob()
            setImgSrc(blob, attemptsLeft)
            return
          }
        }

        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const forCache = resp.clone()
        const blob = await resp.blob()

        if (typeof caches !== 'undefined') {
          caches.open(TILE_CACHE_NAME).then((c) => c.put(url, forCache)).catch(() => {})
        }

        setImgSrc(blob, attemptsLeft)
      } catch (err) {
        if (attemptsLeft > 1) {
          setTimeout(() => load(attemptsLeft - 1), 400)
        } else {
          settle(err instanceof Error ? err : new Error(String(err)))
        }
      }
    }

    load(3)
    return img
  }
}

function HslTileLayer() {
  const map = useMap()
  useEffect(() => {
    const layer = new HslCachingTileLayer(HSL_TILE_CONFIG.url, {
      attribution: HSL_TILE_CONFIG.attribution,
      minZoom: HSL_TILE_CONFIG.minZoom,
      maxZoom: HSL_TILE_CONFIG.maxZoom,
      maxNativeZoom: HSL_TILE_CONFIG.maxNativeZoom,
      tileSize: HSL_TILE_CONFIG.tileSize,
      keepBuffer: 4,
      updateWhenIdle: false,
    })
    const onTileUnload = (e: L.TileEvent) => {
      const blobUrl = layer.tileBlobUrls.get(e.tile)
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
        layer.tileBlobUrls.delete(e.tile)
      }
    }
    layer.on('tileunload', onTileUnload)
    layer.addTo(map)
    return () => {
      layer.remove()
      layer.off('tileunload', onTileUnload)
    }
  }, [map])
  return null
}

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

export type AlternativeRoute = {
  category: RouteCategory
  response: unknown
}

export type RouteMapProps = {
  routeResponse: unknown
  from?: LatLng
  to?: LatLng
  height?: number | string
  alternativeRoutes?: AlternativeRoute[]
  onSelectRoute?: (category: RouteCategory) => void
  hazards?: Hazard[]
  hazardsLoading?: boolean
}

export function RouteMap({
  routeResponse,
  from,
  to,
  height = '100%',
  alternativeRoutes,
  onSelectRoute,
  hazards,
}: RouteMapProps) {
  const legs = useMemo(
    () => getRouteLegsFromPlanResponse(routeResponse),
    [routeResponse],
  )
  const altLegsArrays = useMemo(
    () => (alternativeRoutes ?? []).map((r) => ({
      category: r.category,
      legs: getRouteLegsFromPlanResponse(r.response),
    })),
    [alternativeRoutes],
  )
  const allLegs = useMemo(() => {
    const all = [...legs]
    altLegsArrays.forEach((a) => all.push(...a.legs))
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
        <HslTileLayer />
        <FitBounds bounds={bounds.length >= 2 ? bounds : null} from={from} to={to} />
        {altLegsArrays.map((altRoute, altIdx) =>
          altRoute.legs.map((leg, legIdx) => (
            <Polyline
              key={`alt-visual-${altIdx}-${legIdx}`}
              positions={leg.positions}
              pathOptions={{
                color: ALT_ROUTE_COLOR,
                weight: ALT_ROUTE_WEIGHT,
                opacity: ALT_ROUTE_OPACITY,
                interactive: false,
              }}
            />
          )),
        )}
        {altLegsArrays.map((altRoute, altIdx) =>
          altRoute.legs.map((leg, legIdx) => (
            <Polyline
              key={`alt-hit-${altIdx}-${legIdx}`}
              positions={leg.positions}
              pathOptions={{
                color: ALT_ROUTE_COLOR,
                weight: 16,
                opacity: 0.01,
              }}
              eventHandlers={{
                click: () => onSelectRoute?.(altRoute.category),
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
        {(hazards ?? []).map((hazard) => {
          const pos = hazardToLatLng(hazard)
          if (!pos) return null
          return (
            <Marker key={hazard.id} position={pos} icon={HAZARD_ICONS[hazard.type]}>
              <Popup>
                <strong>{HAZARD_TYPE_LABELS[hazard.type]}</strong>
                {hazard.address && <div>{hazard.address}</div>}
                {hazard.purpose && (
                  <div style={{ fontSize: '0.85em', color: '#555' }}>{hazard.purpose}</div>
                )}
                {(hazard.startDate || hazard.endDate) && (
                  <div style={{ fontSize: '0.8em', marginTop: 4 }}>
                    {hazard.startDate ?? '?'} – {hazard.endDate ?? '?'}
                  </div>
                )}
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
    </div>
  )
}
