import type { RoutingConfig } from './config.js'
import { nearestOnPolyline, resample } from './geo.js'
import type { Layers } from './layers.js'
import type { MajorCrossing, RouteSegment } from './stress.js'
import type { LatLng, SignalRule, SignalStop } from './types.js'

const RULE_PRIORITY: Record<SignalRule, number> = { on: 0, cross: 1, near: 2 }

/**
 * Traffic-signal stops along a route. A signal node is a hit when
 * - `on`: it lies within `onM` of the full-resolution route (the route passes through it);
 * - `cross`: the route crosses a major road at grade next to one of that road's signals
 *   (catches crossings whose own node is untagged);
 * - `near`: it lies within `nearM` of a stretch where the route crosses an open area —
 *   OTP draws straight lines across squares, so the crossing nodes sit off the line.
 * Nothing counts while the route is on a bridge or in a tunnel.
 * Hits are sorted by distance travelled and grouped so that each group spans at most
 * `windowM` from its first hit; every group is one stop. A junction has a node per crossing
 * arm, so this is what turns nodes into stops.
 */
export function findSignalStops(
  poly: LatLng[],
  cum: number[],
  segments: RouteSegment[],
  crossings: MajorCrossing[],
  layers: Layers,
  cfg: RoutingConfig,
): SignalStop[] {
  const { onM, nearM, windowM } = cfg.signals
  const searchM = Math.max(onM, nearM)
  const hits: SignalStop[] = []

  const candidates = new Set<LatLng>()
  const SAMPLE_M = 40
  for (const p of resample(poly, SAMPLE_M)) {
    for (const s of layers.signals.near(p, SAMPLE_M + searchM)) candidates.add(s)
  }

  const covering = (alongM: number, padM: number) =>
    segments.filter((s) => alongM >= s.startM - padM && alongM <= s.startM + s.lengthM + padM)
  const inArea = (alongM: number) => covering(alongM, nearM).some((s) => s.step?.area)
  const aboveGround = (alongM: number) => covering(alongM, 0).some((s) => s.gradeSeparated)

  for (const s of candidates) {
    const hit = nearestOnPolyline(s, poly, cum)
    if (aboveGround(hit.alongM)) continue
    if (hit.distanceM <= onM) hits.push({ at: s, alongM: hit.alongM, rule: 'on' })
    else if (hit.distanceM <= nearM && inArea(hit.alongM)) hits.push({ at: s, alongM: hit.alongM, rule: 'near' })
  }
  for (const c of crossings) {
    if (c.signal) hits.push({ at: c.signal, alongM: c.alongM, rule: 'cross' })
  }

  hits.sort((x, y) => x.alongM - y.alongM)
  const groups: SignalStop[][] = []
  let groupStart = -Infinity
  for (const h of hits) {
    if (h.alongM - groupStart > windowM) {
      groups.push([h])
      groupStart = h.alongM
    } else {
      groups[groups.length - 1].push(h)
    }
  }

  return groups.map((g) => ({
    at: [g.reduce((sum, h) => sum + h.at[0], 0) / g.length, g.reduce((sum, h) => sum + h.at[1], 0) / g.length],
    alongM: g[0].alongM,
    rule: g.reduce((best, h) => (RULE_PRIORITY[h.rule] < RULE_PRIORITY[best] ? h.rule : best), g[0].rule),
  }))
}
