import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { Popup, useMap, type MapLayerMouseEvent } from 'react-map-gl/maplibre'
import { Loader2 } from 'lucide-react'
import { fetchReverseGeocode } from '../api/digitransit'
import { appLanguage } from '../i18n'
import { useLongPress } from '../hooks/useLongPress'
import { formatCoords, type AddressOption } from '../utils/address'
import { cn } from '@/lib/utils'

type MenuState =
  | { status: 'closed' }
  | { status: 'loading'; lat: number; lon: number }
  | { status: 'ready'; lat: number; lon: number; label: string }

type MapContextMenuProps = {
  onSetOrigin: (option: AddressOption) => void
  onSetDestination: (option: AddressOption) => void
  /** Register the desktop right-click handler on the parent map. */
  bindContextMenu: (handler: (e: MapLayerMouseEvent) => void) => void
}

/** Ignore a second trigger this soon after the first (Android fires both long-press and contextmenu). */
const DUPLICATE_MS = 800
/** How long a pick waits for the address before using coordinates. */
const LOOKUP_WAIT_MS = 2500

/**
 * Long-press (touch) or right-click (mouse) on the map: look up the address
 * and offer to use the point as the start or the destination.
 */
export function MapContextMenu({ onSetOrigin, onSetDestination, bindContextMenu }: MapContextMenuProps) {
  const { t, i18n } = useTranslation()
  const { current: map } = useMap()
  const [menu, setMenu] = useState<MenuState>({ status: 'closed' })
  const abortRef = useRef<AbortController | null>(null)
  const lookupRef = useRef<Promise<string> | null>(null)
  const openedAt = useRef(0)

  const open = useCallback(
    (lat: number, lon: number) => {
      const now = Date.now()
      if (now - openedAt.current < DUPLICATE_MS) return
      openedAt.current = now

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setMenu({ status: 'loading', lat, lon })

      const lookup = fetchReverseGeocode(lat, lon, controller.signal, appLanguage(i18n.language))
        .then((result) => result?.label || formatCoords(lat, lon))
        .catch((err) => {
          if (!controller.signal.aborted) console.warn('[MapContextMenu] reverse geocode failed:', err)
          return formatCoords(lat, lon)
        })
      lookupRef.current = lookup
      void lookup.then((label) => {
        if (!controller.signal.aborted) setMenu((m) => (m.status === 'closed' ? m : { status: 'ready', lat, lon, label }))
      })
    },
    [i18n.language],
  )

  useEffect(() => {
    bindContextMenu((e) => {
      e.preventDefault()
      open(e.lngLat.lat, e.lngLat.lng)
    })
  }, [bindContextMenu, open])

  useEffect(() => () => abortRef.current?.abort(), [])

  // Close on a map tap, but not the one produced by lifting the finger that
  // opened the menu (MapLibre turns the end of a long press into a click).
  useEffect(() => {
    if (!map || menu.status === 'closed') return
    const onClick = () => {
      if (Date.now() - openedAt.current < DUPLICATE_MS) return
      abortRef.current?.abort()
      setMenu({ status: 'closed' })
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [map, menu.status])

  useLongPress(map?.getContainer() ?? null, ({ x, y }) => {
    if (!map) return
    const rect = map.getContainer().getBoundingClientRect()
    const at = map.unproject([x - rect.left, y - rect.top])
    open(at.lat, at.lng)
  })

  if (menu.status === 'closed') return null

  const close = () => {
    abortRef.current?.abort()
    setMenu({ status: 'closed' })
  }

  // Picking doesn't wait for the address: the menu closes at once and the
  // field fills when the lookup lands, or with coordinates if it is slow.
  // Coordinates stay those of the press, not the geocoder's address point.
  const pick = (set: (option: AddressOption) => void) => {
    const { lat, lon } = menu
    const lookup = lookupRef.current ?? Promise.resolve(formatCoords(lat, lon))
    setMenu({ status: 'closed' })
    const fallback = new Promise<string>((resolve) => setTimeout(() => resolve(formatCoords(lat, lon)), LOOKUP_WAIT_MS))
    void Promise.race([lookup, fallback]).then((label) => set({ label, lat, lon, group: 'Map' }))
  }

  return (
    <Popup
      longitude={menu.lon}
      latitude={menu.lat}
      offset={12}
      closeButton={false}
      closeOnClick={false}
      onClose={close}
      maxWidth="300px"
    >
      <div className="flex w-[260px] flex-col">
        <div className="flex min-h-12 items-center px-4 py-3 text-sm font-medium">
          {menu.status === 'loading' ? <Loader2 className="size-4 animate-spin text-ink-muted" /> : menu.label}
        </div>
        <div className="flex flex-col border-t border-line">
          <MenuButton onClick={() => pick(onSetOrigin)}>
            <span aria-hidden className="size-3 shrink-0 rounded-full border-[3px] border-ink" />
            {t('map.setStart')}
          </MenuButton>
          <MenuButton onClick={() => pick(onSetDestination)} className="border-t border-line">
            <span aria-hidden className="size-3 shrink-0 rounded-full bg-ink" />
            {t('map.setDestination')}
          </MenuButton>
        </div>
      </div>
    </Popup>
  )
}

function MenuButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'flex min-h-12 items-center gap-3 px-4 text-left text-sm font-medium outline-none hover:bg-sunken focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
