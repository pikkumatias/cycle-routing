import type { CalmBand } from '../api/routePlan'

/** Fill colour per calm band, from the --calm-* tokens. */
export const CALM_BAND_CLASS: Record<CalmBand, string> = {
  veryCalm: 'bg-calm-very-calm',
  calm: 'bg-calm-calm',
  mixed: 'bg-calm-mixed',
  busy: 'bg-calm-busy',
}
