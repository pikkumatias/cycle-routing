# Calibration sandbox

Generates tens of candidate routes per trip, grades them, and calibrates the routing
engine's priors (`src/routing/config.ts`) against those grades. It runs the real engine
(`src/routing/`) — nothing is duplicated — with every OTP response cached on disk.

```bash
npm run sandbox -- generate [odId…]   # ~40 OTP requests per trip, cached in sandbox/.cache/otp
npm run sandbox -- evaluate [odId…]   # legacy vs new cards → sandbox/out/report.html, eval.json
npm run sandbox -- dossiers [odId…]   # grading material → sandbox/out/dossiers, review data
npm run sandbox -- yield              # quality vs OTP calls per search → sandbox/out/yield.json
npm run sandbox -- fit [claude]       # calibrate from user (default) or Claude labels → sandbox/out/fit-*.json
```

`generate` needs `DIGITRANSIT_API_KEY` in `.env.local` and the layer file
(`npm run data:osm`). Everything else works offline from the cache.

## Files

| Path | What | In git |
| ---- | ---- | ------ |
| `od-pairs.json` | 45-trip public corpus (short / medium / long, varied terrain) | yes |
| `od-pairs.private.json` | your own trips (same shape) — never committed or made into fixtures | no |
| `rubric.md` | grading rubric | yes |
| `labels/claude/` | Claude's pre-grades (from dossiers only, never the model's scores) | yes |
| `labels/user/` | your reviewed labels, written by the review page | yes |
| `lib/legacy/` | frozen pre-overhaul grading (commit `c197bee`) for the baseline | yes |
| `.cache/`, `out/` | OTP cache, pools, report, dossiers | no |

## Review session (≈45–60 min, can be split)

1. Read and adjust `rubric.md` — it defines what "calm" and a worthwhile detour mean.
2. `npm run dev`, open <http://localhost:5173/sandbox/review/>.
3. Answer the ten trade-off questions on the index page once (they set how many minutes a
   light or a calmer route is worth).
4. Review trips — aim for 30 or more. For each trip:
   - reorder the calm ranking (best first); click a row to see the route and its counted
     light stops on the map;
   - correct "real lights" where the count is wrong (this is the light-counting ground
     truth — Claude cannot see the street);
   - confirm or untick the "same route" pairs;
   - set which route should get the Fewest lights / Calm card (or none);
   - optionally rate a few routes 1–5 for calm (anchors the bands);
   - pick which card set you would rather get (legacy vs new, shown blind as Option 1/2).
   About 30 % of trips are blind: Claude's grades appear only after you save, so its
   influence on your answers can be measured.
5. `npm run sandbox -- fit` proposes calibrated values; they go into `config.ts` in Phase 4.
