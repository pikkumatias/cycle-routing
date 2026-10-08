// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from './config'
import { hashGeometry } from './geo'
import type { OtpCall } from './otpClient'
import { planRoutes } from './planRoutes'
import { at, line, makeLayers, pathStep } from './testHelpers'
import type { Candidate, LatLng, OtpRequest } from './types'

const from = { lat: at(0, 0)[0], lon: at(0, 0)[1] }
const to = { lat: at(2000, 0)[0], lon: at(2000, 0)[1] }

const route = (legs: LatLng[][], durationSec: number): Candidate => ({
  id: hashGeometry(legs),
  generators: [],
  durationSec,
  distanceM: 2000,
  legs,
  legSteps: legs.map(() => [pathStep(1e6)]),
})
const STRAIGHT = route([line([[0, 0], [2000, 0]])], 600)
const NORTH = route([line([[0, 0], [400, 0], [400, 300], [1600, 300], [1600, 0], [2000, 0]])], 700)

/** Fake OTP: presets by safety factor; via requests ride through the via point. */
function fakeOtp(opts: { failSafety?: boolean } = {}): OtpCall & { requests: OtpRequest[] } {
  const requests: OtpRequest[] = []
  const otp = (async (req: OtpRequest) => {
    requests.push(req)
    if (req.via) {
      const via: LatLng = [req.via.lat, req.via.lon]
      return route([[at(0, 0), via], [via, at(2000, 0)]], 750)
    }
    const o = req.optimization
    if ('triangle' in o && o.triangle.safety === 1) {
      if (opts.failSafety) throw new Error('boom')
      return NORTH
    }
    return STRAIGHT
  }) as OtpCall & { requests: OtpRequest[] }
  otp.requests = requests
  return otp
}

describe('planRoutes', () => {
  // Five signal stops along the straight route, calm nodes north of the cluster
  const layers = makeLayers({
    signals: [[300, 0], [800, 0], [950, 0], [1100, 0], [1250, 0]],
    calmNodes: [[1000, 320], [1000, -330]],
  })

  it('runs presets, merges identical geometries and adds round-2 via routes', async () => {
    const otp = fakeOtp()
    const plan = await planRoutes(from, to, { otp, layers })
    const straight = plan.routes.find((r) => r.id === STRAIGHT.id)!
    expect(straight.generators).toEqual(['preset:fastest', 'preset:balanced'])
    expect(plan.routes.some((r) => r.generators.includes('via:lights'))).toBe(true)
    expect(plan.meta).toMatchObject({ failed: 0, partial: false, configVersion: DEFAULT_CONFIG.configVersion })
    expect(plan.meta.calls).toBe(otp.requests.length)
    expect(plan.selection.cards[0]).toMatchObject({ routeId: STRAIGHT.id, primary: 'fastest' })
  })

  it('profiles every route it returns', async () => {
    const plan = await planRoutes(from, to, { otp: fakeOtp(), layers })
    expect(plan.routes.find((r) => r.id === STRAIGHT.id)!.profile.lights).toBe(5)
  })

  it('counts failed calls and keeps going', async () => {
    const plan = await planRoutes(from, to, { otp: fakeOtp({ failSafety: true }), layers })
    expect(plan.meta.failed).toBe(1)
    expect(plan.routes.some((r) => r.id === NORTH.id)).toBe(false)
  })

  it('skips round 2 and marks the plan partial when round 1 is slow', async () => {
    let clock = 0
    const otp = fakeOtp()
    const slowOtp: OtpCall = async (req) => {
      clock += 3000
      return otp(req)
    }
    const plan = await planRoutes(from, to, { otp: slowOtp, layers, now: () => clock })
    expect(plan.meta.partial).toBe(true)
    expect(otp.requests.every((r) => !r.via)).toBe(true)
  })

  it('throws when no preset finds a route', async () => {
    const none: OtpCall = async () => null
    await expect(planRoutes(from, to, { otp: none, layers })).rejects.toThrow('No route found')
  })
})
