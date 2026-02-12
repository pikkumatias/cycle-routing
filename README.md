# Cycle Routing

A small React + TypeScript + Vite project for experimenting with **bicycle routing** using the **Digitransit Routing API** (HSL router).  
It currently has:

- A standard Vite + React app (for future UI work)
- A Node script that calls the Digitransit Routing API from the terminal and prints a **bicycle route** between two coordinate points

---

## Prerequisites

- **Node.js** (LTS recommended)
- **npm**
- A **Digitransit API key** from the Routing API  
  See the Digitransit docs: [`https://digitransit.fi/en/developers/apis/1-routing-api/`](https://digitransit.fi/en/developers/apis/1-routing-api/)

---

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file (not committed to git) with your Digitransit API key:

```bash
echo "DIGITRANSIT_API_KEY=your-key-here" > .env.local
```

The `scripts/digitransit-route.js` script uses `dotenv` to load variables from `.env` and `.env.local` (with `.env.local` taking precedence).

---

## Running the web app

Start the Vite dev server:

```bash
npm run dev
```

Then open the printed URL (usually `http://localhost:5173`) in your browser.

---

## Running a bicycle routing query from the terminal

There is a Node script wired to the **HSL** routing endpoint:

- Endpoint: `https://api.digitransit.fi/routing/v2/hsl/gtfs/v1`
- Mode: bicycle-only via `transportModes: [{ mode: BICYCLE }]`

Run the script:

```bash
npm run route
```

You will be prompted for:

- **From**: `lat,lon` (e.g. `60.192059,24.945831`)
- **To**: `lat,lon` (e.g. `60.169857,24.938379`)

The script will:

- Call the Digitransit Routing API with those coordinates
- Request a bicycle itinerary
- Print total duration, walk distance, and all legs of the route

---

## Debugging the API response

To see the full JSON payload returned by Digitransit (for debugging), set an environment flag when running the script:

```bash
DEBUG_DIGITRANSIT=1 npm run route
```

This will log the raw GraphQL response object in addition to the summarized itinerary.
