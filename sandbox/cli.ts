/**
 * Calibration sandbox. Usage: npm run sandbox -- <step> [odId…]
 *
 *   generate   tens of candidates per trip (OTP calls cached in sandbox/.cache/otp)
 *   evaluate   legacy vs production vs full-pool cards → sandbox/out/eval.json + report.html
 *   dossiers   per-trip grading dossiers (sandbox/out/dossiers) + review-page data
 *   fit        calibrate parameters from labels → sandbox/out/fit-<user|claude>.json
 *   yield      quality vs OTP calls per search for generator subsets
 *
 * See docs/routing-overhaul-todo.md for how the steps fit together.
 */
import { loadOdPairs } from './lib/env'
import { buildDossiers } from './lib/dossiers'
import { evaluateAll, summarise, writeReport } from './lib/evaluate'
import { fitAll } from './lib/fit'
import { generateAll } from './lib/generate'
import { generatorYield } from './lib/yield'

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
  case 'yield': {
    const { curve, reference } = await generatorYield(ods)
    console.table(curve)
    console.log(reference)
    break
  }
  case 'fit': {
    // npm run sandbox -- fit [claude]   (default: the user's labels)
    const source = ids.includes('claude') ? 'claude' : 'user'
    const result = await fitAll(all, source)
    console.log(JSON.stringify(result, null, 2))
    break
  }
  default:
    console.error(`Unknown step "${step ?? ''}". See sandbox/cli.ts for the list.`)
    process.exit(1)
}
