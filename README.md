# Cycle Routing

A bicycle route planner that emphasises rider experience for the Helsinki region. Enter an origin and destination, and the app generates four optimized route variants on an interactive map: **Fastest**, **Scenic**, **Calm**, and **Fewest Lights**.

Routes come from the Digitransit/HSL routing API (OpenTripPlanner). Each route is then scored against OpenStreetMap data fetched from the Overpass API: nearby parks, nature reserves, waterways, dedicated cycling infrastructure, and traffic signal density all influence which variant lands in which category. Active road works and traffic disruptions along each route are surfaced as hazard markers, pulled from the City of Helsinki's open data WFS service.

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

Opens at `http://localhost:5173`. Enter two addresses (or `lat,lon` coordinates) and tap **Go** to plan a route.

### Route variants

| Variant | How it's chosen |
|---------|----------------|
| **Fastest** | Lowest total duration |
| **Scenic** | Highest score for nearby parks, nature, and water (OSM via Overpass) |
| **Calm** | Highest score for dedicated cycling infrastructure (cycleways, bike lanes) |
| **Fewest Lights** | Lowest count of traffic signals along the route (OSM `highway=traffic_signals`) |

### Traffic light overlay

When a route is displayed, 🚦 markers appear on the map at each signalized intersection along the selected route. Multiple OSM signal nodes at the same intersection are collapsed into a single centroid marker. Signal proximity is measured as perpendicular distance to the route's line segments (not just to vertices), so only signals within 10 m of the actual path are shown — this keeps markers from parallel streets off the map. Markers cluster at lower zoom levels.

### Hazard overlay

When a route is displayed, the app fetches active construction works and traffic arrangements from the City of Helsinki's open geodata WFS service and overlays them on the map as clustered markers. Hazards are filtered to those within 25 m of the selected route's polyline, so only disruptions that actually affect your ride are shown. Polygon hazards (e.g. closed areas) are also drawn directly on the map. Results are cached per route variant, so switching between route categories does not trigger a re-fetch.

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

Deployed on **Vercel**. The `api/` directory contains Vercel serverless functions that proxy Digitransit API calls server-side (keeping the API key out of the browser bundle).
