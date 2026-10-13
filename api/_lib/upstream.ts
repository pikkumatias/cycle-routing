// Shared by the Digitransit proxies. The `_` prefix keeps Vercel from deploying this as a function.

export interface VercelReq {
  method?: string
  query: Record<string, string | string[] | undefined>
}
export interface VercelRes {
  setHeader(name: string, value: string): void
  status(code: number): VercelRes
  json(data: unknown): VercelRes
}

export const UPSTREAM_TIMEOUT_MS = 8000

export function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** A finite number parsed from a query value within [min, max], else undefined. */
export function numberParam(value: string | string[] | undefined, min: number, max: number): number | undefined {
  const raw = firstValue(value)?.trim()
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined
}

type UpstreamFailure = { status: 502 | 504; body: { error: string; code: 'UPSTREAM_UNAVAILABLE' | 'TIMEOUT' } }

/**
 * Fetch JSON from Digitransit with a timeout. Upstream failures are logged and become a
 * 502 (or 504 on timeout) without the upstream body: a bad key or an outage is our problem,
 * not the caller's, and its details belong in the logs.
 */
export async function fetchUpstream(
  label: string,
  url: string,
  init: RequestInit,
): Promise<{ data: unknown } | UpstreamFailure> {
  let upstream: Response
  try {
    upstream = await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      console.error(`[${label}] upstream timed out`)
      return { status: 504, body: { error: `${label} timed out.`, code: 'TIMEOUT' } }
    }
    console.error(`[${label}] upstream unreachable`, error)
    return { status: 502, body: { error: `${label} is unavailable.`, code: 'UPSTREAM_UNAVAILABLE' } }
  }
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    console.error(`[${label}] upstream ${upstream.status}`, text.slice(0, 500))
    return { status: 502, body: { error: `${label} is unavailable.`, code: 'UPSTREAM_UNAVAILABLE' } }
  }
  return { data: (await upstream.json()) as unknown }
}
