export type LatLonPair = {
  lat: number
  lon: number
}

export function parseLatLon(input: string): LatLonPair {
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

export type GeocodingResult = {
  label: string
  lat: number
  lon: number
}

/** Languages the geocoder can label results in. */
export type GeocodingLang = 'en' | 'fi'

export async function fetchGeocodingAutocomplete(
  text: string,
  signal?: AbortSignal,
  lang: GeocodingLang = 'en',
): Promise<GeocodingResult[]> {
  if (!text.trim()) return []

  const url = new URL('/api/digitransit-geocode', window.location.origin)
  url.searchParams.set('text', text)
  url.searchParams.set('size', '5')
  url.searchParams.set('lang', lang)
  url.searchParams.set('focus.point.lat', '60.17')
  url.searchParams.set('focus.point.lon', '24.94')

  const res = await fetch(url.toString(), { signal })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `Geocoding API error: ${res.status} ${res.statusText}\n${body}`,
    )
  }

  const data = await res.json()
  type GeoJsonFeature = {
    properties?: { label?: string }
    geometry?: { coordinates?: [number, number] }
  }
  const features: GeoJsonFeature[] = (data as { features?: GeoJsonFeature[] })?.features ?? []

  return features.map((f) => ({
    label: f.properties?.label ?? '',
    lon: f.geometry?.coordinates?.[0] ?? 0,
    lat: f.geometry?.coordinates?.[1] ?? 0,
  }))
}

export async function fetchReverseGeocode(
  lat: number,
  lon: number,
  signal?: AbortSignal,
  lang: GeocodingLang = 'en',
): Promise<GeocodingResult | null> {
  const url = new URL('/api/digitransit-reverse-geocode', window.location.origin)
  url.searchParams.set('point.lat', String(lat))
  url.searchParams.set('point.lon', String(lon))
  url.searchParams.set('lang', lang)

  const res = await fetch(url.toString(), { signal })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Reverse geocoding API error: ${res.status} ${res.statusText}\n${body}`)
  }

  const data = await res.json()
  type GeoJsonFeature = {
    properties?: { label?: string }
    geometry?: { coordinates?: [number, number] }
  }
  const features: GeoJsonFeature[] = (data as { features?: GeoJsonFeature[] })?.features ?? []
  const first = features[0]
  if (!first) return null

  return {
    label: first.properties?.label ?? '',
    lon: first.geometry?.coordinates?.[0] ?? lon,
    lat: first.geometry?.coordinates?.[1] ?? lat,
  }
}
