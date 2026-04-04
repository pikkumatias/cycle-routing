# Cycle Routing

A bicycle route planner that emphasises rider experience for the Helsinki region. Enter an origin and destination, and the app generates three optimized route variants on an interactive map: **Fastest**, **Scenic**, and **Calm**.

Routes come from the Digitransit/HSL routing API (OpenTripPlanner). Each route is then scored against OpenStreetMap data fetched from the Overpass API: nearby parks, nature reserves, waterways, and dedicated cycling infrastructure all influence which variant lands in which category.

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
