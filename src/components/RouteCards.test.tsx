import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

import { RouteCards, RouteCardsSkeleton } from './RouteCards'
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

// ── RouteCardsSkeleton ────────────────────────────────────────────────────────

describe('RouteCardsSkeleton', () => {
  it('renders exactly 2 placeholder cards', () => {
    const { container } = render(<RouteCardsSkeleton />)
    const wrapper = container.querySelector('.route-chips-scroll')
    expect(wrapper?.children).toHaveLength(2)
  })
})

// ── RouteCards ────────────────────────────────────────────────────────────────

describe('RouteCards', () => {
  const renderCards = (overrides: Partial<Parameters<typeof RouteCards>[0]> = {}) =>
    render(<RouteCards cards={cards} routesById={routesById} selectedId="a" onSelect={() => {}} {...overrides} />)

  it('renders one card per entry with its category title', () => {
    const { container } = renderCards()
    expect(container.querySelector('.route-chips-scroll')?.children).toHaveLength(3)
    expect(screen.getByText('Fastest')).toBeInTheDocument()
    expect(screen.getByText('Fewest Lights')).toBeInTheDocument()
    expect(screen.getByText('Calm')).toBeInTheDocument()
  })

  it('calls onSelect with the route id of the clicked card', () => {
    const onSelect = vi.fn()
    renderCards({ onSelect })
    fireEvent.click(screen.getByText('Calm'))
    expect(onSelect).toHaveBeenCalledWith('c')
  })

  it('shows lights and calm band on every card', () => {
    renderCards()
    expect(screen.getByText(/5 lights/)).toBeInTheDocument()
    expect(screen.getByText(/2 lights/)).toBeInTheDocument()
    expect(screen.getByText(/4 lights/)).toBeInTheDocument()
    expect(screen.getByText('Busy · 40')).toBeInTheDocument()
    expect(screen.getByText('Very calm · 88')).toBeInTheDocument()
  })

  it('shows extra time compared with Fastest', () => {
    renderCards()
    expect(screen.getByText(/\+4 min/)).toBeInTheDocument()
    expect(screen.getAllByText(/\+\d+ min/)).toHaveLength(2) // not on the Fastest card
  })

  it('renders badges for categories a card also wins', () => {
    renderCards({ cards: [{ routeId: 'a', primary: 'fastest', badges: ['fewestLights', 'calm'], extraSec: 0 }] })
    expect(screen.getByText('Fewest lights')).toBeInTheDocument()
    expect(screen.getByText('Calmest')).toBeInTheDocument()
  })

  it('skips cards whose route is missing', () => {
    const { container } = renderCards({ cards: [{ routeId: 'zzz', primary: 'calm', badges: [], extraSec: 0 }] })
    expect(container.querySelector('.route-chips-scroll')?.children).toHaveLength(0)
  })

  it('displays the formatted duration and distance', () => {
    renderCards()
    expect(screen.getByText(/10 min · 5.0 km/)).toBeInTheDocument()
  })
})
