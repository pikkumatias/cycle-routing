/**
 * Helsinki's winter maintenance season, roughly: 15 October to 15 April. Priority winter
 * routes only mean something then, so the app mentions them only in this window.
 */
export function isWinterSeason(date: Date): boolean {
  const month = date.getMonth() // 0 = January
  const day = date.getDate()
  if (month >= 10 || month <= 2) return true // November–March
  if (month === 9) return day >= 15 // October
  if (month === 3) return day <= 15 // April
  return false
}
