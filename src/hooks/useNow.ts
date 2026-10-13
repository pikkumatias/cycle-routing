import { useEffect, useState } from 'react'

/** The current time, updated as each minute starts (for arrival times). */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const msToNextMinute = 60_000 - (Date.now() % 60_000)
      timer = setTimeout(() => {
        setNow(new Date())
        schedule()
      }, msToNextMinute)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])
  return now
}
