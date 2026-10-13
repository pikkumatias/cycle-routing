import { describe, it, expect } from 'vitest'
import en from './en.json'
import fi from './fi.json'
import type { PlanFailure } from '../api/routePlan'

/** Dotted paths of every string in a nested locale object. */
function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

const FAILURES: Record<PlanFailure, true> = {
  BAD_REQUEST: true,
  OUT_OF_AREA: true,
  TOO_SHORT: true,
  TOO_LONG: true,
  NO_ROUTE: true,
  UPSTREAM_UNAVAILABLE: true,
  TIMEOUT: true,
  SERVER_ERROR: true,
  NETWORK: true,
  OFFLINE: true,
}

describe('locales', () => {
  it('have the same keys in English and Finnish', () => {
    expect(keys(fi).sort()).toEqual(keys(en).sort())
  })

  it('have a message for every route planning failure', () => {
    for (const code of Object.keys(FAILURES)) {
      expect(en.planErrors).toHaveProperty(code)
      expect(fi.planErrors).toHaveProperty(code)
    }
  })
})
