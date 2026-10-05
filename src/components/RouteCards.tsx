import {
  Card,
  CardContent,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { PlannedRoute, RouteCard } from '../api/routePlan'

type RouteCardsProps = {
  cards: RouteCard[]
  routesById: Record<string, PlannedRoute>
  selectedId: string | null
  onSelect: (id: string) => void
  hazardCount?: number
  hazardsLoading?: boolean
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  return `${mins} min`
}

export function RouteCardsSkeleton() {
  return (
    <div className="route-chips-scroll">
      {[0, 1].map((i) => (
        <Card key={i} sx={{ width: '100%', border: '1px solid', borderColor: 'grey.300' }}>
          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Skeleton animation="wave" variant="text" width={60} sx={{ fontSize: '0.875rem' }} />
            <Skeleton animation="wave" variant="text" width={100} sx={{ fontSize: '0.75rem' }} />
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
              <Skeleton animation="wave" variant="rounded" width={56} height={20} />
              <Skeleton animation="wave" variant="rounded" width={56} height={20} />
            </Stack>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function RouteCards({ cards, routesById, selectedId, onSelect, hazardCount, hazardsLoading }: RouteCardsProps) {
  const { t } = useTranslation()

  return (
    <div className="route-chips-scroll">
      {cards.map((card) => {
        const route = routesById[card.routeId]
        if (!route) return null
        const isSelected = card.routeId === selectedId
        const chipSx = (bg: string, color: string) => ({
          height: 20,
          fontSize: '0.7rem',
          bgcolor: isSelected ? 'rgba(255,255,255,0.2)' : bg,
          color: isSelected ? 'white' : color,
        })
        const extraMin = Math.round(card.extraSec / 60)

        return (
          <Card
            key={card.routeId}
            sx={{
              width: '100%',
              border: isSelected ? '2px solid' : '1px solid',
              borderColor: isSelected ? 'primary.main' : 'grey.300',
              bgcolor: isSelected ? 'primary.main' : 'background.paper',
              color: isSelected ? 'white' : 'text.primary',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onClick={() => onSelect(card.routeId)}
          >
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="body2" fontWeight={700} noWrap>
                {t(`routes.${card.primary}`)}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.8, display: 'block' }}>
                {formatDuration(route.durationSec)} &middot; {(route.distanceM / 1000).toFixed(1)} km
                {extraMin > 0 && <> &middot; {t('routes.extraTime', { minutes: extraMin })}</>}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                {card.badges.map((badge) => (
                  <Chip
                    key={badge}
                    label={t(`routes.badge_${badge}`)}
                    size="small"
                    sx={{ ...chipSx('rgba(25,118,210,0.08)', 'primary.main'), fontWeight: 600 }}
                  />
                ))}
                <Chip
                  label={t('routes.lights', { count: route.lights })}
                  size="small"
                  sx={chipSx('rgba(255,152,0,0.12)', 'warning.main')}
                />
                <Chip
                  label={t(`routes.calmBand_${route.calmBand}`, { index: route.calmIndex })}
                  size="small"
                  sx={chipSx('rgba(76,175,80,0.1)', 'success.main')}
                />
                {isSelected && hazardsLoading && (
                  <Chip
                    label={t('routes.checkingHazards')}
                    size="small"
                    sx={{ height: 20, fontSize: '0.7rem', opacity: 0.6, bgcolor: 'rgba(255,255,255,0.15)', color: 'white' }}
                  />
                )}
                {isSelected && !hazardsLoading && (hazardCount ?? 0) > 0 && (
                  <Chip
                    label={t('routes.hazard', { count: hazardCount ?? 0 })}
                    size="small"
                    sx={{ height: 20, fontSize: '0.7rem', bgcolor: 'rgba(255,140,0,0.3)', color: 'white' }}
                  />
                )}
              </Stack>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
