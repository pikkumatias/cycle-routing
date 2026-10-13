// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import polyline from '@mapbox/polyline'
import { buildPlanQuery, createOtpClient, parsePlanResponse } from './otpClient'
import type { OtpRequest } from './types'

const from = { lat: 60.192059, lon: 24.945831 }
const to = { lat: 60.169857, lon: 24.938379 }

const planJson = (legs: Array<Array<[number, number]>>, duration = 900) => ({
  data: {
    planConnection: {
      edges: [
        {
          node: {
            duration,
            legs: legs.map((pts) => ({
              distance: 1000,
              legGeometry: { points: polyline.encode(pts) },
              steps: [{ distance: 1000, streetName: 'bike path', bogusName: true, area: false, walkingBike: false }],
            })),
          },
        },
      ],
    },
  },
})

describe('buildPlanQuery', () => {
  it('builds a direct bicycle plan with a triangle optimization', () => {
    const q = buildPlanQuery({ from, to, optimization: { triangle: { time: 1, safety: 0, flatness: 0 } } })
    expect(q).toContain('planConnection(')
    expect(q).toContain('directOnly: true, direct: [BICYCLE]')
    expect(q).toContain('triangle: { time: 1, safety: 0, flatness: 0 }')
    expect(q).toContain('latitude: 60.192059')
    expect(q).not.toContain('via:')
    expect(q).toContain('elevationProfile { distance elevation }')
  })

  it('adds a visit-via coordinate and an optimization type', () => {
    const q = buildPlanQuery({ from, to, via: { lat: 60.18, lon: 24.93 }, optimization: { type: 'FLAT_STREETS' } })
    expect(q).toContain('via: [{ visit: { coordinate: { latitude: 60.18, longitude: 24.93 } } }]')
    expect(q).toContain('optimization: { type: FLAT_STREETS }')
  })

  it('rejects non-finite numbers instead of sending them', () => {
    const bad: OtpRequest = { from: { lat: NaN, lon: 24.9 }, to, optimization: { type: 'FLAT_STREETS' } }
    expect(() => buildPlanQuery(bad)).toThrow(/Invalid number/)
  })
})

describe('parsePlanResponse', () => {
  it('parses legs, steps, duration and distance', () => {
    const c = parsePlanResponse(planJson([[[60.19, 24.94], [60.18, 24.94]], [[60.18, 24.94], [60.17, 24.94]]]))!
    expect(c.durationSec).toBe(900)
    expect(c.distanceM).toBe(2000)
    expect(c.legs).toHaveLength(2)
    expect(c.legSteps[1][0]).toEqual({
      distance: 1000,
      streetName: 'bike path',
      bogusName: true,
      area: false,
      walkingBike: false,
      elevation: [],
    })
    expect(c.id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('returns null when OTP found no route', () => {
    expect(parsePlanResponse({ data: { planConnection: { edges: [] } } })).toBeNull()
  })

  it('throws on GraphQL errors even with HTTP 200', () => {
    expect(() => parsePlanResponse({ errors: [{ message: 'bad input' }] })).toThrow(/bad input/)
  })

  it('keeps a plan that arrives alongside non-fatal GraphQL errors', () => {
    const json = { ...planJson([[[60.19, 24.94], [60.18, 24.94]]]), errors: [{ message: 'deprecated field' }] }
    expect(parsePlanResponse(json)?.durationSec).toBe(900)
  })

  it('returns null when OTP reports a routing error such as no connection', () => {
    const json = {
      data: { planConnection: { edges: [], routingErrors: [{ code: 'NO_DIRECT_MODE_CONNECTION', description: '…' }] } },
    }
    expect(parsePlanResponse(json)).toBeNull()
  })
})

describe('createOtpClient', () => {
  it('posts the query with the API key and parses the result', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(planJson([[[60.19, 24.94], [60.18, 24.94]]]))))
    const otp = createOtpClient({ apiKey: 'k', timeoutMs: 1000, fetchFn })
    const c = await otp({ from, to, optimization: { type: 'FLAT_STREETS' } })
    expect(c?.durationSec).toBe(900)
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['digitransit-subscription-key']).toBe('k')
  })

  it('rejects on HTTP errors', async () => {
    const otp = createOtpClient({ apiKey: 'k', timeoutMs: 1000, fetchFn: async () => new Response('nope', { status: 503 }) })
    await expect(otp({ from, to, optimization: { type: 'FLAT_STREETS' } })).rejects.toThrow(/503/)
  })

  it('keeps each step\'s elevation profile as [distance, elevation] pairs', () => {
    const json = planJson([[[60.19, 24.94], [60.18, 24.94]]])
    const step = json.data.planConnection.edges[0].node.legs[0].steps[0] as Record<string, unknown>
    step.elevationProfile = [{ distance: 0, elevation: 12.5 }, { distance: 10, elevation: 13 }]
    expect(parsePlanResponse(json)!.legSteps[0][0].elevation).toEqual([[0, 12.5], [10, 13]])
  })
})
