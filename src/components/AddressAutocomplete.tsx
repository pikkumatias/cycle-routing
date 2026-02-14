import { useState, useRef, useEffect } from 'react'
import { Autocomplete, Box, InputAdornment, TextField } from '@mui/material'
import { fetchGeocodingAutocomplete } from '../api/digitransit'
import type { RecentSearch } from '../utils/recentSearches'

export type AddressOption = {
  label: string
  lat: number
  lon: number
  group: 'Recent' | 'Suggestions'
}

type AddressAutocompleteProps = {
  value: AddressOption | null
  onChange: (option: AddressOption | null) => void
  inputValue: string
  onInputChange: (value: string) => void
  recentSearches: RecentSearch[]
  icon?: 'origin' | 'destination'
}

const DEBOUNCE_MS = 300
const COORD_PATTERN = /^-?\d+\.?\d*[,\s]+-?\d+\.?\d*$/

export function AddressAutocomplete({
  value,
  onChange,
  inputValue,
  onInputChange,
  recentSearches,
  icon,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AddressOption[]>([])
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleInputChange = (newValue: string) => {
    onInputChange(newValue)

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
        if (!controller.signal.aborted) {
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

  const options: AddressOption[] =
    suggestions.length > 0 ? [...suggestions, ...recentOptions] : recentOptions

  const placeholder = icon === 'origin' ? 'Origin' : 'Where to?'

  return (
    <Autocomplete
      freeSolo
      value={value}
      inputValue={inputValue}
      options={options}
      loading={loading}
      groupBy={(option) =>
        typeof option === 'string' ? '' : option.group
      }
      getOptionLabel={(option) =>
        typeof option === 'string' ? option : option.label
      }
      isOptionEqualToValue={(a, b) => a.label === b.label}
      filterOptions={(x) => x}
      onChange={(_event, newValue) => {
        if (typeof newValue === 'string') {
          onChange(null)
        } else {
          onChange(newValue)
        }
      }}
      onInputChange={(_event, newValue, reason) => {
        if (reason === 'input') {
          handleInputChange(newValue)
        } else {
          onInputChange(newValue)
        }
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={placeholder}
          fullWidth
          slotProps={{
            input: {
              ...params.InputProps,
              startAdornment: icon ? (
                <>
                  <InputAdornment position="start">
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        bgcolor: icon === 'origin' ? 'success.main' : 'error.main',
                      }}
                    />
                  </InputAdornment>
                  {params.InputProps.startAdornment}
                </>
              ) : (
                params.InputProps.startAdornment
              ),
            },
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: '#F5F5F5',
              '& fieldset': { border: 'none' },
              '&:hover fieldset': { border: 'none' },
              '&.Mui-focused fieldset': {
                border: '2px solid',
                borderColor: 'primary.main',
              },
            },
          }}
        />
      )}
    />
  )
}
