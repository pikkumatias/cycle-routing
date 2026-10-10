import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Command as CommandPrimitive } from 'cmdk'
import { ArrowLeft, Clock, Crosshair, Loader2, LocateFixed, MapPin, X } from 'lucide-react'
import { fetchGeocodingAutocomplete } from '../api/digitransit'
import { appLanguage } from '../i18n'
import type { RecentSearch } from '../utils/recentSearches'
import { COORD_PATTERN, coordinateOption, type AddressOption } from '../utils/address'
import type { TripField } from './TripPlanner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type SearchPanelProps = {
  open: boolean
  onClose: () => void
  onSelect: (option: AddressOption) => void
  field: TripField
  initialInputValue: string
  recentSearches: RecentSearch[]
  locationCoords?: { lat: number; lon: number } | null
  locationLoading?: boolean
  locationDenied?: boolean
  onRequestLocation?: () => void
}

const DEBOUNCE_MS = 300

/**
 * Full-screen place search (a side panel on wide screens). Suggestions come
 * from the geocoder as you type; recent places and, for the start, your
 * location are always one tap away.
 */
export function SearchPanel({
  open,
  onClose,
  onSelect,
  field,
  initialInputValue,
  recentSearches,
  locationCoords,
  locationLoading,
  locationDenied,
  onRequestLocation,
}: SearchPanelProps) {
  const { t, i18n } = useTranslation()
  const [inputValue, setInputValue] = useState('')
  const [suggestions, setSuggestions] = useState<AddressOption[]>([])
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset when opened
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInputValue(initialInputValue)
    setSuggestions([])
    setLoading(false)
  }, [open, initialInputValue])

  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const handleInputChange = (value: string) => {
    setInputValue(value)
    abortRef.current?.abort()
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!value.trim() || COORD_PATTERN.test(value.trim())) {
      setSuggestions([])
      setLoading(false)
      return
    }

    setLoading(true)
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const results = await fetchGeocodingAutocomplete(value, controller.signal, appLanguage(i18n.language))
        if (!controller.signal.aborted) {
          setSuggestions(results.map((r) => ({ ...r, group: 'Suggestions' as const })))
          setLoading(false)
        }
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([])
          setLoading(false)
        }
      }
    }, DEBOUNCE_MS)
  }

  const query = inputValue.trim().toLowerCase()
  const recents: AddressOption[] = recentSearches
    .filter((r) => !query || r.label.toLowerCase().includes(query))
    .map((r) => ({ ...r, group: 'Recent' as const }))
  const coords = coordinateOption(inputValue)
  const showLocation = field === 'origin' && !locationDenied

  const selectLocation = () => {
    if (locationCoords) onSelect({ label: '', ...locationCoords, group: 'Location' })
    else onRequestLocation?.()
  }

  const nothingFound = query && !loading && !coords && suggestions.length === 0 && recents.length === 0

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 max-md:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            inputRef.current?.focus()
            inputRef.current?.select()
          }}
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-background outline-none',
            'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-6',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'md:inset-auto md:top-4 md:bottom-4 md:left-4 md:w-[400px] md:rounded-xl md:border md:pt-0 md:pb-0 md:shadow-lg',
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {field === 'origin' ? t('search.origin') : t('search.destination')}
          </DialogPrimitive.Title>
          <CommandPrimitive shouldFilter={false} loop className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-1 px-2 pt-2 pb-3">
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label={t('search.back')} className="size-10 shrink-0">
                  <ArrowLeft className="size-5" />
                </Button>
              </DialogPrimitive.Close>
              <div className="relative flex h-11 flex-1 items-center rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
                <span aria-hidden className="pl-3 text-muted-foreground">
                  {field === 'origin' ? (
                    <span className="block size-3 rounded-full border-2 border-current" />
                  ) : (
                    <span className="block size-3 rounded-full bg-current" />
                  )}
                </span>
                <CommandPrimitive.Input
                  ref={inputRef}
                  value={inputValue}
                  onValueChange={handleInputChange}
                  placeholder={field === 'origin' ? t('search.origin') : t('search.whereTo')}
                  aria-label={field === 'origin' ? t('search.origin') : t('search.destination')}
                  enterKeyHint="search"
                  autoComplete="off"
                  className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-base outline-none placeholder:text-muted-foreground"
                />
                {loading ? (
                  <Loader2 className="mr-3 size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  inputValue && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        handleInputChange('')
                        inputRef.current?.focus()
                      }}
                      aria-label={t('search.clear')}
                      className="mr-0.5 size-9 shrink-0 text-muted-foreground"
                    >
                      <X />
                    </Button>
                  )
                )}
              </div>
            </div>

            <CommandPrimitive.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t p-1 pb-6">
              {showLocation && (
                <ResultItem
                  value="__location"
                  onSelect={selectLocation}
                  disabled={locationLoading}
                  icon={
                    locationLoading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <LocateFixed className="size-4" />
                    )
                  }
                  primary={
                    locationLoading
                      ? t('location.locating')
                      : locationCoords
                        ? t('location.currentLocation')
                        : t('location.useCurrentLocation')
                  }
                />
              )}

              {coords && (
                <ResultItem
                  value="__coords"
                  onSelect={() => onSelect(coords)}
                  icon={<Crosshair className="size-4" />}
                  primary={t('search.useCoordinates', { coords: coords.label })}
                />
              )}

              {suggestions.length > 0 && (
                <CommandPrimitive.Group heading={t('search.results')} className={GROUP_CLASS}>
                  {suggestions.map((s, i) => (
                    <ResultItem
                      key={`s-${i}-${s.lat}-${s.lon}`}
                      value={`s-${i}-${s.label}`}
                      onSelect={() => onSelect(s)}
                      icon={<MapPin className="size-4" />}
                      {...splitLabel(s.label)}
                    />
                  ))}
                </CommandPrimitive.Group>
              )}

              {recents.length > 0 && (
                <CommandPrimitive.Group heading={t('search.recent')} className={GROUP_CLASS}>
                  {recents.map((r, i) => (
                    <ResultItem
                      key={`r-${i}-${r.label}`}
                      value={`r-${i}-${r.label}`}
                      onSelect={() => onSelect(r)}
                      icon={<Clock className="size-4" />}
                      {...splitLabel(r.label)}
                    />
                  ))}
                </CommandPrimitive.Group>
              )}

              {nothingFound && <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('search.noResults')}</p>}
            </CommandPrimitive.List>
          </CommandPrimitive>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

const GROUP_CLASS =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground'

/** "Mannerheimintie 1, Helsinki" → name on top, area underneath. */
function splitLabel(label: string): { primary: string; secondary?: string } {
  const [primary, ...rest] = label.split(',')
  const secondary = rest.join(',').trim()
  return { primary, secondary: secondary || undefined }
}

type ResultItemProps = {
  value: string
  onSelect: () => void
  icon: ReactNode
  primary: string
  secondary?: string
  disabled?: boolean
}

function ResultItem({ value, onSelect, icon, primary, secondary, disabled }: ResultItemProps) {
  return (
    <CommandPrimitive.Item
      value={value}
      onSelect={onSelect}
      disabled={disabled}
      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-sm px-3 py-2 outline-none select-none data-[disabled=true]:cursor-default data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm">{primary}</span>
        {secondary && <span className="truncate text-sm text-muted-foreground">{secondary}</span>}
      </span>
    </CommandPrimitive.Item>
  )
}
