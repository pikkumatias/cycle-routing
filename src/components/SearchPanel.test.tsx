import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
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

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const geocodeResponse = (label: string) =>
  new Response(JSON.stringify({ features: [{ properties: { label }, geometry: { coordinates: [24.94, 60.17] } }] }))

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

  it('says the search failed instead of "no matches" when the geocoder is unreachable', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    renderPanel({ recentSearches: [] })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Mannerheimintie' } })
    await act(() => vi.advanceTimersByTimeAsync(400))
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't search")
    expect(screen.queryByText(/No matches/)).not.toBeInTheDocument()
  })

  it('drops a search still pending when the panel closes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => geocodeResponse('Stale place, Helsinki'))
    vi.stubGlobal('fetch', fetchMock)
    const props = { onClose: () => {}, onSelect: () => {}, field: 'destination' as const, initialInputValue: '', recentSearches: [] }
    const { rerender } = render(<SearchPanel open {...props} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Stale' } })
    rerender(<SearchPanel open={false} {...props} />)
    await act(() => vi.advanceTimersByTimeAsync(400))
    rerender(<SearchPanel open {...props} />)
    await act(() => vi.advanceTimersByTimeAsync(400))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Stale place')).not.toBeInTheDocument()
  })

  it('keeps a known location usable while it refreshes', () => {
    const onSelect = vi.fn()
    renderPanel({ field: 'origin', onSelect, locationCoords: { lat: 60.1, lon: 24.9 }, locationLoading: true })
    fireEvent.click(screen.getByText('Your location'))
    expect(onSelect).toHaveBeenCalledWith({ label: '', lat: 60.1, lon: 24.9, group: 'Location' })
  })

  it('picks your location once the requested fix arrives', () => {
    const onSelect = vi.fn()
    const onRequestLocation = vi.fn()
    const props = {
      open: true, onClose: () => {}, onSelect, onRequestLocation, field: 'origin' as const, initialInputValue: '', recentSearches: [],
    }
    const { rerender } = render(<SearchPanel {...props} locationCoords={null} />)
    fireEvent.click(screen.getByText('Use your location'))
    expect(onRequestLocation).toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
    rerender(<SearchPanel {...props} locationCoords={{ lat: 60.2, lon: 24.8 }} />)
    expect(onSelect).toHaveBeenCalledWith({ label: '', lat: 60.2, lon: 24.8, group: 'Location' })
  })
})
