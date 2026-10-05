import type { RoutingConfig } from './config.js'
import { routePolyline } from './profile.js'
import { buildShape, isDistinct, type Shape } from './similarity.js'
import type { Category, ProfiledCandidate, RouteCard, SelectionResult } from './types.js'

const CATEGORY_ORDER: Category[] = ['fastest', 'fewestLights', 'calm']

/**
 * Choose up to three genuinely different cards from a scored pool.
 *
 * 1. Fastest: minimum duration (ties → fewer lights).
 * 2. Fewest lights: among routes within the lights cap, ranked by
 *    `lights + extraMinutes / minutesPerLight`; the first that saves ≥ minLightGain lights
 *    against every shown card and is distinct from them gets a card. A near-duplicate
 *    qualifies only with variantGainFactor × the gain.
 * 3. Calm: among routes within the calm cap, ranked by
 *    `calmIndex − calmPointsPerMinute × extraMinutes`, same rules with minCalmGain.
 * 4. Roles are then re-assigned over the shown cards by metric — fewest lights among cards
 *   within the lights cap, highest calm index overall — so a later card that beats an earlier
 *   one takes over its badge. A card that ends up winning nothing is dropped.
 */
export function selectCards(pool: ProfiledCandidate[], cfg: RoutingConfig): SelectionResult {
  if (pool.length === 0) throw new Error('No candidate routes available')
  const reasons: string[] = []

  const fastest = pool.reduce((best, c) =>
    c.durationSec < best.durationSec ||
    (c.durationSec === best.durationSec && c.profile.lights < best.profile.lights)
      ? c
      : best,
  )
  const extraMin = (c: ProfiledCandidate) => Math.max(0, c.durationSec - fastest.durationSec) / 60
  const withinCap = (c: ProfiledCandidate, cap: { frac: number; minSec: number }) =>
    c.durationSec <= fastest.durationSec + Math.max(cap.frac * fastest.durationSec, cap.minSec)

  const shapes = new Map<string, Shape>()
  const shapeOf = (c: ProfiledCandidate) => {
    let s = shapes.get(c.id)
    if (!s) shapes.set(c.id, (s = buildShape(routePolyline(c.legs))))
    return s
  }

  const shown: Array<{ route: ProfiledCandidate; addedFor: Category }> = [{ route: fastest, addedFor: 'fastest' }]
  const isShown = (c: ProfiledCandidate) => shown.some((s) => s.route.id === c.id)

  /** First candidate (in ranked order) that clears the gain and is distinct, or a strong variant. */
  const pick = (ranked: ProfiledCandidate[], gainOf: (c: ProfiledCandidate) => number, minGain: number) =>
    ranked.find((c) => {
      if (isShown(c)) return false
      const gain = gainOf(c)
      if (gain < minGain) return false
      const distinct = isDistinct(shapeOf(c), shown.map((s) => shapeOf(s.route)), cfg)
      return distinct || gain >= minGain * cfg.variantGainFactor
    })

  const lightCost = (c: ProfiledCandidate) => c.profile.lights + extraMin(c) / cfg.minutesPerLight
  const lightRanked = pool
    .filter((c) => withinCap(c, cfg.caps.fewestLights))
    .sort((a, b) => lightCost(a) - lightCost(b) || a.durationSec - b.durationSec)
  const lightsPick = pick(
    lightRanked,
    (c) => Math.min(...shown.map((s) => s.route.profile.lights)) - c.profile.lights,
    cfg.minLightGain,
  )
  if (lightsPick) shown.push({ route: lightsPick, addedFor: 'fewestLights' })
  else reasons.push(`No route within the lights cap avoids ${cfg.minLightGain}+ lights as a distinct route`)

  const calmUtility = (c: ProfiledCandidate) => c.profile.calmIndex - cfg.calmPointsPerMinute * extraMin(c)
  const calmRanked = pool
    .filter((c) => withinCap(c, cfg.caps.calm))
    .sort((a, b) => calmUtility(b) - calmUtility(a) || a.durationSec - b.durationSec)
  const calmPick = pick(
    calmRanked,
    (c) => c.profile.calmIndex - Math.max(...shown.map((s) => s.route.profile.calmIndex)),
    cfg.minCalmGain,
  )
  if (calmPick) shown.push({ route: calmPick, addedFor: 'calm' })
  else reasons.push(`No route within the calm cap is ${cfg.minCalmGain}+ points calmer as a distinct route`)

  // Re-assign roles by metric over the shown cards; prefer the card added for a role on ties.
  const prefer = (role: Category) => (a: (typeof shown)[number], b: (typeof shown)[number]) =>
    Number(b.addedFor === role) - Number(a.addedFor === role)
  const lightsWinner = shown
    .filter((s) => withinCap(s.route, cfg.caps.fewestLights))
    .sort((a, b) => a.route.profile.lights - b.route.profile.lights || prefer('fewestLights')(a, b))[0]
  const calmWinner = [...shown].sort(
    (a, b) => b.route.profile.calmIndex - a.route.profile.calmIndex || prefer('calm')(a, b),
  )[0]
  const winners: Record<Category, string> = {
    fastest: fastest.id,
    fewestLights: lightsWinner.route.id,
    calm: calmWinner.route.id,
  }

  const cards: RouteCard[] = []
  for (const s of shown) {
    const roles = CATEGORY_ORDER.filter((role) => winners[role] === s.route.id)
    if (roles.length === 0) {
      reasons.push(`Dropped the ${s.addedFor} card: another shown route beats it`)
      continue
    }
    const primary = roles.includes(s.addedFor) ? s.addedFor : roles[0]
    cards.push({
      routeId: s.route.id,
      primary,
      badges: roles.filter((r) => r !== primary),
      extraSec: s.route.durationSec - fastest.durationSec,
    })
  }
  cards.sort((a, b) => CATEGORY_ORDER.indexOf(a.primary) - CATEGORY_ORDER.indexOf(b.primary))

  return { cards, winners, reasons }
}
