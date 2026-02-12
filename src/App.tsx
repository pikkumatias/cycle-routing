import { FormEvent, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import './App.css'

type LatLonPair = {
  lat: number
  lon: number
}

type RouteFormState = {
  from: string
  to: string
}

type ApiState = {
  loading: boolean
  error: string | null
  response: unknown | null
}

const DIGITRANSIT_ENDPOINT =
  'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1'

function parseLatLon(input: string): LatLonPair {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('Value is required')
  }

  const parts = trimmed.includes(',')
    ? trimmed.split(',')
    : trimmed.split(/\s+/)

  if (parts.length !== 2) {
    throw new Error(
      'Use "lat,lon" or "lat lon", e.g. 60.192059,24.945831',
    )
  }

  const lat = Number(parts[0])
  const lon = Number(parts[1])

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    throw new Error('Latitude and longitude must be numbers')
  }

  return { lat, lon }
}

async function fetchBicycleRoute(
  from: LatLonPair,
  to: LatLonPair,
): Promise<unknown> {
  const apiKey = import.meta.env.VITE_DIGITRANSIT_API_KEY

  if (!apiKey) {
    throw new Error(
      'VITE_DIGITRANSIT_API_KEY is not set. Add it to your .env.local file.',
    )
  }

  const query = `
    query PlanBicycleRoute(
      $fromLat: Float!
      $fromLon: Float!
      $toLat: Float!
      $toLon: Float!
    ) {
      plan(
        from: { lat: $fromLat, lon: $fromLon }
        to: { lat: $toLat, lon: $toLon }
        numItineraries: 1
        transportModes: [{ mode: BICYCLE }]
      ) {
        itineraries {
          duration
          walkDistance
          legs {
            mode
            startTime
            endTime
            distance
            from { name }
            to { name }
            route {
              shortName
              longName
            }
          }
        }
      }
    }
  `

  const body = JSON.stringify({
    query,
    variables: {
      fromLat: from.lat,
      fromLon: from.lon,
      toLat: to.lat,
      toLon: to.lon,
    },
  })

  const res = await fetch(DIGITRANSIT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'digitransit-subscription-key': apiKey,
    },
    body,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `Routing API error: ${res.status} ${res.statusText}\n${text}`,
    )
  }

  const data = await res.json()

  return data
}

function App() {
  const [form, setForm] = useState<RouteFormState>({
    from: '',
    to: '',
  })
  const [apiState, setApiState] = useState<ApiState>({
    loading: false,
    error: null,
    response: null,
  })

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()

    try {
      const from = parseLatLon(form.from)
      const to = parseLatLon(form.to)

      setApiState({ loading: true, error: null, response: null })

      const data = await fetchBicycleRoute(from, to)

      setApiState({ loading: false, error: null, response: data })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error'
      setApiState({ loading: false, error: message, response: null })
    }
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Paper elevation={3} sx={{ p: 4 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="h4" gutterBottom>
              Cycle Routing (HSL / Digitransit)
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Enter start and destination coordinates to request a{' '}
              <strong>bicycle</strong> route from the Digitransit
              Routing API (HSL router) and see the raw GraphQL
              response.
            </Typography>
          </Box>

          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                label='From (lat,lon), e.g. "60.192059,24.945831"'
                value={form.from}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, from: e.target.value }))
                }
                fullWidth
                required
              />
              <TextField
                label='To (lat,lon), e.g. "60.169857,24.938379"'
                value={form.to}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, to: e.target.value }))
                }
                fullWidth
                required
              />
              <Box>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={apiState.loading}
                >
                  {apiState.loading ? 'Requesting route…' : 'Get route'}
                </Button>
              </Box>
            </Stack>
          </Box>

          {apiState.error && (
            <Alert severity="error">{apiState.error}</Alert>
          )}

          {apiState.response && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Raw API response
              </Typography>
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  maxHeight: 400,
                  overflow: 'auto',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  whiteSpace: 'pre',
                }}
              >
                {JSON.stringify(apiState.response, null, 2)}
              </Paper>
            </Box>
          )}
        </Stack>
      </Paper>
    </Container>
  )
}

export default App
