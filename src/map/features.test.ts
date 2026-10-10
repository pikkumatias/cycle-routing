import { describe, it, expect } from 'vitest'
import { bikeFeatures, hazardFeatures, routeFeatures } from './features'
import type { Hazard } from '../services/hazards'

describe('routeFeatures', () => {
  const routes = [
    { id: 'a', legs: [[[60, 24], [60.01, 24.01]]] as [number, number][][] },
    { id: 'b', legs: [[[60, 24], [60.02, 24.02]]] as [number, number][][] },
  ]

  it('flags the selected route and draws it last', () => {
    const fc = routeFeatures(routes, 'a')
    expect(fc.features.map((f) => [f.properties.id, f.properties.selected])).toEqual([
      ['b', false],
      ['a', true],
    ])
  })

  it('converts [lat, lon] to GeoJSON [lon, lat]', () => {
    const [first] = routeFeatures(routes, null).features[0].geometry.coordinates[0]
    expect(first).toEqual([24, 60])
  })
})

describe('bikeFeatures', () => {
  it('carries the bike count for cluster sums', () => {
    const fc = bikeFeatures([{ stationId: 's1', name: 'Kamppi', lat: 60.1, lon: 24.9, bikesAvailable: 7 }])
    expect(fc.features[0].properties).toEqual({ id: 's1', name: 'Kamppi', bikes: 7 })
    expect(fc.features[0].geometry.coordinates).toEqual([24.9, 60.1])
  })
})

describe('hazardFeatures', () => {
  const base = { purpose: null, address: null, district: null, startDate: null, endDate: null }
  const hazards: Hazard[] = [
    {
      ...base,
      id: 'area',
      type: 'excavation',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [24.9, 60.1],
            [24.91, 60.1],
            [24.91, 60.11],
            [24.9, 60.1],
          ],
        ],
      },
    },
    { ...base, id: 'point', type: 'area_rental', geometry: { type: 'Point', coordinates: [24.95, 60.15] } },
  ]

  it('draws areas for polygons and a marker for every roadwork', () => {
    const { areas, points } = hazardFeatures(hazards)
    expect(areas.features.map((f) => f.properties.id)).toEqual(['area'])
    expect(points.features.map((f) => f.properties.id)).toEqual(['area', 'point'])
    expect(points.features[1].geometry.coordinates).toEqual([24.95, 60.15])
  })
})
