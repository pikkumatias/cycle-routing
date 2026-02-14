import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock import.meta.env before importing the module
const TEST_API_KEY = 'test-digitransit-key'

beforeEach(() => {
  vi.stubEnv('VITE_DIGITRANSIT_API_KEY', TEST_API_KEY)
})

describe('HSL_TILE_CONFIG', () => {
  async function loadConfig() {
    // Re-import to pick up the stubbed env var.
    // Dynamic import always returns fresh module in vitest with vi.resetModules().
    vi.resetModules()
    const mod = await import('./RouteMap')
    return mod.HSL_TILE_CONFIG
  }

  it('uses the Digitransit CDN hsl-map-en source', async () => {
    const config = await loadConfig()
    expect(config.url).toContain('cdn.digitransit.fi/map/v3/hsl-map-en/')
  })

  it('includes the API key as a query parameter', async () => {
    const config = await loadConfig()
    expect(config.url).toContain(
      `digitransit-subscription-key=${TEST_API_KEY}`,
    )
  })

  it('contains {z}/{x}/{y} placeholders for Leaflet', async () => {
    const config = await loadConfig()
    expect(config.url).toContain('{z}/{x}/{y}')
  })

  it('requests @2x retina .png tiles', async () => {
    const config = await loadConfig()
    expect(config.url).toMatch(/\{y\}@2x\.png/)
  })

  it('sets tileSize to 512 to match HSL tile dimensions', async () => {
    const config = await loadConfig()
    expect(config.tileSize).toBe(512)
  })

  it('sets zoomOffset to -1 to compensate for 512px tiles', async () => {
    const config = await loadConfig()
    expect(config.zoomOffset).toBe(-1)
  })

  it('includes attribution for both OpenStreetMap and Digitransit', async () => {
    const config = await loadConfig()
    expect(config.attribution).toContain('OpenStreetMap')
    expect(config.attribution).toContain('Digitransit')
  })
})
