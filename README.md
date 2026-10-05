# Cycle Routing

A bicycle route planner that emphasises rider experience for the Helsinki region. Enter an origin and destination, and the app shows up to three genuinely different routes on an interactive map: **Fastest**, **Fewest lights** and **Calm**. When one route wins several of these, it is shown once with badges instead of as duplicate cards.

Candidate routes come from the Digitransit/HSL routing API (OpenTripPlanner): a few optimisation presets plus via-waypoint detours aimed around clusters of traffic lights and onto nearby car-free paths. Each candidate is scored server-side against a prebuilt OpenStreetMap layer file (traffic signals, major roads, the car-free path network) — see [SCORING.md](SCORING.md). Active road works and traffic disruptions along each route are surfaced as hazard markers, pulled from the City of Helsinki's open data WFS service.

This project has also served as a practical deep-dive into agentic AI development — the majority of the codebase was written collaboratively with Claude Code, exploring what autonomous, tool-driven coding agents can do in a real product context.

---

## Prerequisites

- **Node.js** (LTS recommended)
- **npm**
- A **Digitransit API key**
  See: [`https://digitransit.fi/en/developers/apis/1-routing-api/`](https://digitransit.fi/en/developers/apis/1-routing-api/)

---

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file (not committed to git) with your Digitransit API keys:

```bash
# .env.local
DIGITRANSIT_API_KEY=your-key-here          # used by serverless functions in api/
VITE_DIGITRANSIT_API_KEY=your-key-here     # exposed to browser for HSL map tiles
```

---

## Running the web app

```bash
npm run dev
```

Opens at `http://localhost:5173`. Enter two addresses (or `lat,lon` coordinates) and tap **Find routes**. The Vite dev server runs the `api/` functions locally, so `data/osm-layers.json` must exist (it is committed; rebuild it with `npm run data:osm`).

### Route cards

| Card | How it's chosen |
|------|-----------------|
| **Fastest** | Lowest total duration |
| **Fewest lights** | Fewest traffic-signal stops among routes at most +30 % (≥ +4 min) slower, trading lights against extra minutes; shown only if it avoids ≥ 2 lights and is a distinct route |
| **Calm** | Highest calm index (how much of the route is away from car traffic) among routes at most +40 % (≥ +5 min) slower; shown only if ≥ 10 points calmer and distinct |

Every card shows time, distance, extra time versus Fastest, light count and calm band.

### Traffic light overlay

When a route is displayed, 🚦 markers appear at each signal stop counted on the selected route, so the map always matches the card. A stop is a signalised junction or crossing the route passes through or crosses; the several signal nodes of one junction count once. Markers cluster at lower zoom levels.

### Hazard overlay

When a route is displayed, the app fetches active construction works and traffic arrangements from the City of Helsinki's open geodata WFS service and overlays them on the map as clustered markers. Hazards are filtered to those within 25 m of the selected route's polyline, so only disruptions that actually affect your ride are shown. Polygon hazards (e.g. closed areas) are also drawn directly on the map. Results are cached per route variant, so switching between route categories does not trigger a re-fetch.

---

## OSM layer data

Scoring reads `data/osm-layers.json` (signals, major roads with speed/lane/tram attributes, the car-free path network, bridges and tunnels) instead of calling Overpass per search. Refresh it every few months:

```bash
npm run data:osm            # resumes from .cache/osm/
npm run data:osm -- --refresh
```

`data/meta.json` records the OSM timestamp and counts.

---

## CLI route script

Query the routing API directly from the terminal:

```bash
npm run route
```

You will be prompted for:

- **From**: `lat,lon` (e.g. `60.192059,24.945831`)
- **To**: `lat,lon` (e.g. `60.169857,24.938379`)

The script calls the Digitransit Routing API and prints duration and all legs of the route.

To see the raw GraphQL response:

```bash
DEBUG_DIGITRANSIT=1 npm run route
```

---

## Deployment

Deployed on **Vercel** (functions pinned to `arn1`, Stockholm, via `vercel.json`). The `api/` directory contains the serverless functions: `route-plan` runs the routing engine (`src/routing/`) server-side, the others proxy Digitransit geocoding and city bike data, keeping the API key out of the browser bundle.
