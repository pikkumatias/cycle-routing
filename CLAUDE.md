# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start Vite dev server (localhost:5173)
- `npm run build` — Type-check with `tsc -b` then build with Vite
- `npm run lint` — ESLint (flat config, TS/TSX only)
- `npm test` — Run all tests with Vitest (jsdom environment, globals enabled)
- `npx vitest run src/routing/profile.test.ts` — Run a single test file
- `npm run route` — CLI script to query Digitransit routing API interactively
- `npm run data:osm` — Rebuild `data/osm-layers.json` from BBBike's Helsinki extract (cached in `.cache/osm/`; `-- --refresh` to re-download, `-- --source=overpass` for Overpass)
- `npm run sandbox -- <generate|evaluate|dossiers|yield|fit>` — Calibration sandbox (see `sandbox/README.md`); review page at `/sandbox/review/` under `npm run dev`

## Environment Variables

- `DIGITRANSIT_API_KEY` — Server-side API key (used by `api/` serverless functions), set in `.env.local`
- `VITE_DIGITRANSIT_API_KEY` — Client-side key exposed to browser (for map tiles), set in `.env.local`

## Architecture

### Frontend (React + Vite + TypeScript)

The app is a bicycle route planner for the Helsinki region. The user enters origin/destination addresses and the app shows up to three route cards on a Leaflet map: **Fastest**, **Fewest lights** and **Calm**. A route that wins several categories is shown once with badges.

**Routing flow** (`src/App.tsx`):
1. User selects addresses via geocoding autocomplete (`SearchDrawer` → `/api/digitransit-geocode`)
2. On submit, `fetchRoutePlan` (`src/api/routePlan.ts`) POSTs `{from, to}` to `/api/route-plan`
3. The server runs the routing engine (`src/routing/planRoutes.ts`): OTP candidates (presets, then via-waypoint detours), measured against the prebuilt OSM layers, and `selectCards` picks the cards
4. The client draws the shown routes, selects the card holding Fewest lights, and fetches hazards/city bikes for display

See `SCORING.md` for generators, light counting, traffic stress / calm index and selection rules.

### Routing engine (`src/routing/`)

Pure TypeScript — no DOM or Node APIs — so the endpoint, the calibration sandbox and tests share it. It is type-checked under both `tsconfig.app.json` (no Node types) and `tsconfig.api.json` (no DOM). Imports inside it use `.js` specifiers for Node ESM on Vercel. All tunables live in `config.ts`.

- `otpClient.ts` — Digitransit `planConnection` (direct bicycle, optional via point, steps)
- `generators.ts`, `spur.ts` — round-2 via waypoints snapped to the calm network; out-and-back stub trimming
- `signals.ts`, `stress.ts`, `profile.ts` — signal stops, per-segment traffic stress, absolute calm index
- `similarity.ts`, `select.ts` — distinctness and card selection with badges
- `layers.ts` — format and spatial index of `data/osm-layers.json`
- `testHelpers.ts` — synthetic geometry/layers for unit tests

### Backend (`api/`)

Vercel functions (pinned to `arn1` in `vercel.json`):
- `api/route-plan.ts` — POST, validates the trip, runs `planRoutes()` with layers from `data/osm-layers.json` (shipped via `includeFiles`), returns only the routes shown on cards
- `api/digitransit-geocode.ts`, `api/digitransit-reverse-geocode.ts` — GET geocoding proxies
- `api/citybike-stations.ts` — GET city bike stations

Every file in `api/` deploys as a function; `.vercelignore` keeps `*.test.ts` out.

### Offline tooling

- `scripts/build-osm-layers.ts` — builds the OSM layer file
- `sandbox/` — calibration sandbox (Node, `vite-node`); `sandbox/lib/legacy/` is the frozen pre-overhaul grading used as a baseline. `scripts/` and `sandbox/` are type-checked by `tsconfig.sandbox.json` and excluded from Vitest.

### Key Modules

- `src/api/routePlan.ts` — `fetchRoutePlan`, plan cache, `defaultCard`
- `src/api/digitransit.ts` — `parseLatLon`, geocoding autocomplete and reverse geocoding
- `src/utils/routeGeometry.ts` — polyline decoding, display smoothing, bounds
- `src/utils/recentSearches.ts` — localStorage-backed recent search history (max 10 entries)
- `src/components/RouteMap.tsx` — Leaflet map with HSL tiles (CacheStorage + 3× retry), route polylines by id, signal-stop markers, origin/destination markers, click-to-select alternatives
- `src/components/RouteCards.tsx` — cards with title, badges and metric row (time, distance, +min, lights, calm band); includes `RouteCardsSkeleton`
- `src/components/SearchDrawer.tsx` — Right-side drawer with debounced autocomplete (300ms), recent searches, coordinate input support
- `src/components/AddressTrigger.tsx` — Tap target button that opens the search drawer
- `src/hooks/useBottomSheet.ts` — Touch/mouse-draggable bottom sheet with three snap points and velocity-based snapping
- `src/services/hazards.ts`, `src/services/citybikes.ts` — display-only overlays

### UI

Uses MUI (Material UI) v7 components and MUI Icons. Map tiles from Digitransit CDN (HSL map). Bottom sheet snaps to collapsed (30%), expanded, and full-screen positions.
