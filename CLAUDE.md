# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start Vite dev server (localhost:5173)
- `npm run build` — Type-check with `tsc -b` then build with Vite
- `npm run lint` — ESLint (flat config, TS/TSX only)
- `npm test` — Run all tests with Vitest (jsdom environment, globals enabled)
- `npx vitest run src/utils/scenicScore.test.ts` — Run a single test file
- `npm run route` — CLI script to query Digitransit routing API interactively
- `npm run benchmark` — CLI script to benchmark route scoring performance

## Environment Variables

- `DIGITRANSIT_API_KEY` — Server-side API key (used by `api/` serverless functions), set in `.env.local`
- `VITE_DIGITRANSIT_API_KEY` — Client-side key exposed to browser (for map tiles), set in `.env.local`

## Architecture

### Frontend (React + Vite + TypeScript)

The app is a bicycle route planner for the Helsinki region. The user enters origin/destination addresses, and the app shows three route variants on a Leaflet map: **Fastest**, **Scenic**, and **Calm**.

**Routing flow** (`src/App.tsx`):
1. User selects addresses via geocoding autocomplete (`SearchDrawer` → `/api/digitransit-geocode`)
2. On submit, two parallel fetches fire:
   - `fetchCandidateRoutes` — calls `api/digitransit-route-batch` with 5 OTP triangle presets, each requesting 2 itineraries → up to 10 candidate routes
   - `fetchPoisAndInfrastructure` — single combined Overpass API query for scenic POIs + cycling infrastructure in an estimated bbox (results cached in-memory by quantized bbox)
3. `deduplicateRoutes` removes near-identical candidates (>85% bidirectional polyline overlap)
4. `selectRoutes` scores all candidates and picks the best per category:
   - **Fastest**: lowest duration
   - **Scenic**: highest scenic POI score (parks, nature, water)
   - **Calm**: highest cycling infrastructure score (cycleways, bike lanes)

**Triangle presets** (5 OTP optimization factors):
1. `{ time: 1, safety: 0, slope: 0 }` — fastest
2. `{ time: 0, safety: 1, slope: 0 }` — best infrastructure
3. `{ time: 0, safety: 0, slope: 1 }` — flattest
4. `{ time: 0.33, safety: 0.34, slope: 0.33 }` — balanced
5. `{ time: 0.1, safety: 0.6, slope: 0.3 }` — safe + flat hybrid

### Scoring System (`src/utils/scenicScore.ts`, `src/utils/overpass.ts`)

Two independent scores computed from OSM data within 150m of the route polyline:
- **Scenic score**: weighted sum of nature/green POIs (nature reserves=4, parks=3, water=2, etc.)
- **Infrastructure score**: weighted sum of cycling infra (separated cycleways=4, designated paths=2, painted lanes=1)
- **Calm score**: `0.5 * normalized_scenic + 0.5 * normalized_infra`, scaled 0-100

See `SCORING.md` for full weight tables and formulas.

### Backend Proxy (`api/`)

Vercel-style serverless functions that proxy Digitransit API calls to keep the API key server-side:
- `api/digitransit-route.ts` — POST, forwards a single routing request with triangle optimization factors
- `api/digitransit-route-batch.ts` — POST, accepts an array of presets and runs them in parallel via `Promise.allSettled`
- `api/digitransit-geocode.ts` — GET, forwards geocoding autocomplete requests

### Key Modules

- `src/api/digitransit.ts` — Client-side API layer: `fetchCandidateRoutes`, `fetchGeocodingAutocomplete`, route cache, triangle presets, OTP types
- `src/utils/routeGeometry.ts` — Polyline decoding (`@mapbox/polyline`), bbox estimation, bounds calculation
- `src/utils/routeSelection.ts` — Route deduplication (polyline overlap) and per-category selection
- `src/utils/overpass.ts` — Combined Overpass QL query builder, POI classification by OSM tags, in-memory bbox cache
- `src/utils/scenicScore.ts` — Haversine distance, polyline sampling, per-route scoring, cross-route normalization
- `src/utils/recentSearches.ts` — localStorage-backed recent search history (max 10 entries)
- `src/components/RouteMap.tsx` — Leaflet map with HSL tiles (CacheStorage + 3× retry), route polylines, origin/destination markers, click-to-select alternatives
- `src/components/RouteCards.tsx` — Route variant selector cards showing duration, distance, calm score, and infra badge; includes `RouteCardsSkeleton`
- `src/components/SearchDrawer.tsx` — Right-side drawer with debounced autocomplete (300ms), recent searches, coordinate input support
- `src/components/AddressTrigger.tsx` — Tap target button that opens the search drawer
- `src/hooks/useBottomSheet.ts` — Touch/mouse-draggable bottom sheet with three snap points and velocity-based snapping

### UI

Uses MUI (Material UI) v7 components and MUI Icons. Map tiles from Digitransit CDN (HSL map). Bottom sheet snaps to collapsed (30%), expanded, and full-screen positions.
