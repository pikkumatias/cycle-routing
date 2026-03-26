# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start Vite dev server (localhost:5173)
- `npm run build` — Type-check with `tsc -b` then build with Vite
- `npm run lint` — ESLint (flat config, TS/TSX only)
- `npm test` — Run all tests with Vitest (jsdom environment, globals enabled)
- `npx vitest run src/utils/scenicScore.test.ts` — Run a single test file
- `npm run route` — CLI script to query Digitransit routing API interactively

## Environment Variables

- `DIGITRANSIT_API_KEY` — Server-side API key (used by `api/` serverless functions), set in `.env.local`
- `VITE_DIGITRANSIT_API_KEY` — Client-side key exposed to browser (for map tiles), set in `.env.local`

## Architecture

### Frontend (React + Vite + TypeScript)

The app is a bicycle route planner for the Helsinki region. The user enters origin/destination addresses, and the app shows three route variants on a Leaflet map: **Fastest**, **Scenic**, and **Calm**.

**Routing flow** (`src/App.tsx`):
1. User selects addresses via geocoding autocomplete (`SearchDrawer` → `/api/digitransit-geocode`)
2. On submit, two parallel fetches fire:
   - `fetchCandidateRoutes` — calls `api/digitransit-route` with 2 OTP triangle presets (speed-optimized and infra-optimized), each requesting 3 itineraries → up to 6 candidate routes
   - `fetchPoisAndInfrastructure` — Overpass API query for scenic POIs + cycling infrastructure in an estimated bbox
3. `deduplicateRoutes` removes near-identical candidates (>85% bidirectional polyline overlap)
4. `selectRoutes` scores all candidates and picks the best per category:
   - **Fastest**: lowest duration
   - **Scenic**: highest scenic POI score (parks, nature, water)
   - **Calm**: highest cycling infrastructure score (cycleways, bike lanes)

### Scoring System (`src/utils/scenicScore.ts`, `src/utils/overpass.ts`)

Two independent scores computed from OSM data within 150m of the route polyline:
- **Scenic score**: weighted sum of nature/green POIs (nature reserves=4, parks=3, water=2, etc.)
- **Infrastructure score**: weighted sum of cycling infra (separated cycleways=4, designated paths=2, painted lanes=1)
- **Calm score**: `0.5 * normalized_scenic + 0.5 * normalized_infra`, scaled 0-100

See `SCORING.md` for full weight tables and formulas.

### Backend Proxy (`api/`)

Vercel-style serverless functions that proxy Digitransit API calls to keep the API key server-side:
- `api/digitransit-route.ts` — POST, forwards routing requests with triangle optimization factors
- `api/digitransit-geocode.ts` — GET, forwards geocoding autocomplete requests

### Key Modules

- `src/utils/routeGeometry.ts` — Polyline decoding (`@mapbox/polyline`), bbox estimation, bounds calculation
- `src/utils/routeSelection.ts` — Route deduplication (polyline overlap) and per-category selection
- `src/utils/overpass.ts` — Overpass QL query builder, POI classification by OSM tags
- `src/components/RouteMap.tsx` — Leaflet map with HSL tiles, route polylines, origin/destination markers
- `src/components/RouteCards.tsx` — Route variant selector cards showing duration, distance, and scores
- `src/hooks/useBottomSheet.ts` — Touch-draggable bottom sheet for mobile UI

### UI

Uses MUI (Material UI) components and MUI Icons. Map tiles from Digitransit CDN (HSL map).
