import { useMemo } from 'react'
import type { PlannedRoute } from '../api/routePlan'
import { fractionsAlongRoute } from '../map/routeProgress'
import { CALM_BAND_CLASS } from './calmBand'
import { cn } from '@/lib/utils'

type RouteRibbonProps = {
  route: PlannedRoute
  /** Duration of the slowest route shown; sets the full ribbon width. */
  maxDurationSec: number
  selected: boolean
}

/**
 * The ride as a bar: its length is the ride time relative to the slowest
 * option, its colour the route's calm band, and each pip a traffic-light stop
 * at its real position along the route.
 */
export function RouteRibbon({ route, maxDurationSec, selected }: RouteRibbonProps) {
  const fractions = useMemo(
    () => fractionsAlongRoute(route.legs, route.signalStops.map((s) => s.at)),
    [route],
  )
  const width = maxDurationSec > 0 ? Math.max(0.15, route.durationSec / maxDurationSec) : 1

  return (
    <span aria-hidden className="relative block h-3" data-testid="route-ribbon">
      <span
        className={cn(
          'absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full transition-[height] duration-200',
          CALM_BAND_CLASS[route.calmBand],
          selected && 'h-2',
        )}
        style={{ width: `${width * 100}%` }}
      >
        {fractions.map((f, i) => (
          <span
            key={i}
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal ring-2 ring-surface"
            style={{ left: `${f * 100}%` }}
          />
        ))}
      </span>
    </span>
  )
}
