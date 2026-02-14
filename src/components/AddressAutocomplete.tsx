import { useState, useRef, useEffect } from 'react'
import { Autocomplete, TextField } from '@mui/material'
import { fetchGeocodingAutocomplete } from '../api/digitransit'
import type { RecentSearch } from '../utils/recentSearches'

export type AddressOption = {
  label: string
  lat: number
  lon: number
  group: 'Recent' | 'Suggestions'
}

type AddressAutocompleteProps = {
  label: string
  value: AddressOption | null
  onChange: (option: AddressOption | null) => void
  inputValue: string
  onInputChange: (value: string) => void
  recentSearches: RecentSearch[]
}

const DEBOUNCE_MS = 300
const COORD_PATTERN = /^-?\d+\.?\d*[,\s]+-?\d+\.?\d*$/

export function AddressAutocomplete({
  label,
  value,
  onChange,
  inputValue,
  onInputChange,
  recentSearches,
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

    // Cancel in-flight request and pending timer
    abortRef.current?.abort()
    if (timerRef.current) clearTimeout(timerRef.current)

    // Skip API call for empty input or raw coordinates
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
      } catch (err) {
        if (!controller.signal.aborted) {
          setSuggestions([])
          setLoading(false)
        }
      }
    }, DEBOUNCE_MS)
  }

  // Build the combined options list: suggestions first, then filtered recents
  const recentOptions: AddressOption[] = recentSearches
    .filter(
      (r) =>
        !inputValue.trim() ||
        r.label.toLowerCase().includes(inputValue.toLowerCase()),
    )
    .map((r) => ({ ...r, group: 'Recent' as const }))

  const options: AddressOption[] =
    suggestions.length > 0 ? [...suggestions, ...recentOptions] : recentOptions

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
        <TextField {...params} label={label} fullWidth />
      )}
    />
  )
}
