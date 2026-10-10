# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start Vite dev server (localhost:5173)
- `npm run build` — Type-check with `tsc -b` then build with Vite
- `npm run lint` — ESLint (flat config, TS/TSX only)
- `npm test` — Run all tests with Vitest (jsdom environment, globals enabled)
- `npx vitest run src/routing/profile.test.ts` — Run a single test file
- `npm run route` — CLI script to query Digitransit routing API interactively
- `npm run data:osm` — Rebuild `data/osm-layers.json` from Overpass (cached in `.cache/osm/`; `-- --refresh` to refetch)

## Environment Variables

- `DIGITRANSIT_API_KEY` — Server-side API key (used by `api/` serverless functions), set in `.env.local`
- `VITE_DIGITRANSIT_API_KEY` — Only for the dev-only sandbox review page (HSL raster tiles), set in `.env.local`. The app itself needs no client-side key (OpenFreeMap vector tiles)

## Architecture

### Frontend (React + Vite + TypeScript)

The app is a bicycle route planner for the Helsinki region. The user picks a start and destination and the app shows up to three route options over a MapLibre map: **Fastest**, **Fewest lights** and **Calm**. A route that wins several categories is shown once with badges.

**Routing flow** (`src/App.tsx`):
1. User picks places via geocoding autocomplete (`SearchPanel` → `/api/digitransit-geocode`), typed coordinates, their location, or a long-press/right-click on the map (`MapContextMenu`)
2. Once both ends are set, `fetchRoutePlan` (`src/api/routePlan.ts`) POSTs `{from, to}` to `/api/route-plan`
3. The server runs the routing engine (`src/routing/planRoutes.ts`): OTP candidates (presets, then via-waypoint detours), measured against the prebuilt OSM layers, and `selectCards` picks the cards
4. The client draws the shown routes, selects the card holding Fewest lights, and fetches roadworks (`useRoadworks`, from `src/services/hazards.ts`) and city bikes for display

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
- `src/components/RouteMap.tsx` — MapLibre map (`react-map-gl/maplibre`): routes, tappable route-time labels, signal stops, city bikes, roadworks, pins, locate button; the sheet/panel footprint is the map's persistent padding
- `src/map/` — `mapStyle.ts` (OpenFreeMap basemap, cycleways emphasised, labels in the app language), `palette.ts` (reads colours from CSS tokens), `features.ts` (GeoJSON builders), `routeProgress.ts`, `worker.ts` (MapLibre worker URL for Vite)
- `src/components/RouteOptions.tsx`, `RouteRibbon.tsx` — route rows as a radio group; the ribbon's length is the ride time, its colour the calm band, and its pips the traffic lights along the route
- `src/components/TripPlanner.tsx`, `SearchPanel.tsx` — start/destination with swap; full-screen cmdk search with recents, coordinates and your location
- `src/components/OptionsMenu.tsx` — map layers (city bikes, roadworks), language, appearance (auto/light/dark)
- `src/hooks/useBottomSheet.ts` — draggable sheet: collapsed (to the trip planner), expanded (fits content), full; disabled at ≥768px where it is a side panel
- `src/services/hazards.ts`, `src/services/citybikes.ts` — display-only overlays

### UI

Tailwind CSS v4 + shadcn/ui (Radix, `src/components/ui/`, generated) + lucide icons, font Geist: the stock shadcn neutral (black and white) look. **All colours are tokens in `src/styles/theme.css`**: shadcn's standard variables (paste a theme from ui.shadcn.com/themes over them), plus the data colours (traffic lights, calm bands, city bikes, roadworks) and the greyscale map. The map reads the same tokens (any CSS colour, converted by `src/lib/color.ts`). Light/dark follows the system unless set in the options menu (`src/theme/colorScheme.ts`). `@/` aliases `src/`. Copy is in `src/locales/{en,fi}.json`.
