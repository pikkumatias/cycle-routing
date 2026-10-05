# Routing overhaul — TODO

Tracks the staged rework of route generation, grading and selection.
Each phase lands as its own PR (stacked on the previous phase's branch).

Goal: trustworthy measurements, at most three genuinely different cards
(Fastest, Fewest lights, Calm), weights calibrated in an offline sandbox.

## Phase 0 — fix today's app (`routing/phase-0-fixes`)
- [x] Exclude `.claude/**` and `sandbox/**` from Vitest
- [x] Overpass: also fetch `crossing=traffic_signals` nodes; drop blinker/emergency/ramp-meter signals
- [x] Overpass cache: round the bbox outward and fetch the rounded box, so a cached box always contains the request
- [x] Light counting: full-resolution polyline, 12 m hit distance, one light per 40 m along-route window
- [x] OSM bbox: equal padding in metres on both axes, max(1 km, 25 % of trip)
- [x] Fewest lights: within +30 % (≥ +4 min) of Fastest and saves ≥ 2 lights, otherwise merges into Fastest
- [x] UI: merged Fewest lights selects Fastest with an "also fewest lights" badge; light count on every card
- [x] UI: "more options" shows Calm only and never replaces the main cards; Scenic dropped

## Phase 1 — engine and data (`routing/phase-1-engine`)
- [ ] `src/routing/` pure engine: types, config, geo, layers, signals, stress, profile, similarity, spur, otpClient, generators, select, planRoutes
- [ ] Unit tests per module
- [ ] Repoint `hazards.ts` / `citybikes.ts` to `routing/geo`
- [ ] Type-check `src/routing` without DOM (tsconfig.api.json) and without Node (tsconfig.app.json)
- [ ] `scripts/build-osm-layers.ts` → `data/osm-layers.json` + `data/meta.json` (`npm run data:osm`)
- [ ] Freeze today's selection as `sandbox/lib/legacy.ts` baseline

## Phase 2 — server pipeline and new UI (`routing/phase-2-server`)
- [ ] `api/route-plan.ts` running `planRoutes()` (validation, deadline, partial results)
- [ ] Pin functions to a Nordic region (`vercel.json`), include the layer data
- [ ] Client `src/api/routePlan.ts`; App state `{plan, selectedId}`
- [ ] RouteCards: cards + badges + metric row (min · km · lights · calm band · +N min)
- [ ] RouteMap: routes by id; light markers = counted signal stops
- [ ] Locales: drop scenic/paths/moreOptions/scoringUnavailable; add badges and bands
- [ ] Delete legacy scoring, Overpass client/proxy, batch/single route endpoints, benchmark duplicates
- [ ] Rewrite SCORING.md; update CLAUDE.md and README

## Phase 3 — sandbox and calibration (`routing/phase-3-sandbox`)
- [ ] `sandbox/cli.ts` steps: generate, reference, baseline, select, dossiers, fit, yield, report, fixtures
- [ ] OD corpus (~40 public pairs; private pairs gitignored)
- [ ] Rubric v0 + prior weights → **user approval**
- [ ] Claude pre-grading (dossiers never show the model's calmIndex)
- [ ] Review page `/sandbox/review/` + dev-only label middleware → **user review session**
- [ ] Fit weights/thresholds; generator yield curve → **user picks API budget**

## Phase 4 — lock in
- [ ] Fitted config + `configVersion` bump; round-2 generators at chosen budget
- [ ] Fixture invariant tests from recorded public ODs
- [ ] Final before/after report on held-out ODs
