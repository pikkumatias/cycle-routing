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
import { fetchGeocodingAutocomplete } from '../api/digitransit'
import type { RecentSearch } from '../utils/recentSearches'

export type AddressOption = {
  label: string
  lat: number
  lon: number
  group: 'Recent' | 'Suggestions'
}

type SearchDrawerProps = {
  open: boolean
  onClose: () => void
  onSelect: (option: AddressOption) => void
  fieldType: 'origin' | 'destination'
  initialInputValue: string
  recentSearches: RecentSearch[]
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
}: SearchDrawerProps) {
  const [inputValue, setInputValue] = useState('')
  const [suggestions, setSuggestions] = useState<AddressOption[]>([])
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset state when drawer opens
  useEffect(() => {
    if (open) {
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

  const label = fieldType === 'origin' ? 'Origin' : 'Destination'

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
          aria-label="Back"
        >
          <Box
            component="span"
            sx={{ fontSize: 24, fontWeight: 300, lineHeight: 1 }}
          >
            &#8249;
          </Box>
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
            placeholder="Address, place or business name"
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
                      aria-label="Clear"
                    >
                      <Box component="span" sx={{ fontSize: 18, lineHeight: 1 }}>
                        &#10005;
                      </Box>
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
        {items.map((item, index) => (
          <Box key={`${item.label}-${item.lat}-${index}`}>
            <ListItemButton
              onClick={() => onSelect(item)}
              sx={{ px: 2, py: 1.5 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Box
                  component="span"
                  sx={{
                    fontSize: 20,
                    color: item.group === 'Recent' ? 'text.secondary' : 'primary.main',
                  }}
                >
                  {item.group === 'Recent' ? '\u{1F551}' : '\uD83D\uDCCD'}
                </Box>
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
              <Box
                component="span"
                sx={{ color: 'text.secondary', fontSize: 20, ml: 1 }}
              >
                &#8250;
              </Box>
            </ListItemButton>
            <Divider component="li" />
          </Box>
        ))}
        {items.length === 0 && inputValue.trim() && !loading && (
          <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No results found
            </Typography>
          </Box>
        )}
      </List>
    </Drawer>
  )
}
