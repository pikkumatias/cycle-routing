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
import {
  parseLatLon,
  requestBicycleRouteViaBackend,
} from './api/digitransit'

type RouteFormState = {
  from: string
  to: string
}

type ApiState = {
  loading: boolean
  error: string | null
  response: unknown | null
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

      const data = await requestBicycleRouteViaBackend(from, to)

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
