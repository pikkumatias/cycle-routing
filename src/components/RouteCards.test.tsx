import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

// MUI icons use a deep import path that can fail to resolve in the test environment.
// Mock StarIcon to a plain SVG so the component renders without module issues.
vi.mock('@mui/icons-material/Star', () => ({
  default: () => <svg data-testid="StarIcon" />,
}))

import { RouteCards, RouteCardsSkeleton } from './RouteCards'
import type { ScoredRoute } from './RouteCards'
import type { RouteCategory } from '../api/digitransit'

function makeRoute(overrides?: Partial<ScoredRoute>): ScoredRoute {
  return {
    response: {},
    durationSec: 600,
    distanceKm: 5.0,
    scenicScore: 0,
    infraScore: 0,
    calmScore: 0,
    scenicPoiCount: 0,
    infraSegmentCount: 0,
    lightScore: 0,
    lightCount: 0,
    nearbyPois: [],
    ...overrides,
  }
}

const mockRoutes: Record<RouteCategory, ScoredRoute> = {
  fastest:      makeRoute({ durationSec: 600, calmScore: 50 }),
  scenic:       makeRoute({ durationSec: 900, calmScore: 70 }),
  calm:         makeRoute({ durationSec: 750, calmScore: 100 }),
  fewestLights: makeRoute({ durationSec: 840, lightCount: 2 }),
}

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
  it('renders all four route category labels', () => {
    render(<RouteCards routes={mockRoutes} selectedRoute="calm" onSelect={() => {}} />)
    expect(screen.getByText('Fastest')).toBeInTheDocument()
    expect(screen.getByText('Scenic')).toBeInTheDocument()
    expect(screen.getByText('Calm')).toBeInTheDocument()
    expect(screen.getByText('Fewest Lights')).toBeInTheDocument()
  })

  it('renders 4 cards total', () => {
    const { container } = render(
      <RouteCards routes={mockRoutes} selectedRoute="calm" onSelect={() => {}} />,
    )
    const wrapper = container.querySelector('.route-chips-scroll')
    expect(wrapper?.children).toHaveLength(4)
  })

  it('calls onSelect with "fastest" when the Fastest card is clicked', () => {
    const onSelect = vi.fn()
    render(<RouteCards routes={mockRoutes} selectedRoute="calm" onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Fastest'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('fastest')
  })

  it('calls onSelect with "scenic" when the Scenic card is clicked', () => {
    const onSelect = vi.fn()
    render(<RouteCards routes={mockRoutes} selectedRoute="fastest" onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Scenic'))
    expect(onSelect).toHaveBeenCalledWith('scenic')
  })

  it('calls onSelect with "calm" when the Calm card is clicked', () => {
    const onSelect = vi.fn()
    render(<RouteCards routes={mockRoutes} selectedRoute="fastest" onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Calm'))
    expect(onSelect).toHaveBeenCalledWith('calm')
  })

  it('shows a star icon on the route with the highest calm score', () => {
    // calm route has calmScore 100 — it is the calmest, so exactly one star appears
    render(<RouteCards routes={mockRoutes} selectedRoute="fastest" onSelect={() => {}} />)
    expect(screen.getAllByTestId('StarIcon')).toHaveLength(1)
  })

  it('shows no star icon when all calm scores are 0', () => {
    const allZero: Record<RouteCategory, ScoredRoute> = {
      fastest:      makeRoute({ calmScore: 0 }),
      scenic:       makeRoute({ calmScore: 0 }),
      calm:         makeRoute({ calmScore: 0 }),
      fewestLights: makeRoute({ calmScore: 0 }),
    }
    render(<RouteCards routes={allZero} selectedRoute="fastest" onSelect={() => {}} />)
    expect(screen.queryByTestId('StarIcon')).not.toBeInTheDocument()
  })

  it('displays the formatted duration for each route', () => {
    render(<RouteCards routes={mockRoutes} selectedRoute="calm" onSelect={() => {}} />)
    // 600s = 10 min
    expect(screen.getByText(/10 min/)).toBeInTheDocument()
    // 900s = 15 min
    expect(screen.getByText(/15 min/)).toBeInTheDocument()
    // 750s = 13 min (Math.round(750/60) = 13)
    expect(screen.getByText(/13 min/)).toBeInTheDocument()
  })
})
