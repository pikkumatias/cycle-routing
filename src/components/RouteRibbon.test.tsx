import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { PlannedRoute } from '../api/routePlan'
import { RouteRibbon } from './RouteRibbon'

const route = (stressRuns: PlannedRoute['stressRuns']): PlannedRoute => ({
  id: 'r',
  durationSec: 600,
  distanceM: 1000,
  legs: [],
  signalStops: [],
  lights: 0,
  calmIndex: 70,
  calmBand: 'calm',
  stressM: { away: 0, quiet: 0, adjacent: 0, mixedLow: 0, mixedHigh: 0 },
  majorCrossings: 0,
  climbM: 0,
  stressRuns,
})

describe('RouteRibbon', () => {
  it('colours each stretch of the ride by its traffic, where it is', () => {
    render(<RouteRibbon route={route([[250, 'away'], [1000, 'mixedHigh']])} maxDurationSec={600} selected={false} />)
    const runs = screen.getAllByTestId('ribbon-run')
    expect(runs.map((r) => [r.style.left, r.style.width])).toEqual([
      ['0%', '25%'],
      ['25%', '75%'],
    ])
    expect(runs[0]).toHaveClass('bg-calm-very-calm')
    expect(runs[1]).toHaveClass('bg-calm-busy')
  })

  it('falls back to the calm band colour without traffic runs', () => {
    render(<RouteRibbon route={route([])} maxDurationSec={600} selected={false} />)
    expect(screen.queryAllByTestId('ribbon-run')).toHaveLength(0)
    expect(screen.getByTestId('route-ribbon').firstElementChild).toHaveClass('bg-calm-calm')
  })
})
