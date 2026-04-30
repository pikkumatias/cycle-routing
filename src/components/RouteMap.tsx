import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MapContainer,
  Polyline,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { useMediaQuery } from '@mui/material'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import { MapContextMenu } from './MapContextMenu'
import type { AddressOption } from './SearchDrawer'
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

const HAZARD_TYPE_KEYS: Record<Hazard['type'], string> = {
  excavation: 'hazardTypes.excavation',
  traffic_arrangement: 'hazardTypes.traffic_arrangement',
  area_rental: 'hazardTypes.area_rental',
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

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type HazardClusterLayerProps = {
  hazards: Hazard[]
  isMobile: boolean
  onHazardClick: (hazard: Hazard) => void
}

function HazardClusterLayer({ hazards, isMobile, onHazardClick }: HazardClusterLayerProps) {
  const map = useMap()
  const { t } = useTranslation()
  // Keep callback ref so the effect doesn't re-run on every render
  const onClickRef = useRef(onHazardClick)
  useEffect(() => { onClickRef.current = onHazardClick })

  useEffect(() => {
    const group = L.markerClusterGroup({
      maxClusterRadius: 40,
      showCoverageOnHover: false,
      spiderfyDistanceMultiplier: 1.4,
      iconCreateFunction: (cluster) =>
        L.divIcon({
          className: '',
          html: `<div style="width:34px;height:34px;border-radius:50%;background:#E65100;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:13px;font-family:sans-serif">${cluster.getChildCount()}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
    })

    for (const hazard of hazards) {
      const pos = hazardToLatLng(hazard)
      if (!pos) continue

      const marker = L.marker(pos, { icon: HAZARD_ICONS[hazard.type] })

      if (isMobile) {
        marker.on('click', () => onClickRef.current(hazard))
      } else {
        let html = `<strong>${esc(t(HAZARD_TYPE_KEYS[hazard.type]))}</strong>`
        if (hazard.address) html += `<div>${esc(hazard.address)}</div>`
        if (hazard.purpose) html += `<div style="font-size:0.85em;color:#555">${esc(hazard.purpose)}</div>`
        if (hazard.startDate || hazard.endDate) {
          html += `<div style="font-size:0.8em;margin-top:4px">${esc(hazard.startDate ?? '?')} – ${esc(hazard.endDate ?? '?')}</div>`
        }
        marker.bindPopup(L.popup({ maxHeight: 300 }).setContent(html))
      }

      group.addLayer(marker)
    }

    map.addLayer(group)
    return () => { map.removeLayer(group) }
  }, [map, hazards, isMobile, t])

  return null
}

const HAZARD_FILL: Record<Hazard['type'], string> = {
  excavation: '#FF8C00',
  traffic_arrangement: '#D32F2F',
  area_rental: '#F9A825',
}

function HazardPolygonLayer({ hazards, isMobile, onHazardClick }: HazardClusterLayerProps) {
  const map = useMap()
  const { t } = useTranslation()
  const onClickRef = useRef(onHazardClick)
  useEffect(() => { onClickRef.current = onHazardClick })

  useEffect(() => {
    const polygonHazards = hazards.filter(
      (h) => h.geometry.type === 'Polygon' || h.geometry.type === 'MultiPolygon',
    )
    if (polygonHazards.length === 0) return

    const hazardById = new Map(polygonHazards.map((h) => [h.id, h]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer = L.geoJSON(
      {
        type: 'FeatureCollection',
        features: polygonHazards.map((h) => ({
          type: 'Feature',
          id: h.id,
          geometry: h.geometry as unknown,
          properties: { hazardId: h.id },
        })),
      } as Parameters<typeof L.geoJSON>[0],
      {
        style: (feature) => {
          const h = hazardById.get(feature?.properties?.hazardId as string)
          const color = HAZARD_FILL[h?.type ?? 'excavation']
          return { color, weight: 2, fillColor: color, fillOpacity: 0.2, opacity: 0.85 }
        },
        onEachFeature: (feature, featureLayer) => {
          const h = hazardById.get((feature.properties as { hazardId: string }).hazardId)
          if (!h) return
          if (isMobile) {
            featureLayer.on('click', () => onClickRef.current(h))
          } else {
            let html = `<strong>${esc(t(HAZARD_TYPE_KEYS[h.type]))}</strong>`
            if (h.address) html += `<div>${esc(h.address)}</div>`
            if (h.purpose) html += `<div style="font-size:0.85em;color:#555">${esc(h.purpose)}</div>`
            if (h.startDate || h.endDate)
              html += `<div style="font-size:0.8em;margin-top:4px">${esc(h.startDate ?? '?')} – ${esc(h.endDate ?? '?')}</div>`
            featureLayer.bindPopup(L.popup({ maxHeight: 300 }).setContent(html))
          }
        },
      },
    )

    layer.addTo(map)
    return () => { layer.remove() }
  }, [map, hazards, isMobile, t])

  return null
}

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
  onSetOrigin?: (option: AddressOption) => void
  onSetDestination?: (option: AddressOption) => void
}

export function RouteMap({
  routeResponse,
  from,
  to,
  height = '100%',
  alternativeRoutes,
  onSelectRoute,
  hazards,
  onSetOrigin,
  onSetDestination,
}: RouteMapProps) {
  const { t } = useTranslation()
  const [selectedHazard, setSelectedHazard] = useState<Hazard | null>(null)
  const isMobile = useMediaQuery('(max-width:600px)')
  const handleHazardClick = useCallback((hazard: Hazard) => setSelectedHazard(hazard), [])
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
            <Popup>{t('map.start')}</Popup>
          </Marker>
        )}
        {to && (
          <Marker position={to} icon={destinationIcon}>
            <Popup>{t('map.end')}</Popup>
          </Marker>
        )}
        {(hazards ?? []).length > 0 && (
          <HazardPolygonLayer
            hazards={hazards ?? []}
            isMobile={isMobile}
            onHazardClick={handleHazardClick}
          />
        )}
        {(hazards ?? []).length > 0 && (
          <HazardClusterLayer
            hazards={hazards ?? []}
            isMobile={isMobile}
            onHazardClick={handleHazardClick}
          />
        )}
        {onSetOrigin && onSetDestination && (
          <MapContextMenu onSetOrigin={onSetOrigin} onSetDestination={onSetDestination} />
        )}
      </MapContainer>
      <Dialog
        open={selectedHazard !== null}
        onClose={() => setSelectedHazard(null)}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { maxHeight: '85dvh', mx: 2, borderRadius: 2 } }}
      >
        <DialogTitle
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}
        >
          <Typography variant="subtitle1" fontWeight="bold">
            {selectedHazard && t(HAZARD_TYPE_KEYS[selectedHazard.type])}
          </Typography>
          <IconButton size="small" onClick={() => setSelectedHazard(null)} edge="end" aria-label={t('map.close')}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ overflowY: 'auto', pt: 0 }}>
          {selectedHazard?.address && (
            <Typography variant="body2">{selectedHazard.address}</Typography>
          )}
          {selectedHazard?.purpose && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {selectedHazard.purpose}
            </Typography>
          )}
          {(selectedHazard?.startDate || selectedHazard?.endDate) && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {selectedHazard.startDate ?? '?'} – {selectedHazard.endDate ?? '?'}
            </Typography>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
