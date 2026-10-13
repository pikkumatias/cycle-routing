import { parseLatLon } from '../api/digitransit'

/** A chosen or suggested place for the trip's start or destination. */
export type AddressOption = {
  label: string
  lat: number
  lon: number
  /**
   * Where it came from. `Location` is the device position; its label is
   * shown translated rather than stored.
   */
  group: 'Recent' | 'Suggestions' | 'Map' | 'Location' | 'Coordinates'
}

/** Matches "lat,lon" or "lat lon" as typed into the search field. */
export const COORD_PATTERN = /^-?\d+\.?\d*[,\s]+-?\d+\.?\d*$/

/** "Mannerheimintie 1, Helsinki" → name on top, area underneath. */
export function splitLabel(label: string): { primary: string; secondary?: string } {
  const [primary, ...rest] = label.split(',')
  const secondary = rest.join(',').trim()
  return { primary: primary.trim(), secondary: secondary || undefined }
}

export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}

/** Typed coordinates as a selectable option, or null when the input isn't coordinates. */
export function coordinateOption(input: string): AddressOption | null {
  const text = input.trim()
  if (!COORD_PATTERN.test(text)) return null
  try {
    const { lat, lon } = parseLatLon(text)
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
    return { label: formatCoords(lat, lon), lat, lon, group: 'Coordinates' }
  } catch {
    return null
  }
}
