import {
  Card,
  CardContent,
  Chip,
  Typography,
} from '@mui/material'
import StarIcon from '@mui/icons-material/Star'
import type { RoutePresetKey } from '../api/digitransit'

export type ScoredRoute = {
  response: unknown
  durationSec: number
  distanceKm: number
  scenicScore: number
}

type RouteCardsProps = {
  routes: Record<RoutePresetKey, ScoredRoute>
  selectedRoute: RoutePresetKey
  onSelect: (key: RoutePresetKey) => void
}

const ROUTE_LABELS: Record<RoutePresetKey, string> = {
  fastest: 'Fastest',
  scenic: 'Scenic',
  balanced: 'Balanced',
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  return `${mins} min`
}

export function RouteCards({ routes, selectedRoute, onSelect }: RouteCardsProps) {
  const maxScenic = Math.max(...Object.values(routes).map((r) => r.scenicScore))

  return (
    <div className="route-chips-scroll">
      {(Object.entries(routes) as [RoutePresetKey, ScoredRoute][]).map(
        ([key, route]) => {
          const isSelected = key === selectedRoute
          const isMostScenic = route.scenicScore === maxScenic && maxScenic > 0

          return (
            <Card
              key={key}
              sx={{
                minWidth: 140,
                flex: '0 0 auto',
                border: isSelected ? '2px solid' : '1px solid',
                borderColor: isSelected ? 'primary.main' : 'grey.300',
                bgcolor: isSelected ? 'primary.main' : 'background.paper',
                color: isSelected ? 'white' : 'text.primary',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onClick={() => onSelect(key)}
            >
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="body2" fontWeight={700} noWrap sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {ROUTE_LABELS[key]}
                  {isMostScenic && (
                    <StarIcon sx={{ fontSize: 16, color: isSelected ? 'white' : '#FFB300' }} />
                  )}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ opacity: 0.8, display: 'block' }}
                >
                  {formatDuration(route.durationSec)} &middot;{' '}
                  {route.distanceKm.toFixed(1)} km
                </Typography>
                {route.scenicScore > 0 && (
                  <Chip
                    label={`${route.scenicScore} parks`}
                    size="small"
                    sx={{
                      mt: 0.5,
                      height: 20,
                      fontSize: '0.7rem',
                      bgcolor: isSelected
                        ? 'rgba(255,255,255,0.2)'
                        : 'rgba(76,175,80,0.1)',
                      color: isSelected ? 'white' : 'success.main',
                    }}
                  />
                )}
              </CardContent>
            </Card>
          )
        },
      )}
    </div>
  )
}
