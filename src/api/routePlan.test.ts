import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import polyline from '@mapbox/polyline'
import { fetchRoutePlan, RoutePlanError } from './routePlan'

const from = { lat: 60.19, lon: 24.94 }
let n = 0
/** A destination not yet in the session plan cache. */
const freshTo = () => ({ lat: 60.17, lon: 24.9 + ++n * 0.001 })

const planBody = {
  routes: [
    {
      id: 'r1',
      durationSec: 600,
      distanceM: 2000,
      legs: [polyline.encode([[60.19, 24.94], [60.17, 24.94]])],
      signalStops: [],
      lights: 0,
      calmIndex: 80,
      calmBand: 'calm',
      stressM: { away: 2000, quiet: 0, adjacent: 0, mixedLow: 0, mixedHigh: 0 },
      majorCrossings: 0,
      climbM: 12,
      stressRuns: [[2000, 'away']],
    },
  ],
  cards: [{ routeId: 'r1', primary: 'fastest', badges: [], extraSec: 0 }],
  meta: { calls: 3, failed: 0, partial: false, configVersion: 'x', dataVersion: 'y' },
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function failure(promise: Promise<unknown>): Promise<RoutePlanError> {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(RoutePlanError)
  return error as RoutePlanError
}

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('fetchRoutePlan', () => {
  it('asks with a GET whose coordinates are rounded to ~10 m, so repeat trips share a URL', async () => {
    const fetchMock = vi.fn(async () => json(planBody))
    vi.stubGlobal('fetch', fetchMock)
    await fetchRoutePlan({ lat: 60.192059, lon: 24.945831 }, { lat: 60.1698571, lon: 24.9383 + ++n * 0.001 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method ?? 'GET').toBe('GET')
    const params = new URL(url, 'http://localhost').searchParams
    expect(params.get('from')).toBe('60.1921,24.9458')
    expect(params.get('to')).toMatch(/^60\.1699,24\.\d{4}$/)
  })

  it('asks for a riding speed other than normal, and caches per speed', async () => {
    const fetchMock = vi.fn(async () => json(planBody))
    vi.stubGlobal('fetch', fetchMock)
    const to = freshTo()
    await fetchRoutePlan(from, to, undefined, 'fast')
    await fetchRoutePlan(from, to, undefined, 'normal')
    await fetchRoutePlan(from, to, undefined, 'fast')
    const calls = fetchMock.mock.calls as unknown as [string][]
    const urls = calls.map(([url]) => new URL(url, 'http://localhost').searchParams.get('speed'))
    expect(urls).toEqual(['25', null])
  })

  it('fills in climb and traffic runs missing from older plans', async () => {
    const older: Record<string, unknown> = { ...planBody.routes[0] }
    delete older.climbM
    delete older.stressRuns
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...planBody, routes: [older] })))
    const plan = await fetchRoutePlan(from, freshTo())
    expect(plan.routes[0]).toMatchObject({ climbM: 0, stressRuns: [] })
  })

  it('decodes route legs and caches the plan', async () => {
    const fetchMock = vi.fn(async () => json(planBody))
    vi.stubGlobal('fetch', fetchMock)
    const to = freshTo()
    const plan = await fetchRoutePlan(from, to)
    expect(plan.routes[0].legs[0]).toEqual([[60.19, 24.94], [60.17, 24.94]])
    await fetchRoutePlan(from, to)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['NO_ROUTE', 'OUT_OF_AREA', 'TOO_SHORT', 'UPSTREAM_UNAVAILABLE'] as const)(
    'passes the server error code %s through',
    async (code) => {
      vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'English text', code }, 422)))
      expect((await failure(fetchRoutePlan(from, freshTo()))).code).toBe(code)
    },
  )

  it.each([
    [504, 'TIMEOUT'],
    [502, 'UPSTREAM_UNAVAILABLE'],
    [429, 'UPSTREAM_UNAVAILABLE'],
    [500, 'SERVER_ERROR'],
  ] as const)('maps a bare HTTP %i to %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Gateway</html>', { status })))
    expect((await failure(fetchRoutePlan(from, freshTo()))).code).toBe(code)
  })

  it('treats a non-JSON success as a server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })))
    expect((await failure(fetchRoutePlan(from, freshTo()))).code).toBe('SERVER_ERROR')
  })

  it('reports a network failure, or offline when the browser knows it is', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect((await failure(fetchRoutePlan(from, freshTo()))).code).toBe('NETWORK')
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect((await failure(fetchRoutePlan(from, freshTo()))).code).toBe('OFFLINE')
    onLine.mockRestore()
  })

  it('aborts and reports TIMEOUT when the server takes too long', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
          }),
      ),
    )
    const pending = failure(fetchRoutePlan(from, freshTo()))
    await vi.advanceTimersByTimeAsync(20_000)
    expect((await pending).code).toBe('TIMEOUT')
  })

  it('rejects with an AbortError when the caller cancels', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
          }),
      ),
    )
    const controller = new AbortController()
    const pending = fetchRoutePlan(from, freshTo(), controller.signal).catch((e: unknown) => e)
    controller.abort()
    const error = await pending
    expect(error).not.toBeInstanceOf(RoutePlanError)
    expect((error as Error).name).toBe('AbortError')
  })
})
