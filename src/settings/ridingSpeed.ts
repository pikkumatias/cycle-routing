import { useSyncExternalStore } from 'react'

/** How fast the rider goes; routes and their times are planned for it. Persisted in localStorage. */
export type RidingSpeed = 'relaxed' | 'normal' | 'fast'

/** Cruising speed of each choice; `normal` is OTP's default. */
export const RIDING_SPEED_KMH: Record<RidingSpeed, number> = { relaxed: 15, normal: 20, fast: 25 }

const STORAGE_KEY = 'cycle-routing:speed'
const listeners = new Set<() => void>()

function read(): RidingSpeed {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'relaxed' || stored === 'fast') return stored
  } catch {
    // Storage blocked: the default
  }
  return 'normal'
}

let speed: RidingSpeed = read()

export const getRidingSpeed = () => speed

export function setRidingSpeed(next: RidingSpeed) {
  speed = next
  try {
    if (next === 'normal') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Not persisted; still applies for this session
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useRidingSpeed(): RidingSpeed {
  return useSyncExternalStore(subscribe, getRidingSpeed, getRidingSpeed)
}
