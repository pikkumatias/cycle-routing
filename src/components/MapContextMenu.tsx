import { useState, useRef } from 'react'
import { Popup, useMap, useMapEvents } from 'react-leaflet'
import type L from 'leaflet'
import {
  Box,
  ButtonBase,
  CircularProgress,
  Divider,
  Typography,
} from '@mui/material'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import { fetchReverseGeocode } from '../api/digitransit'
import type { AddressOption } from './SearchDrawer'

type MenuState =
  | { status: 'closed' }
  | { status: 'loading'; latlng: L.LatLng }
  | { status: 'ready'; latlng: L.LatLng; label: string; lat: number; lon: number }
  | { status: 'error'; latlng: L.LatLng }

type Props = {
  onSetOrigin: (option: AddressOption) => void
  onSetDestination: (option: AddressOption) => void
}

export function MapContextMenu({ onSetOrigin, onSetDestination }: Props) {
  const map = useMap()
  const [menuState, setMenuState] = useState<MenuState>({ status: 'closed' })
  const abortRef = useRef<AbortController | null>(null)

  useMapEvents({
    contextmenu(e) {
      e.originalEvent.preventDefault()

      // Cancel any in-flight geocode
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const { lat, lng } = e.latlng
      setMenuState({ status: 'loading', latlng: e.latlng })
      map.panBy([0, -120], { animate: true })

      fetchReverseGeocode(lat, lng, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return
          if (result) {
            setMenuState({
              status: 'ready',
              latlng: e.latlng,
              label: result.label,
              lat: result.lat,
              lon: result.lon,
            })
          } else {
            setMenuState({ status: 'error', latlng: e.latlng })
          }
        })
        .catch((err) => {
          if (controller.signal.aborted) return
          console.warn('[MapContextMenu] reverse geocode failed:', err)
          setMenuState({ status: 'error', latlng: e.latlng })
        })
    },
  })

  if (menuState.status === 'closed') return null

  const buildOption = (): AddressOption => {
    if (menuState.status === 'ready') {
      return { label: menuState.label, lat: menuState.lat, lon: menuState.lon, group: 'Map' }
    }
    const { lat, lng } = menuState.latlng
    return {
      label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      lat,
      lon: lng,
      group: 'Map',
    }
  }

  const handleSelectOrigin = () => {
    onSetOrigin(buildOption())
    map.closePopup()
  }

  const handleSelectDestination = () => {
    onSetDestination(buildOption())
    map.closePopup()
  }

  const isLoading = menuState.status === 'loading'
  const label =
    menuState.status === 'ready'
      ? menuState.label
      : menuState.status === 'error'
        ? `${menuState.latlng.lat.toFixed(5)}, ${menuState.latlng.lng.toFixed(5)}`
        : ''

  return (
    <Popup
      position={menuState.latlng}
      closeButton={false}
      className="context-menu-popup"
      eventHandlers={{
        remove: () => setMenuState({ status: 'closed' }),
      }}
    >
      <Box sx={{ minWidth: 230, bgcolor: 'background.paper', overflow: 'hidden' }}>
        {/* Address row */}
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <LocationOnIcon sx={{ color: 'primary.main', fontSize: 20, flexShrink: 0 }} />
          {isLoading ? (
            <CircularProgress size={16} />
          ) : (
            <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.3 }}>
              {label}
            </Typography>
          )}
        </Box>
        <Divider />
        {/* Buttons row */}
        <Box sx={{ display: 'flex' }}>
          <ButtonBase
            sx={{
              flex: 1,
              py: 1.25,
              color: 'success.main',
              fontWeight: 700,
              fontSize: '0.875rem',
              fontFamily: 'inherit',
            }}
            onClick={handleSelectOrigin}
            disabled={isLoading}
          >
            Origin
          </ButtonBase>
          <Divider orientation="vertical" flexItem />
          <ButtonBase
            sx={{
              flex: 1,
              py: 1.25,
              color: 'error.main',
              fontWeight: 700,
              fontSize: '0.875rem',
              fontFamily: 'inherit',
            }}
            onClick={handleSelectDestination}
            disabled={isLoading}
          >
            Destination
          </ButtonBase>
        </Box>
      </Box>
    </Popup>
  )
}
