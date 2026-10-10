import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpDown, Loader2, LocateFixed } from 'lucide-react'
import { COORD_PATTERN, type AddressOption } from '../utils/address'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type TripField = 'origin' | 'destination'

type TripPlannerProps = {
  from: AddressOption | null
  to: AddressOption | null
  onEdit: (field: TripField) => void
  onSwap: () => void
  locationLoading?: boolean
  locationDenied?: boolean
}

/**
 * Start and destination as two stacked tap targets joined by a route line,
 * the same marks the map uses for the pins: a ring for the start, a dot for
 * the destination.
 */
export function TripPlanner({ from, to, onEdit, onSwap, locationLoading, locationDenied }: TripPlannerProps) {
  const { t } = useTranslation()
  // The place name is enough here; the full address was picked in search
  const label = (o: AddressOption | null) =>
    o ? (o.group === 'Location' ? t('location.currentLocation') : placeName(o)) : null

  const fromLabel = label(from)
  const toLabel = label(to)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative rounded-md border border-input bg-background shadow-xs dark:bg-input/30">
        {/* Route line joining the two marks */}
        <span aria-hidden className="absolute top-6 bottom-6 left-[19px] w-px bg-border" />

        <FieldButton
          onClick={() => onEdit('origin')}
          fieldLabel={t('search.origin')}
          value={fromLabel}
          placeholder={t('search.origin')}
          icon={
            locationLoading && !from ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : from?.group === 'Location' ? (
              <LocateFixed className="size-4" />
            ) : (
              <span className="size-3 rounded-full border-2 border-foreground bg-background" />
            )
          }
        />
        <span aria-hidden className="mr-12 ml-10 block h-px bg-border" />
        <FieldButton
          onClick={() => onEdit('destination')}
          fieldLabel={t('search.destination')}
          value={toLabel}
          placeholder={t('search.whereTo')}
          icon={<span className="size-3 rounded-full bg-foreground" />}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onSwap}
          disabled={!from && !to}
          aria-label={t('trip.swap')}
          className="absolute top-1/2 right-1.5 size-10 -translate-y-1/2 text-muted-foreground"
        >
          <ArrowUpDown />
        </Button>
      </div>
      {locationDenied && !from && <p className="px-1 text-sm text-muted-foreground">{t('location.denied')}</p>}
    </div>
  )
}

function placeName(o: AddressOption): string {
  if (COORD_PATTERN.test(o.label)) return o.label
  return o.label.split(',')[0].trim() || o.label
}

type FieldButtonProps = {
  onClick: () => void
  fieldLabel: string
  value: string | null
  placeholder: string
  icon: ReactNode
}

function FieldButton({ onClick, fieldLabel, value, placeholder, icon }: FieldButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={value ? `${fieldLabel}: ${value}` : fieldLabel}
      className="relative flex h-12 w-full items-center gap-3 rounded-md pr-12 pl-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className={cn('truncate text-base', !value && 'text-muted-foreground')}>{value ?? placeholder}</span>
    </button>
  )
}
