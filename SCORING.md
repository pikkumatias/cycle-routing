# Scoring System

## Overview

Each route is scored on two axes: **scenic quality** and **cycling infrastructure quality**.
These combine into a single **Calm Score** (0-100).

## Scenic Score

Measures proximity to nature and green spaces along the route.
For each POI within 150 m of the route polyline, its category weight is added.

| Category       | Weight | OSM Tags                        |
| -------------- | ------ | ------------------------------- |
| Nature reserve | 4      | `leisure=nature_reserve`        |
| Park           | 3      | `leisure=park`                  |
| Garden         | 3      | `leisure=garden`                |
| Forest         | 3      | `landuse=forest`                |
| Woodland       | 3      | `natural=wood`                  |
| Meadow         | 2      | `landuse=meadow`                |
| Water          | 2      | `natural=water`                 |
| River / Stream | 2      | `waterway=river`, `=stream`     |
| Fountain       | 1      | `amenity=fountain`              |
| Grass          | 1      | `landuse=grass`                 |

## Infrastructure Score

Measures proximity to dedicated cycling infrastructure along the route.

| Category            | Weight | OSM Tags                                             |
| ------------------- | ------ | ---------------------------------------------------- |
| Separated cycleway  | 4      | `highway=cycleway`, `cycleway=track`, `cycleway:*=track` |
| Designated path     | 2      | `bicycle=designated` + `highway=path` or `=footway`  |
| Painted lane        | 1      | `cycleway=lane`                                      |

## Calm Score (Combined)

```
calmScore = 0.5 * (scenicScore / maxScenic) + 0.5 * (infraScore / maxInfra)
```

- Normalized to **0-100** across the route variants being compared.
- The route with the highest combined score gets 100.
- If all routes score 0 on one axis the denominator falls back to 1 (avoids division by zero).

## Route Presets

Each preset adjusts the Digitransit / OpenTripPlanner triangle optimisation weights.

| Preset   | Time | Safety | Slope | Description                      |
| -------- | ---- | ------ | ----- | -------------------------------- |
| Fastest  | 1.0  | 0.0    | 0.0   | Minimize travel time             |
| Scenic   | 0.2  | 0.7    | 0.1   | Prefer safe, scenic routes       |
| Balanced | 0.5  | 0.4    | 0.1   | Balance speed and safety         |
| Calm     | 0.3  | 0.6    | 0.1   | Prefer calm, infrastructure-rich |

The `safety` factor in OTP internally uses OSM cycleway tags,
so a high value already biases the router toward separated infrastructure.

## Technical Notes

- **POI proximity threshold**: 150 m from any sampled vertex on the route polyline.
- **Polyline sampling**: every 3rd vertex (~66 % fewer haversine calculations).
- **Single Overpass query**: all scenic POIs and cycling infrastructure are fetched together.
- **Estimated bbox**: computed from origin + destination with 20 % padding, allowing Overpass to run in parallel with route requests.
- **Data source**: OpenStreetMap via the Overpass API (no API key required).

## File Map

| File                        | Role                                   |
| --------------------------- | -------------------------------------- |
| `src/utils/scenicScore.ts`  | Scoring weights, normalisation, sampling |
| `src/utils/overpass.ts`     | Overpass query, POI classification     |
| `src/api/digitransit.ts`    | Route presets and Digitransit calls    |
| `src/App.tsx`               | Orchestration (parallel fetch, scoring) |
| `src/components/RouteCards.tsx` | Score display in UI                 |
