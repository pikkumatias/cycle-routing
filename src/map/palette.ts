import type { CalmBand } from '../api/routePlan'
import { toRgba } from '@/lib/color'

/** Colours the map draws with, read from the CSS tokens in `src/styles/theme.css`. */
export type MapPalette = {
  land: string
  water: string
  park: string
  wood: string
  building: string
  road: string
  roadMajor: string
  roadCasing: string
  path: string
  cycleway: string
  rail: string
  label: string
  labelHalo: string
  routeSelected: string
  routeCasing: string
  routeAlt: string
  signal: string
  bike: string
  bikeInk: string
  works: string
  pin: string
  pinRing: string
  calm: Record<CalmBand, string>
}

const TOKENS: Record<Exclude<keyof MapPalette, 'calm'>, string> = {
  land: '--map-land',
  water: '--map-water',
  park: '--map-park',
  wood: '--map-wood',
  building: '--map-building',
  road: '--map-road',
  roadMajor: '--map-road-major',
  roadCasing: '--map-road-casing',
  path: '--map-path',
  cycleway: '--map-cycleway',
  rail: '--map-rail',
  label: '--map-label',
  labelHalo: '--map-label-halo',
  routeSelected: '--route-selected',
  routeCasing: '--route-casing',
  routeAlt: '--route-alt',
  signal: '--signal',
  bike: '--bike',
  bikeInk: '--bike-foreground',
  works: '--works',
  pin: '--pin',
  pinRing: '--pin-ring',
}

const CALM_TOKENS: Record<CalmBand, string> = {
  veryCalm: '--calm-very-calm',
  calm: '--calm-calm',
  mixed: '--calm-mixed',
  busy: '--calm-busy',
}

/** Read the palette from the current document. Call after the theme class is applied. */
export function readMapPalette(root: Element = document.documentElement): MapPalette {
  const style = getComputedStyle(root)
  // MapLibre parses only sRGB notations; grey keeps the map legible if a token is missing.
  const read = (name: string) => toRgba(style.getPropertyValue(name).trim()) || '#888888'
  const palette = Object.fromEntries(
    Object.entries(TOKENS).map(([key, token]) => [key, read(token)]),
  ) as Omit<MapPalette, 'calm'>
  const calm = Object.fromEntries(
    Object.entries(CALM_TOKENS).map(([band, token]) => [band, read(token)]),
  ) as Record<CalmBand, string>
  return { ...palette, calm }
}
