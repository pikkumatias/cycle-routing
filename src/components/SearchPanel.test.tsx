import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { SearchPanel } from './SearchPanel'

beforeAll(() => {
  // cmdk measures and scrolls items; jsdom has neither
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
})

const renderPanel = (overrides: Partial<Parameters<typeof SearchPanel>[0]> = {}) =>
  render(
    <SearchPanel
      open
      onClose={() => {}}
      onSelect={() => {}}
      field="destination"
      initialInputValue=""
      recentSearches={[{ label: 'Kallion kirjasto, Helsinki', lat: 60.18, lon: 24.95 }]}
      {...overrides}
    />,
  )

describe('SearchPanel', () => {
  it('offers typed coordinates as a selectable row', () => {
    const onSelect = vi.fn()
    renderPanel({ onSelect })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '60.17, 24.94' } })
    fireEvent.click(screen.getByText('Use coordinates 60.17000, 24.94000'))
    expect(onSelect).toHaveBeenCalledWith({ label: '60.17000, 24.94000', lat: 60.17, lon: 24.94, group: 'Coordinates' })
  })

  it('lists recent places, split into name and area', () => {
    const onSelect = vi.fn()
    renderPanel({ onSelect })
    expect(screen.getByText('Helsinki')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Kallion kirjasto'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ lat: 60.18, lon: 24.95, group: 'Recent' }))
  })

  it('offers your location for the start only', () => {
    const { unmount } = renderPanel({ field: 'origin', locationCoords: { lat: 60.1, lon: 24.9 } })
    expect(screen.getByText('Your location')).toBeInTheDocument()
    unmount()
    renderPanel({ field: 'destination', locationCoords: { lat: 60.1, lon: 24.9 } })
    expect(screen.queryByText('Your location')).not.toBeInTheDocument()
  })
})
