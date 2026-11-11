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
VITE_DIGITRANSIT_API_KEY=your-key-here     # optional: only the dev-only sandbox review page (HSL raster tiles)
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

Every card shows time, distance, extra time versus Fastest, light count and calm band. From mid-October to mid-April it also shows how far the route rides on Helsinki's priority winter routes, and the selected card splits that into brush-salted and priority-ploughed kilometres.

### Winter maintenance

Helsinki maintains about 160 km of walking and cycling routes to a higher winter standard: **brush-salting** (snow swept off, slipperiness treated with salt solution, no grit; quality promise 7–19 on weekdays, 7–17 at weekends) and **intensified ploughing** (ploughed by 07:00, and within 4 h of a daytime snowfall). Each route's metres on them are measured server-side against `data/winter-routes.json`. Only Helsinki publishes this network, so routes in Espoo and Vantaa show nothing rather than "unmaintained". For now this is information on the card only; it does not yet change which routes are chosen.

### Traffic light overlay

When a route is displayed, 🚦 markers appear at each signal stop counted on the selected route, so the map always matches the card. A stop is a signalised junction or crossing the route passes through or crosses; the several signal nodes of one junction count once. Markers cluster at lower zoom levels.

### Hazard overlay

When a route is displayed, the app fetches active construction works and traffic arrangements from the City of Helsinki's open geodata WFS service and overlays them on the map as clustered markers. Hazards are filtered to those within 25 m of the selected route's polyline, so only disruptions that actually affect your ride are shown. Polygon hazards (e.g. closed areas) are also drawn directly on the map. Results are cached per route variant, so switching between route categories does not trigger a re-fetch.

---

## OSM layer data

Scoring reads `data/osm-layers.json` (signals, major roads with speed/lane/tram attributes, the car-free path network, bridges and tunnels) instead of calling Overpass per search. It is built from [BBBike's daily Helsinki extract](https://download.bbbike.org/osm/bbbike/Helsinki/), which covers lat 60.11–60.35, lon 24.59–25.24; trips outside that box are rejected. Refresh it every few months:

```bash
npm run data:osm -- --refresh          # re-download the extract (~15 s)
npm run data:osm -- --source=overpass  # alternative source; slow when Overpass is busy
```

`data/meta.json` records the OSM timestamp and counts.

## Winter route data

`data/winter-routes.json` holds Helsinki's prioritised winter maintenance network for walking and cycling, fetched from the city's open WFS (layer `avoindata:Talvihoidon_priorisoitu_reitisto`, ~55 KB). The city updates the network for each winter season, so refresh it every autumn:

```bash
npm run data:winter
```

The script stops if the city introduces a maintenance type it doesn't know.

---

## Data sources and credits

The app is built on open data. The same credits are in the app, under **Map and settings → Data sources**.

| Source | Used for | Licence |
|---|---|---|
| [Digitransit](https://digitransit.fi/en/) (HSL, Fintraffic, Waltti) | Route candidates (OpenTripPlanner), elevation, address search, city bike stations | [CC BY 4.0](https://digitransit.fi/en/developers/apis/7-terms-of-use/) |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, via [BBBike](https://download.bbbike.org/osm/) extracts | Traffic signals, major roads, the car-free path network, bridges and tunnels used to score routes (`data/osm-layers.json`) | [ODbL](https://opendatacommons.org/licenses/odbl/) |
| [OpenFreeMap](https://openfreemap.org/), [OpenMapTiles](https://openmaptiles.org/) | Basemap vector tiles and fonts (OpenStreetMap data) | OpenMapTiles schema [BSD-3/CC BY](https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md); data ODbL |
| [City of Helsinki](https://hri.fi/en_gb/) (Helsinki Region Infoshare) | Prioritised winter maintenance network ([dataset](https://hri.fi/data/en_GB/dataset/helsingin-jalankulun-ja-pyorailyn-talvihoidon-priorisoitu-reitisto)), roadworks and temporary traffic arrangements | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

The map also shows the standard MapLibre attribution (the ⓘ button).

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

Shared helpers live in `api/_lib/`; Vercel doesn't deploy `_`-prefixed paths as functions.

### Rate limiting

Each `/api/route-plan` request makes 3–7 Digitransit calls on the project's key, so the API is rate-limited per IP with two Vercel Firewall rules (Project → Firewall → Configure → New Rule). They live in the dashboard, not in this repo:

| Rule | If | Then |
|---|---|---|
| Route planning | Request Path **equals** `/api/route-plan` | Rate Limit: Fixed Window, **20 requests / 60 s**, key **IP Address**, action **Too Many Requests (429)** |
| Other API | Request Path **starts with** `/api/` | Rate Limit: Fixed Window, **120 requests / 60 s**, key **IP Address**, action **Too Many Requests (429)** |

Autocomplete fires one request per pause in typing, so the general limit is generous; a normal session plans a handful of trips. The app shows a 429 as "the route service isn't responding, try again in a moment".
