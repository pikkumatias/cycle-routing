import type { OtpStep } from './types.js'

/** The elevation model has metre-scale noise and spikes at bridges; average over this span… */
const SMOOTH_M = 100
/** …and count a rise only once it clears this much above the last low. */
const HYSTERESIS_M = 2

/**
 * Metres climbed along the steps' elevation profiles. OTP's own `elevationGained` counts every
 * wobble of the elevation model (about twice the profile's raw climb), so the profile is
 * smoothed with a moving average and rises are counted with hysteresis.
 */
export function climbM(steps: OtpStep[]): number {
  const points: Array<[number, number]> = []
  let offset = 0
  for (const step of steps) {
    for (const [m, elevation] of step.elevation ?? []) points.push([offset + m, elevation])
    offset += step.distance
  }
  if (points.length < 2) return 0

  // Centred moving average with a sliding window
  const smoothed: number[] = []
  let lo = 0
  let hi = 0
  let sum = 0
  for (const [m] of points) {
    while (hi < points.length && points[hi][0] <= m + SMOOTH_M / 2) sum += points[hi++][1]
    while (points[lo][0] < m - SMOOTH_M / 2) sum -= points[lo++][1]
    smoothed.push(sum / (hi - lo))
  }

  let climb = 0
  let base = smoothed[0]
  for (const e of smoothed) {
    if (e > base + HYSTERESIS_M) {
      climb += e - base
      base = e
    } else if (e < base) {
      base = e
    }
  }
  // A final rise still under the hysteresis is real climbing too
  return climb + Math.max(0, smoothed[smoothed.length - 1] - base)
}
