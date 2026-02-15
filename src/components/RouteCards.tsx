import {
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import StarIcon from '@mui/icons-material/Star'
import type { RoutePresetKey } from '../api/digitransit'

export type ScoredRoute = {
  response: unknown
  durationSec: number
  distanceKm: number
  scenicScore: number
  infraScore: number
  calmScore: number
  scenicPoiCount: number
  infraSegmentCount: number
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
  calm: 'Calm',
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  return `${mins} min`
}

export function RouteCards({ routes, selectedRoute, onSelect }: RouteCardsProps) {
  const maxCalm = Math.max(...Object.values(routes).map((r) => r.calmScore))

  return (
    <div className="route-chips-scroll">
      {(Object.entries(routes) as [RoutePresetKey, ScoredRoute][]).map(
        ([key, route]) => {
          const isSelected = key === selectedRoute
          const isCalmest = route.calmScore === maxCalm && maxCalm > 0

          return (
            <Card
              key={key}
              sx={{
                minWidth: 130,
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
                  {isCalmest && (
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
                <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                  {route.calmScore > 0 && (
                    <Chip
                      label={`Calm ${route.calmScore}`}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.7rem',
                        bgcolor: isSelected
                          ? 'rgba(255,255,255,0.2)'
                          : 'rgba(76,175,80,0.1)',
                        color: isSelected ? 'white' : 'success.main',
                      }}
                    />
                  )}
                  {route.infraSegmentCount > 0 && (
                    <Chip
                      label={`${route.infraSegmentCount} paths`}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.7rem',
                        bgcolor: isSelected
                          ? 'rgba(255,255,255,0.2)'
                          : 'rgba(25,118,210,0.08)',
                        color: isSelected ? 'white' : 'primary.main',
                      }}
                    />
                  )}
                </Stack>
              </CardContent>
            </Card>
          )
        },
      )}
    </div>
  )
}
