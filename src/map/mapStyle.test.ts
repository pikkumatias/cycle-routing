import { describe, it, expect } from 'vitest'
import { buildMapStyle, labelExpression, OPENFREEMAP_TILEJSON } from './mapStyle'
import type { MapPalette } from './palette'

const palette: MapPalette = {
  land: '#010101',
  water: '#020202',
  park: '#030303',
  wood: '#040404',
  building: '#050505',
  road: '#060606',
  roadMajor: '#070707',
  roadCasing: '#080808',
  path: '#090909',
  cycleway: '#0a0a0a',
  rail: '#0b0b0b',
  label: '#0c0c0c',
  labelHalo: '#0d0d0d',
  routeSelected: '#0e0e0e',
  routeCasing: '#0f0f0f',
  routeAlt: '#101010',
  signal: '#111111',
  bike: '#121212',
  bikeInk: '#131313',
  works: '#141414',
  pin: '#151515',
  pinRing: '#161616',
  calm: { veryCalm: '#171717', calm: '#181818', mixed: '#191919', busy: '#1a1a1a' },
}

describe('buildMapStyle', () => {
  const style = buildMapStyle(palette, 'en')
  const layer = (id: string) => style.layers.find((l) => l.id === id) as { paint?: Record<string, unknown> } | undefined

  it('uses OpenFreeMap without any API key', () => {
    expect(style.sources.openmaptiles).toEqual({ type: 'vector', url: OPENFREEMAP_TILEJSON })
    const json = JSON.stringify(style)
    expect(json).not.toMatch(/subscription-key|api[_-]?key|digitransit/i)
  })

  it('paints the basemap from the palette', () => {
    expect(layer('background')?.paint?.['background-color']).toBe(palette.land)
    expect(layer('water')?.paint?.['fill-color']).toBe(palette.water)
    expect(layer('cycleway')?.paint?.['line-color']).toBe(palette.cycleway)
  })

  it('has unique layer ids and keeps the layer routes are drawn beneath', () => {
    const ids = style.layers.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    // RouteMap inserts route lines before this layer
    expect(ids).toContain('label-water')
  })
})

describe('labelExpression', () => {
  it('prefers the Finnish name in Finnish', () => {
    expect(labelExpression('fi')).toEqual(['coalesce', ['get', 'name:fi'], ['get', 'name']])
  })

  it('prefers the English name in English, falling back to the local name', () => {
    const expr = labelExpression('en')
    expect(expr[1]).toEqual(['get', 'name:en'])
    expect(expr[expr.length - 1]).toEqual(['get', 'name'])
  })

  it('is used for every text label', () => {
    for (const lang of ['en', 'fi'] as const) {
      const style = buildMapStyle(palette, lang)
      for (const l of style.layers) {
        const field = (l as { layout?: Record<string, unknown> }).layout?.['text-field']
        if (field) expect(field).toEqual(labelExpression(lang))
      }
    }
  })
})
