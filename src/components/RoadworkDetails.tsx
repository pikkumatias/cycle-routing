import { useTranslation } from 'react-i18next'
import { Popup } from 'react-map-gl/maplibre'
import { Construction } from 'lucide-react'
import { hazardToLatLng, type Hazard } from '../services/hazards'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type RoadworkDetailsProps = {
  hazard: Hazard | null
  /** Wide layout shows a map popup; narrow shows a bottom sheet. */
  wide: boolean
  onClose: () => void
}

function formatDate(value: string | null, locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

function Details({ hazard }: { hazard: Hazard }) {
  const { t, i18n } = useTranslation()
  const start = formatDate(hazard.startDate, i18n.language)
  const end = formatDate(hazard.endDate, i18n.language)
  return (
    <div className="flex flex-col gap-1 text-sm">
      {hazard.address && <p>{hazard.address}</p>}
      {hazard.purpose && <p className="text-muted-foreground">{hazard.purpose}</p>}
      {(start || end) && (
        <p className="tabular text-muted-foreground">{t('roadworks.dates', { start: start ?? '…', end: end ?? '…' })}</p>
      )}
    </div>
  )
}

/** What a roadwork is and how long it lasts, for the marker that was tapped. */
export function RoadworkDetails({ hazard, wide, onClose }: RoadworkDetailsProps) {
  const { t } = useTranslation()
  const at = hazard ? hazardToLatLng(hazard) : null

  if (wide) {
    if (!hazard || !at) return null
    return (
      <Popup longitude={at[1]} latitude={at[0]} anchor="bottom" offset={12} closeButton={false} onClose={onClose} maxWidth="320px">
        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Construction className="size-4 text-works" />
            {t(`hazardTypes.${hazard.type}`)}
          </p>
          <Details hazard={hazard} />
        </div>
      </Popup>
    )
  }

  return (
    <Sheet open={hazard !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="gap-3 rounded-t-xl px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        {hazard && (
          <>
            <SheetHeader className="p-0">
              <SheetTitle className="flex items-center gap-2">
                <Construction className="size-5 text-works" />
                {t(`hazardTypes.${hazard.type}`)}
              </SheetTitle>
              <SheetDescription className="sr-only">{hazard.address ?? ''}</SheetDescription>
            </SheetHeader>
            <Details hazard={hazard} />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
