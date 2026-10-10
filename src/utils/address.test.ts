import { describe, it, expect } from 'vitest'
import { coordinateOption, formatCoords } from './address'

describe('coordinateOption', () => {
  it('turns typed "lat,lon" into a selectable option', () => {
    expect(coordinateOption(' 60.1699, 24.9384 ')).toEqual({
      label: '60.16990, 24.93840',
      lat: 60.1699,
      lon: 24.9384,
      group: 'Coordinates',
    })
  })

  it('accepts a space separator', () => {
    expect(coordinateOption('60.17 24.94')).toMatchObject({ lat: 60.17, lon: 24.94 })
  })

  it('ignores text that is not coordinates', () => {
    expect(coordinateOption('Kamppi')).toBeNull()
    expect(coordinateOption('')).toBeNull()
  })

  it('rejects out-of-range coordinates', () => {
    expect(coordinateOption('160, 24')).toBeNull()
  })
})

describe('formatCoords', () => {
  it('rounds to five decimals (about a metre)', () => {
    expect(formatCoords(60.123456789, 24.987654321)).toBe('60.12346, 24.98765')
  })
})
