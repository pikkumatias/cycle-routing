import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

import { RouteOptions, RouteOptionsSkeleton } from './RouteOptions'
import type { PlannedRoute, RouteCard } from '../api/routePlan'

function makeRoute(id: string, overrides?: Partial<PlannedRoute>): PlannedRoute {
  return {
    id,
    durationSec: 600,
    distanceM: 5000,
    legs: [],
    signalStops: [],
    lights: 0,
    calmIndex: 50,
    calmBand: 'mixed',
    stressM: { away: 0, quiet: 0, adjacent: 0, mixedLow: 0, mixedHigh: 0 },
    majorCrossings: 0,
    ...overrides,
  }
}

const routesById: Record<string, PlannedRoute> = {
  a: makeRoute('a', { durationSec: 600, lights: 5, calmIndex: 40, calmBand: 'busy' }),
  b: makeRoute('b', { durationSec: 840, lights: 2, calmIndex: 60, calmBand: 'mixed' }),
  c: makeRoute('c', { durationSec: 750, lights: 4, calmIndex: 88, calmBand: 'veryCalm' }),
}

const cards: RouteCard[] = [
  { routeId: 'a', primary: 'fastest', badges: [], extraSec: 0 },
  { routeId: 'b', primary: 'fewestLights', badges: [], extraSec: 240 },
  { routeId: 'c', primary: 'calm', badges: [], extraSec: 150 },
]

describe('RouteOptionsSkeleton', () => {
  it('renders three placeholder rows', () => {
    render(<RouteOptionsSkeleton />)
    expect(screen.getByTestId('route-options-skeleton').children).toHaveLength(3)
  })
})

describe('RouteOptions', () => {
  const renderOptions = (overrides: Partial<Parameters<typeof RouteOptions>[0]> = {}) =>
    render(<RouteOptions cards={cards} routesById={routesById} selectedId="a" onSelect={() => {}} {...overrides} />)

  it('renders one radio per card with its category title', () => {
    renderOptions()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(radios[0]).toHaveTextContent('Fastest')
    expect(radios[1]).toHaveTextContent('Fewest lights')
    expect(radios[2]).toHaveTextContent('Calm')
  })

  it('marks only the selected route as checked', () => {
    renderOptions({ selectedId: 'b' })
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    // Roving tab stop: only the selected row is tabbable
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1])
  })

  it('calls onSelect with the route id of the clicked row', () => {
    const onSelect = vi.fn()
    renderOptions({ onSelect })
    fireEvent.click(screen.getAllByRole('radio')[2])
    expect(onSelect).toHaveBeenCalledWith('c')
  })

  it('moves the selection with arrow keys, wrapping around', () => {
    const onSelect = vi.fn()
    renderOptions({ onSelect, selectedId: 'a' })
    const group = screen.getByRole('radiogroup')
    fireEvent.keyDown(group, { key: 'ArrowDown' })
    expect(onSelect).toHaveBeenLastCalledWith('b')
    fireEvent.keyDown(group, { key: 'ArrowUp' })
    expect(onSelect).toHaveBeenLastCalledWith('c')
  })

  it('shows lights and calm band on every row', () => {
    renderOptions()
    expect(screen.getByText('5 lights')).toBeInTheDocument()
    expect(screen.getByText('2 lights')).toBeInTheDocument()
    expect(screen.getByText('4 lights')).toBeInTheDocument()
    expect(screen.getByText('Busy')).toBeInTheDocument()
    expect(screen.getByText('Very calm')).toBeInTheDocument()
    expect(screen.getByLabelText('Calm score 88 of 100')).toHaveTextContent('88')
  })

  it('shows extra time compared with Fastest, but not on Fastest', () => {
    renderOptions()
    expect(screen.getByText('+4 min')).toBeInTheDocument()
    expect(screen.getAllByText(/^\+\d+ min$/)).toHaveLength(2)
  })

  it('renders badges for categories a row also wins', () => {
    renderOptions({ cards: [{ routeId: 'a', primary: 'fastest', badges: ['fewestLights', 'calm'], extraSec: 0 }] })
    expect(screen.getByText('Fewest lights')).toBeInTheDocument()
    expect(screen.getByText('Calmest')).toBeInTheDocument()
  })

  it('skips cards whose route is missing', () => {
    renderOptions({ cards: [{ routeId: 'zzz', primary: 'calm', badges: [], extraSec: 0 }] })
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('displays the duration and distance', () => {
    renderOptions()
    expect(screen.getByText('10 min')).toBeInTheDocument()
    expect(screen.getAllByText('5.0 km')).toHaveLength(3)
  })

  it('shows roadworks status on the selected row only when enabled', () => {
    const { rerender } = renderOptions({ roadworks: { enabled: true, loading: false, count: 2 } })
    expect(screen.getByText('2 roadworks on this route')).toBeInTheDocument()
    rerender(
      <RouteOptions
        cards={cards}
        routesById={routesById}
        selectedId="a"
        onSelect={() => {}}
        roadworks={{ enabled: false, loading: false, count: 2 }}
      />,
    )
    expect(screen.queryByText(/roadworks on this route/)).not.toBeInTheDocument()
  })
})
