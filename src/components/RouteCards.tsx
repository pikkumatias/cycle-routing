import {
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
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
  fastest: 'Fastest Route',
  scenic: 'Most Scenic',
  balanced: 'Balanced',
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  return `${mins} min`
}

export function RouteCards({ routes, selectedRoute, onSelect }: RouteCardsProps) {
  const maxScenic = Math.max(...Object.values(routes).map((r) => r.scenicScore))

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      {(Object.entries(routes) as [RoutePresetKey, ScoredRoute][]).map(
        ([key, route]) => {
          const isSelected = key === selectedRoute
          const isMostScenic = route.scenicScore === maxScenic && maxScenic > 0

          return (
            <Card
              key={key}
              variant={isSelected ? 'elevation' : 'outlined'}
              elevation={isSelected ? 6 : 0}
              sx={{
                flex: 1,
                border: isSelected ? '2px solid' : undefined,
                borderColor: isSelected ? 'primary.main' : undefined,
              }}
            >
              <CardActionArea onClick={() => onSelect(key)}>
                <CardContent>
                  <Typography variant="subtitle1" fontWeight="bold">
                    {ROUTE_LABELS[key]} {isMostScenic && '\u2B50'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatDuration(route.durationSec)},{' '}
                    {route.distanceKm.toFixed(1)} km
                  </Typography>
                  {route.scenicScore > 0 && (
                    <Chip
                      label={`passes ${route.scenicScore} parks`}
                      size="small"
                      color="success"
                      variant="outlined"
                      sx={{ mt: 1 }}
                    />
                  )}
                </CardContent>
              </CardActionArea>
            </Card>
          )
        },
      )}
    </Stack>
  )
}
