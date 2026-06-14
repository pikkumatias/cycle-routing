import { useState, useRef, useEffect } from 'react'
import {
  Drawer,
  Box,
  TextField,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Typography,
  InputAdornment,
  CircularProgress,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ClearIcon from '@mui/icons-material/Clear'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useTranslation } from 'react-i18next'
import { fetchGeocodingAutocomplete } from '../api/digitransit'
import type { RecentSearch } from '../utils/recentSearches'

export type AddressOption = {
  label: string
  lat: number
  lon: number
  group: 'Recent' | 'Suggestions' | 'Map'
}

type SearchDrawerProps = {
  open: boolean
  onClose: () => void
  onSelect: (option: AddressOption) => void
  fieldType: 'origin' | 'destination'
  initialInputValue: string
  recentSearches: RecentSearch[]
  locationCoords?: { lat: number; lon: number } | null
  locationLoading?: boolean
  locationDenied?: boolean
  onRequestLocation?: () => void
}

const DEBOUNCE_MS = 300
const COORD_PATTERN = /^-?\d+\.?\d*[,\s]+-?\d+\.?\d*$/

export function SearchDrawer({
  open,
  onClose,
  onSelect,
  fieldType,
  initialInputValue,
  recentSearches,
  locationCoords,
  locationLoading,
  locationDenied,
  onRequestLocation,
}: SearchDrawerProps) {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState('')
  const [suggestions, setSuggestions] = useState<AddressOption[]>([])
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset state when drawer opens
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInputValue(initialInputValue)
      setSuggestions([])
      setLoading(false)
      // Focus after the slide animation completes
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [open, initialInputValue])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleInputChange = (newValue: string) => {
    setInputValue(newValue)

    abortRef.current?.abort()
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!newValue.trim() || COORD_PATTERN.test(newValue.trim())) {
      setSuggestions([])
      setLoading(false)
      return
    }

    setLoading(true)

    timerRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const results = await fetchGeocodingAutocomplete(
          newValue,
          controller.signal,
        )
        if (!controller.signal.aborted) {
          setSuggestions(
            results.map((r) => ({
              ...r,
              group: 'Suggestions' as const,
            })),
          )
          setLoading(false)
        }
      } catch {
        if (!abortRef.current?.signal.aborted) {
          setSuggestions([])
          setLoading(false)
        }
      }
    }, DEBOUNCE_MS)
  }

  const recentOptions: AddressOption[] = recentSearches
    .filter(
      (r) =>
        !inputValue.trim() ||
        r.label.toLowerCase().includes(inputValue.toLowerCase()),
    )
    .map((r) => ({ ...r, group: 'Recent' as const }))

  const items: AddressOption[] =
    suggestions.length > 0 ? [...suggestions, ...recentOptions] : recentOptions

  const label = fieldType === 'origin' ? t('search.origin') : t('search.destination')

  // Show location row when origin field and not denied
  const showLocationRow = fieldType === 'origin' && !locationDenied

  const handleLocationRowClick = () => {
    if (locationCoords) {
      onSelect({ label: t('location.currentLocation'), ...locationCoords, group: 'Recent' })
    } else {
      onRequestLocation?.()
    }
  }

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: '100vw',
            maxWidth: 600,
            height: '100dvh',
            bgcolor: 'background.paper',
          },
        },
      }}
    >
      {/* Top bar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1,
          px: 2,
          pt: 2,
          pb: 1.5,
        }}
      >
        <IconButton
          onClick={onClose}
          sx={{ color: 'primary.main', mt: 0.5 }}
          aria-label={t('search.back')}
        >
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}
          >
            {label}
          </Typography>
          <TextField
            inputRef={inputRef}
            placeholder={t('search.placeholder')}
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
            fullWidth
            size="small"
            slotProps={{
              input: {
                endAdornment: loading ? (
                  <InputAdornment position="end">
                    <CircularProgress size={20} />
                  </InputAdornment>
                ) : inputValue ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => handleInputChange('')}
                      aria-label={t('search.clear')}
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              },
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                bgcolor: '#F5F5F5',
                borderRadius: '12px',
                '& fieldset': { border: 'none' },
                '&.Mui-focused fieldset': {
                  border: '2px solid',
                  borderColor: 'primary.main',
                },
              },
            }}
          />
        </Box>
      </Box>

      <Divider />

      {/* Results list */}
      <List sx={{ flex: 1, overflowY: 'auto', py: 0 }}>
        {/* Current location row — always first when shown */}
        {showLocationRow && (
          <>
            <ListItemButton
              onClick={handleLocationRowClick}
              disabled={locationLoading}
              sx={{ px: 2, py: 1.5 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                {locationLoading ? (
                  <CircularProgress size={20} />
                ) : (
                  <MyLocationIcon sx={{ color: 'primary.main' }} />
                )}
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography variant="body1" noWrap>
                    {locationLoading
                      ? t('location.locating')
                      : locationCoords
                        ? t('location.currentLocation')
                        : t('location.useCurrentLocation')}
                  </Typography>
                }
              />
              {!locationLoading && <ChevronRightIcon sx={{ color: 'text.secondary', ml: 1 }} />}
            </ListItemButton>
            <Divider component="li" />
          </>
        )}

        {items.map((item, index) => (
          <Box key={`${item.label}-${item.lat}-${index}`}>
            <ListItemButton
              onClick={() => onSelect(item)}
              sx={{ px: 2, py: 1.5 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                {item.group === 'Recent' ? (
                  <AccessTimeIcon sx={{ color: 'text.secondary' }} />
                ) : (
                  <LocationOnIcon sx={{ color: 'primary.main' }} />
                )}
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography variant="body1" noWrap>
                    {item.label.split(',')[0]}
                  </Typography>
                }
                secondary={
                  item.label.includes(',') ? (
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {item.label.split(',').slice(1).join(',').trim()}
                    </Typography>
                  ) : undefined
                }
              />
              <ChevronRightIcon sx={{ color: 'text.secondary', ml: 1 }} />
            </ListItemButton>
            <Divider component="li" />
          </Box>
        ))}
        {items.length === 0 && inputValue.trim() && !loading && (
          <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {t('search.noResults')}
            </Typography>
          </Box>
        )}
      </List>
    </Drawer>
  )
}
