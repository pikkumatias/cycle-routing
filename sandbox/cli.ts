/**
 * Calibration sandbox. Usage: npm run sandbox -- <step> [odId…]
 *
 *   generate   tens of candidates per trip (OTP calls cached in sandbox/.cache/otp)
 *   evaluate   legacy vs production vs full-pool cards → sandbox/out/eval.json + report.html
 *   dossiers   per-trip grading dossiers (sandbox/out/dossiers) + review-page data
 *   fit        calibrate parameters from labels → sandbox/out/fit.json
 *   yield      quality vs OTP calls per search for generator subsets
 *
 * See docs/routing-overhaul-todo.md for how the steps fit together.
 */
import { loadOdPairs } from './lib/env'
import { buildDossiers } from './lib/dossiers'
import { evaluateAll, summarise, writeReport } from './lib/evaluate'
import { generateAll } from './lib/generate'

const [step, ...ids] = process.argv.slice(2)
const all = await loadOdPairs()
const ods = ids.length > 0 ? all.filter((o) => ids.includes(o.id)) : all

switch (step) {
  case 'generate':
    await generateAll(ods)
    break
  case 'evaluate': {
    const results = await evaluateAll(ods)
    await writeReport(results)
    console.log(JSON.stringify(summarise(results), null, 2))
    break
  }
  case 'dossiers':
    await buildDossiers(ods)
    break
  default:
    console.error(`Unknown step "${step ?? ''}". See sandbox/cli.ts for the list.`)
    process.exit(1)
}
