import {
  Card,
  CardContent,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material'
import StarIcon from '@mui/icons-material/Star'
import type { RouteCategory } from '../api/digitransit'

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
  routes: Record<RouteCategory, ScoredRoute>
  selectedRoute: RouteCategory
  onSelect: (key: RouteCategory) => void
  hazardCount?: number
  hazardsLoading?: boolean
}

const ROUTE_LABELS: Record<RouteCategory, string> = {
  fastest: 'Fastest',
  scenic: 'Scenic',
  calm: 'Calm',
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  return `${mins} min`
}

export function RouteCardsSkeleton() {
  return (
    <div className="route-chips-scroll">
      {[0, 1, 2].map((i) => (
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

export function RouteCards({ routes, selectedRoute, onSelect, hazardCount, hazardsLoading }: RouteCardsProps) {
  const maxCalm = Math.max(...Object.values(routes).map((r) => r.calmScore))

  return (
    <div className="route-chips-scroll">
      {(Object.entries(routes) as [RouteCategory, ScoredRoute][]).map(
        ([key, route]) => {
          const isSelected = key === selectedRoute
          const isCalmest = route.calmScore === maxCalm && maxCalm > 0

          return (
            <Card
              key={key}
              sx={{
                width: '100%',
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
                <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
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
                  {isSelected && hazardsLoading && (
                    <Chip
                      label="Checking hazards…"
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.7rem',
                        opacity: 0.6,
                        bgcolor: 'rgba(255,255,255,0.15)',
                        color: 'white',
                      }}
                    />
                  )}
                  {isSelected && !hazardsLoading && (hazardCount ?? 0) > 0 && (
                    <Chip
                      label={`⚠️ ${hazardCount} hazard${hazardCount !== 1 ? 's' : ''}`}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: '0.7rem',
                        bgcolor: 'rgba(255,140,0,0.3)',
                        color: 'white',
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
