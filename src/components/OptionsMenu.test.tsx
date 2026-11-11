import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { OptionsMenu } from './OptionsMenu'

describe('OptionsMenu', () => {
  it('credits every data source with a link that opens in a new tab', () => {
    render(<OptionsMenu showCityBikes={false} onShowCityBikes={() => {}} showRoadworks={false} onShowRoadworks={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Map and settings' }))

    const sources = within(screen.getByRole('list', { name: 'Data sources' }))
    const links = sources.getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual([
      'Digitransit, HSL',
      '© OpenStreetMap contributors',
      'OpenFreeMap, © OpenMapTiles',
      'City of Helsinki',
    ])
    for (const a of links) expect(a).toHaveAttribute('target', '_blank')
    expect(sources.getByText(/Winter maintenance routes and roadworks/)).toBeInTheDocument()
  })
})
