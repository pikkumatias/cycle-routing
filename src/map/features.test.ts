import { describe, it, expect } from 'vitest'
import { bikeFeatures, hazardFeatures, isRoute, routeFeatures, stressFeatures } from './features'
import type { Hazard } from '../services/hazards'

describe('routeFeatures', () => {
  const routes = [
    { id: 'a', legs: [[[60, 24], [60.01, 24.01]]] as [number, number][][] },
    { id: 'b', legs: [[[60, 24], [60.02, 24.02]]] as [number, number][][] },
  ]

  it('makes one feature per route, keyed by id', () => {
    expect(routeFeatures(routes).features.map((f) => f.properties.id)).toEqual(['a', 'b'])
  })

  it('converts [lat, lon] to GeoJSON [lon, lat]', () => {
    const [first] = routeFeatures(routes).features[0].geometry.coordinates[0]
    expect(first).toEqual([24, 60])
  })

  it('filters layers to the selected route or the others', () => {
    expect(isRoute('a')).toEqual(['==', ['get', 'id'], 'a'])
    expect(isRoute('a', true)).toEqual(['!=', ['get', 'id'], 'a'])
    expect(isRoute(null)).toEqual(['==', ['get', 'id'], ''])
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

describe('stressFeatures', () => {
  // 0.01° of latitude ≈ 1113 m
  const legs = [[[60, 24], [60.01, 24]]] as [number, number][][]

  it('splits the route where its traffic changes, one feature per bucket stretch', () => {
    const fc = stressFeatures({ legs, stressRuns: [[556, 'away'], [1113, 'mixedHigh']] })
    expect(fc.features.map((f) => f.properties.bucket)).toEqual(['carFree', 'traffic'])
    const [first, second] = fc.features.map((f) => f.geometry.coordinates)
    expect(first[0]).toEqual([24, 60])
    expect(first.at(-1)![1]).toBeCloseTo(60.005, 4)
    expect(second[0][1]).toBeCloseTo(60.005, 4)
    expect(second.at(-1)).toEqual([24, 60.01])
  })

  it('merges neighbouring runs of one bucket', () => {
    const fc = stressFeatures({ legs, stressRuns: [[500, 'mixedLow'], [1113, 'mixedHigh']] })
    expect(fc.features).toHaveLength(1)
  })

  it('is empty without runs', () => {
    expect(stressFeatures({ legs, stressRuns: [] }).features).toEqual([])
  })
})
