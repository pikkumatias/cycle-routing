import type { ExpressionSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { MapPalette } from './palette'

/**
 * Basemap style over OpenFreeMap's OpenMapTiles vector tiles (no API key).
 * Deliberately quiet so routes read first, except for cycleways, which are
 * drawn in the accent tint: the basemap shows the cycle network.
 */
export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet'
export const OPENFREEMAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

export type MapLanguage = 'en' | 'fi'

const SOURCE = 'openmaptiles'
const FONT_REGULAR = ['Noto Sans Regular']
const FONT_BOLD = ['Noto Sans Bold']

/** Label text in the app language, falling back to the local name. */
export function labelExpression(lang: MapLanguage): ExpressionSpecification {
  return lang === 'fi'
    ? ['coalesce', ['get', 'name:fi'], ['get', 'name']]
    : ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']]
}

const notBridgeOrTunnel: ExpressionSpecification = ['match', ['get', 'brunnel'], ['bridge', 'tunnel'], false, true]
const isLine: ExpressionSpecification = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]

/** Paths a bike is meant to use: OSM cycleways and bicycle-designated paths. */
export const CYCLEWAY_FILTER: ExpressionSpecification = [
  'all',
  isLine,
  ['==', ['get', 'class'], 'path'],
  ['any', ['==', ['get', 'subclass'], 'cycleway'], ['match', ['get', 'bicycle'], ['designated', 'yes'], true, false]],
]

const widthByZoom = (stops: [number, number][]): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()] as ExpressionSpecification

export function buildMapStyle(p: MapPalette, lang: MapLanguage): StyleSpecification {
  const name = labelExpression(lang)
  return {
    version: 8,
    glyphs: OPENFREEMAP_GLYPHS,
    sources: {
      [SOURCE]: { type: 'vector', url: OPENFREEMAP_TILEJSON },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': p.land } },
      {
        id: 'park',
        type: 'fill',
        source: SOURCE,
        'source-layer': 'park',
        paint: { 'fill-color': p.park },
      },
      {
        id: 'landcover-wood',
        type: 'fill',
        source: SOURCE,
        'source-layer': 'landcover',
        filter: ['match', ['get', 'class'], ['wood', 'forest'], true, false],
        paint: { 'fill-color': p.wood },
      },
      {
        id: 'landcover-grass',
        type: 'fill',
        source: SOURCE,
        'source-layer': 'landcover',
        filter: ['match', ['get', 'class'], ['grass', 'farmland', 'wetland'], true, false],
        paint: { 'fill-color': p.park, 'fill-opacity': 0.7 },
      },
      {
        id: 'water',
        type: 'fill',
        source: SOURCE,
        'source-layer': 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: { 'fill-color': p.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: SOURCE,
        'source-layer': 'waterway',
        paint: { 'line-color': p.water, 'line-width': widthByZoom([[10, 0.5], [16, 3]]) },
      },
      {
        id: 'building',
        type: 'fill',
        source: SOURCE,
        'source-layer': 'building',
        minzoom: 14,
        paint: { 'fill-color': p.building, 'fill-outline-color': p.roadCasing },
      },
      {
        id: 'road-path',
        type: 'line',
        source: SOURCE,
        'source-layer': 'transportation',
        minzoom: 14,
        filter: ['all', isLine, ['match', ['get', 'class'], ['path', 'pedestrian', 'track'], true, false]],
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': p.path,
          'line-width': widthByZoom([[14, 0.6], [18, 2]]),
          'line-dasharray': [2, 1.5],
        },
      },
      {
        id: 'road-minor-casing',
        type: 'line',
        source: SOURCE,
        'source-layer': 'transportation',
        minzoom: 12,
        filter: ['all', isLine, notBridgeOrTunnel, ['match', ['get', 'class'], ['minor', 'service'], true, false]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.roadCasing, 'line-width': widthByZoom([[12, 0.5], [14, 3], [18, 16]]) },
      },
      {
        id: 'road-major-casing',
        type: 'line',
        source: SOURCE,
        'source-layer': 'transportation',
        filter: [
          'all',
          notBridgeOrTunnel,
          ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.roadCasing, 'line-width': widthByZoom([[8, 1], [12, 3], [14, 6], [18, 26]]) },
      },
      {
        id: 'road-minor',
        type: 'line',
        source: SOURCE,
        'source-layer': 'transportation',
        minzoom: 12,
        filter: ['all', isLine, notBridgeOrTunnel, ['match', ['get', 'class'], ['minor', 'service'], true, false]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.road, 'line-width': widthByZoom([[12, 0.3], [14, 2], [18, 13]]) },
      },
      {
        id: 'road-major',
        type: 'line',
        source: SOURCE,
        'source-layer': 'transportation',
        filter: [
          'all',
          ['!=', ['get', 'brunnel'], 'tunnel'],
          ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': p.roadMajor, 'line-width': widthByZoom([[8, 0.5], [12, 2], [14, 4.5], [18, 22]]) },
      },
      {
        id: 'cycleway',
        type: 'line',
        source: SOURCE,
        'source-layer': 'transportation',
        minzoom: 12,
        filter: CYCLEWAY_FILTER,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.cycleway,
          'line-width': widthByZoom([[12, 0.6], [14, 1.4], [18, 4]]),
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.45, 15, 0.8],
        },
      },
      {
        id: 'rail',
        type: 'line',
        source: SOURCE,
        'source-layer': 'transportation',
        filter: ['all', ['!=', ['get', 'brunnel'], 'tunnel'], ['match', ['get', 'class'], ['rail', 'transit'], true, false]],
        paint: { 'line-color': p.rail, 'line-width': widthByZoom([[10, 0.6], [16, 2]]) },
      },
      {
        id: 'label-water',
        type: 'symbol',
        source: SOURCE,
        'source-layer': 'water_name',
        layout: { 'text-field': name, 'text-font': FONT_REGULAR, 'text-size': 12, 'text-max-width': 8 },
        paint: { 'text-color': p.label, 'text-halo-color': p.water, 'text-halo-width': 1 },
      },
      {
        id: 'label-road',
        type: 'symbol',
        source: SOURCE,
        'source-layer': 'transportation_name',
        minzoom: 13,
        filter: ['match', ['get', 'class'], ['path', 'track'], false, true],
        layout: {
          'symbol-placement': 'line',
          'text-field': name,
          'text-font': FONT_REGULAR,
          'text-size': widthByZoom([[13, 10], [18, 13]]),
        },
        paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.5 },
      },
      {
        id: 'label-place-minor',
        type: 'symbol',
        source: SOURCE,
        'source-layer': 'place',
        minzoom: 12,
        filter: ['match', ['get', 'class'], ['neighbourhood', 'quarter', 'suburb', 'island'], true, false],
        layout: { 'text-field': name, 'text-font': FONT_REGULAR, 'text-size': 12, 'text-max-width': 8 },
        paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.5 },
      },
      {
        id: 'label-place-major',
        type: 'symbol',
        source: SOURCE,
        'source-layer': 'place',
        maxzoom: 14,
        filter: ['match', ['get', 'class'], ['city', 'town', 'village'], true, false],
        layout: { 'text-field': name, 'text-font': FONT_BOLD, 'text-size': widthByZoom([[8, 12], [13, 16]]) },
        paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.5 },
      },
    ],
  }
}
