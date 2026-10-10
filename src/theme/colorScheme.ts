import { useSyncExternalStore } from 'react'
import { toRgba } from '@/lib/color'

/**
 * Light/dark theme. The preference is `system` (default), `light` or `dark`,
 * persisted in localStorage. The resolved scheme is applied as the `dark` class
 * on <html> before listeners are notified, so components reading CSS variables
 * during render (the map palette) already see the new values.
 *
 * `index.html` runs the same resolution inline before first paint.
 */
export type ThemePreference = 'system' | 'light' | 'dark'
export type ColorScheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'cycle-routing:theme'

const listeners = new Set<() => void>()
const media =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Storage blocked: fall through to system.
  }
  return 'system'
}

let preference: ThemePreference = readPreference()

export function resolveScheme(pref: ThemePreference, systemDark: boolean): ColorScheme {
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

function currentScheme(): ColorScheme {
  return resolveScheme(preference, media?.matches ?? false)
}

function apply() {
  if (typeof document === 'undefined') return
  const scheme = currentScheme()
  const root = document.documentElement
  root.classList.toggle('dark', scheme === 'dark')
  root.style.colorScheme = scheme
  const meta = document.querySelector('meta[name="theme-color"]')
  const bg = getComputedStyle(root).getPropertyValue('--background').trim()
  if (meta && bg) meta.setAttribute('content', toRgba(bg))
}

function emit() {
  apply()
  for (const l of listeners) l()
}

media?.addEventListener('change', () => {
  if (preference === 'system') emit()
})

export function setThemePreference(next: ThemePreference) {
  preference = next
  try {
    if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    // Not persisted; still applies for this session.
  }
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => `${preference}:${currentScheme()}`

/** The stored preference and the scheme actually in effect. */
export function useColorScheme(): { preference: ThemePreference; scheme: ColorScheme } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [pref, scheme] = snapshot.split(':') as [ThemePreference, ColorScheme]
  return { preference: pref, scheme }
}

apply()
