// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG } from './config'
import { selectCards } from './select'
import { withProfile } from './testHelpers'

const cfg = DEFAULT_CONFIG
// 2 km eastward routes; "north" detours run 300 m north over x ∈ [400, 1600]
const STRAIGHT: Array<[number, number]> = [[0, 0], [2000, 0]]
const NORTH: Array<[number, number]> = [[0, 0], [400, 0], [400, 300], [1600, 300], [1600, 0], [2000, 0]]
const SOUTH: Array<[number, number]> = [[0, 0], [400, 0], [400, -300], [1600, -300], [1600, 0], [2000, 0]]
// differs from STRAIGHT for only ~200 m
const JOG: Array<[number, number]> = [[0, 0], [900, 0], [900, 60], [1000, 60], [1000, 0], [2000, 0]]

describe('selectCards', () => {
  it('throws on an empty pool', () => {
    expect(() => selectCards([], cfg)).toThrow('No candidate routes available')
  })

  it('shows one Fastest card carrying every badge when nothing else is better', () => {
    const fast = withProfile('fast', STRAIGHT, 600, { lights: 3, calmIndex: 80 })
    const slow = withProfile('slow', NORTH, 700, { lights: 3, calmIndex: 75 })
    const result = selectCards([fast, slow], cfg)
    expect(result.cards).toEqual([{ routeId: 'fast', primary: 'fastest', badges: ['fewestLights', 'calm'], extraSec: 0 }])
    expect(result.winners).toEqual({ fastest: 'fast', fewestLights: 'fast', calm: 'fast' })
  })

  it('adds a Fewest lights card for a distinct route saving two lights', () => {
    const fast = withProfile('fast', STRAIGHT, 600, { lights: 5, calmIndex: 60 })
    const lights = withProfile('lights', NORTH, 680, { lights: 2, calmIndex: 60 })
    const cards = selectCards([fast, lights], cfg).cards
    expect(cards.map((c) => [c.routeId, c.primary])).toEqual([['fast', 'fastest'], ['lights', 'fewestLights']])
    expect(cards[1].extraSec).toBe(80)
  })

  it('merges into a badge when only one light is saved', () => {
    const fast = withProfile('fast', STRAIGHT, 600, { lights: 5 })
    const other = withProfile('other', NORTH, 620, { lights: 4 })
    const result = selectCards([fast, other], cfg)
    expect(result.cards).toHaveLength(1)
    expect(result.winners.fewestLights).toBe('fast')
    expect(result.reasons.join(' ')).toMatch(/lights/)
  })

  it('ignores routes beyond the lights cap', () => {
    const fast = withProfile('fast', STRAIGHT, 1000, { lights: 6 })
    const slow = withProfile('slow', NORTH, 1400, { lights: 0 }) // cap = +300 s
    expect(selectCards([fast, slow], cfg).winners.fewestLights).toBe('fast')
  })

  it('suppresses a near-duplicate with an ordinary saving', () => {
    const fast = withProfile('fast', STRAIGHT, 600, { lights: 5 })
    const jog = withProfile('jog', JOG, 630, { lights: 3 })
    expect(selectCards([fast, jog], cfg).cards).toHaveLength(1)
  })

  it('allows a near-duplicate variant when the saving is large', () => {
    const fast = withProfile('fast', STRAIGHT, 600, { lights: 6 })
    const jog = withProfile('jog', JOG, 630, { lights: 3 }) // saves 3 ≥ 1.5 × 2
    expect(selectCards([fast, jog], cfg).winners.fewestLights).toBe('jog')
  })

  it('trades lights against extra minutes', () => {
    const fast = withProfile('fast', STRAIGHT, 600, { lights: 6 })
    const quick = withProfile('quick', NORTH, 660, { lights: 3 }) // cost 3 + 1 = 4
    const slow = withProfile('slow', SOUTH, 780, { lights: 2 }) // cost 2 + 3 = 5
    expect(selectCards([fast, quick, slow], cfg).winners.fewestLights).toBe('quick')
  })

  it('adds a Calm card for a distinct, clearly calmer route', () => {
    const fast = withProfile('fast', STRAIGHT, 600, { lights: 3, calmIndex: 40 })
    const calm = withProfile('calm', NORTH, 700, { lights: 3, calmIndex: 85 })
    const cards = selectCards([fast, calm], cfg).cards
    expect(cards.map((c) => [c.routeId, c.primary, c.badges])).toEqual([
      ['fast', 'fastest', ['fewestLights']],
      ['calm', 'calm', []],
    ])
  })

  it('moves the lights badge to the Calm card when it has even fewer lights, dropping the beaten card', () => {
    const fast = withProfile('fast', STRAIGHT, 600, { lights: 6, calmIndex: 40 })
    const lights = withProfile('lights', NORTH, 650, { lights: 3, calmIndex: 45 })
    // slower, so it ranks behind 'lights' on light cost (2 + 2.7 min vs 3 + 0.8 min)
    const calm = withProfile('calm', SOUTH, 760, { lights: 2, calmIndex: 90 })
    const result = selectCards([fast, lights, calm], cfg)
    expect(result.winners).toEqual({ fastest: 'fast', fewestLights: 'calm', calm: 'calm' })
    expect(result.cards.map((c) => [c.routeId, c.primary, c.badges])).toEqual([
      ['fast', 'fastest', []],
      ['calm', 'calm', ['fewestLights']],
    ])
  })

  it('never shows two cards for near-identical routes', () => {
    const fast = withProfile('fast', STRAIGHT, 600, { lights: 5, calmIndex: 40 })
    const jog = withProfile('jog', JOG, 610, { lights: 4, calmIndex: 52 }) // +12: a gain, not a variant
    expect(selectCards([fast, jog], cfg).cards).toHaveLength(1)
  })

  it('is deterministic regardless of pool order', () => {
    const pool = [
      withProfile('fast', STRAIGHT, 600, { lights: 6, calmIndex: 40 }),
      withProfile('north', NORTH, 650, { lights: 3, calmIndex: 60 }),
      withProfile('south', SOUTH, 700, { lights: 4, calmIndex: 90 }),
    ]
    expect(selectCards([...pool].reverse(), cfg)).toEqual(selectCards(pool, cfg))
  })
})
