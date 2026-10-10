import { useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Construction, Loader2 } from 'lucide-react'
import type { PlannedRoute, RouteCard } from '../api/routePlan'
import { CALM_BAND_CLASS } from './calmBand'
import { RouteRibbon } from './RouteRibbon'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type RoadworksStatus = { enabled: boolean; loading: boolean; count: number }

type RouteOptionsProps = {
  cards: RouteCard[]
  routesById: Record<string, PlannedRoute>
  selectedId: string | null
  onSelect: (routeId: string) => void
  roadworks?: RoadworksStatus
}

const minutes = (sec: number) => Math.round(sec / 60)

/**
 * The route choices as a radio group: one row per card, the selected one
 * marked with the accent bar. Arrow keys move the selection.
 */
export function RouteOptions({ cards, routesById, selectedId, onSelect, roadworks }: RouteOptionsProps) {
  const { t } = useTranslation()
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([])
  const shown = cards.filter((c) => routesById[c.routeId])
  const maxDuration = Math.max(0, ...shown.map((c) => routesById[c.routeId].durationSec))

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!step || shown.length === 0) return
    e.preventDefault()
    const current = Math.max(0, shown.findIndex((c) => c.routeId === selectedId))
    const next = (current + step + shown.length) % shown.length
    onSelect(shown[next].routeId)
    rowRefs.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-label={t('routes.options')} onKeyDown={onKeyDown} className="flex flex-col">
      {shown.map((card, i) => {
        const route = routesById[card.routeId]
        const selected = card.routeId === selectedId
        const extra = minutes(card.extraSec)
        return (
          <button
            key={card.routeId}
            ref={(el) => {
              rowRefs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (!selectedId && i === 0) ? 0 : -1}
            onClick={() => onSelect(card.routeId)}
            className={cn(
              'relative flex w-full flex-col gap-2 py-3.5 pr-1 pl-4 text-left outline-none',
              'border-t border-line first:border-t-0',
              'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:rounded-lg',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'absolute top-3.5 bottom-3.5 left-0 w-1 rounded-full transition-colors',
                selected ? 'bg-baltic' : 'bg-transparent',
              )}
            />
            <span className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 flex-col gap-1">
                <span className={cn('text-base leading-tight font-semibold', !selected && 'text-ink-muted')}>
                  {t(`routes.${card.primary}`)}
                </span>
                {card.badges.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {card.badges.map((b) => (
                      <span
                        key={b}
                        className="rounded-full bg-baltic-soft px-2 py-0.5 text-xs font-medium text-ink"
                      >
                        {t(`routes.badge_${b}`)}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="tabular text-xl font-semibold tracking-tight">
                  {t('routes.minutes', { count: minutes(route.durationSec) })}
                </span>
                <span className="flex gap-2 text-xs text-ink-muted">
                  <span>{t('routes.distance', { km: (route.distanceM / 1000).toFixed(1) })}</span>
                  {extra > 0 && <span>{t('routes.extraTime', { minutes: extra })}</span>}
                </span>
              </span>
            </span>

            <RouteRibbon route={route} maxDurationSec={maxDuration} selected={selected} />

            <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full bg-signal" />
                {t('routes.lights', { count: route.lights })}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn('h-1.5 w-3 rounded-full', CALM_BAND_CLASS[route.calmBand])} />
                {t(`routes.calmBand_${route.calmBand}`)}
                <span className="tabular" aria-label={t('routes.calmScore', { index: route.calmIndex })}>
                  {route.calmIndex}
                </span>
              </span>
            </span>

            {selected && roadworks?.enabled && (roadworks.loading || roadworks.count > 0) && (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink">
                {roadworks.loading ? (
                  <Loader2 className="size-3.5 animate-spin text-ink-muted" />
                ) : (
                  <Construction className="size-3.5 text-works" />
                )}
                {roadworks.loading ? t('roadworks.checking') : t('roadworks.count', { count: roadworks.count })}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function RouteOptionsSkeleton() {
  return (
    <div className="flex flex-col" data-testid="route-options-skeleton">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2.5 border-t border-line py-3.5 pl-4 first:border-t-0">
          <div className="flex justify-between">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-6 w-16" />
          </div>
          <Skeleton className="h-1.5 rounded-full" style={{ width: `${90 - i * 12}%` }} />
          <Skeleton className="h-3.5 w-40" />
        </div>
      ))}
    </div>
  )
}
