export type RecentSearch = {
  label: string
  lat: number
  lon: number
}

const STORAGE_KEY = 'cycle-routing:recent-searches'
const MAX_ENTRIES = 10

export function getRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ENTRIES) : []
  } catch {
    return []
  }
}

export function addRecentSearch(entry: RecentSearch): void {
  const current = getRecentSearches()
  const filtered = current.filter((s) => s.label !== entry.label)
  const updated = [entry, ...filtered].slice(0, MAX_ENTRIES)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch {
    // localStorage full or disabled
  }
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
