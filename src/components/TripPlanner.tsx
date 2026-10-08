import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpDown, Loader2, LocateFixed } from 'lucide-react'
import { COORD_PATTERN, type AddressOption } from '../utils/address'
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
      <div className="relative rounded-xl bg-sunken">
        {/* Route line joining the two marks */}
        <span aria-hidden className="absolute top-[26px] bottom-[26px] left-[21px] w-0.5 rounded-full bg-line" />

        <FieldButton
          onClick={() => onEdit('origin')}
          fieldLabel={t('search.origin')}
          value={fromLabel}
          placeholder={t('search.origin')}
          icon={
            locationLoading && !from ? (
              <Loader2 className="size-4 animate-spin text-ink-muted" />
            ) : from?.group === 'Location' ? (
              <LocateFixed className="size-[18px] text-baltic" />
            ) : (
              <span className="size-3.5 rounded-full border-[3px] border-ink bg-sunken" />
            )
          }
        />
        <span aria-hidden className="ml-11 mr-14 block h-px bg-line" />
        <FieldButton
          onClick={() => onEdit('destination')}
          fieldLabel={t('search.destination')}
          value={toLabel}
          placeholder={t('search.whereTo')}
          icon={<span className="size-3.5 rounded-full bg-ink ring-[3px] ring-sunken" />}
        />

        <button
          type="button"
          onClick={onSwap}
          disabled={!from && !to}
          aria-label={t('trip.swap')}
          className="absolute top-1/2 right-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted outline-none hover:bg-surface hover:text-ink focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40"
        >
          <ArrowUpDown className="size-[18px]" />
        </button>
      </div>
      {locationDenied && !from && <p className="px-1 text-xs text-ink-muted">{t('location.denied')}</p>}
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
      className="relative flex h-[52px] w-full items-center gap-3 rounded-xl pr-14 pl-3.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className={cn('truncate text-base', value ? 'text-ink' : 'text-ink-muted')}>{value ?? placeholder}</span>
    </button>
  )
}
