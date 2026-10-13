# Scoring and selection

How routes are generated, measured and turned into cards. Everything lives in the pure
engine under `src/routing/` and runs server-side in `api/route-plan.ts`. Every number
below is a tunable in `src/routing/config.ts`; values marked *prior* are hand-set starting
points that the calibration sandbox replaces (see `docs/routing-overhaul-todo.md`).

## Candidates (`generators.ts`, `planRoutes.ts`)

Bike-only OTP returns one itinerary per request, so variety comes from the requests:

| Round | Generator | What it asks OTP |
| ----- | --------- | ---------------- |
| 1 | `preset:fastest` | triangle time 1 |
| 1 | `preset:safety` | triangle safety 1 |
| 1 | `preset:balanced` | triangle ⅓ each |
| 2 | `via:lights` | detour through a waypoint 300/600 m beside the densest 800 m stretch of signal stops on Fastest |
| 2 | `via:calm` | detour through a waypoint on a nearby car-free path (lateral targets at ⅓/½/⅔ of the trip) |

Round-2 waypoints are snapped onto the calm network (nodes of car-free paths away from major
roads) — raw offsets land in bays and water. A via route that rides out to the waypoint and
back has the stub trimmed (its length comes off as many OTP steps as it spans, so the steps
stay aligned with the geometry); stubs over 150 m discard the route. Identical geometries from
different generators merge. Round 2 starts as soon as `preset:fastest` is back (it only needs
that route), without waiting for the other presets. It is skipped when the fastest route took
over half of the 8 s deadline, and round-2 calls still running at the deadline are aborted;
either way the plan is marked `partial` (and not cached at the edge).

## Measurements (`profile.ts`)

### Traffic lights (`signals.ts`)

Signal nodes come from both OSM tagging styles (`highway=traffic_signals` and the
`highway=crossing` + `crossing=traffic_signals` most Helsinki crossings use); flashing,
emergency and ramp-meter signals are excluded at build time. A node is a hit when

| Rule | Condition |
| ---- | --------- |
| `on` | within 3 m of the full-resolution route — the route passes through it |
| `cross` | the route crosses a major road at grade within 18 m of one of that road's signals |
| `near` | within 12 m where the route crosses an open area (OTP draws straight lines across squares) |

Hits are ordered along the route; each group spanning at most 40 m from its first hit is
one stop (a junction has a node per crossing arm). Nothing counts while the route is on a
bridge or in a tunnel. The map markers are exactly these stops.

### Traffic stress and calm (`stress.ts`)

Each route segment gets a stress class:

| Class | Meaning | Weight (prior) |
| ----- | ------- | -------------- |
| `away` | car-free (unnamed path, open area, walking) and not within 20 m of a major road | 0 |
| `quiet` | a named street that is not a major road | 0.15 |
| `adjacent` | a car-free path within 20 m of a major road, or a track OTP named after one | 0.35 |
| `mixedLow` | on a major road with a painted lane or ≤ 30 km/h | 0.6 |
| `mixedHigh` | on a major road otherwise, or with tram rails | 1 |

Major roads are OSM trunk–tertiary (with links). Car-free vs street comes from OTP's step
names (`bogusName` "bike path", "path", …). At-grade crossings of a major road are found as
the route changing sides of the road line; unsignalised ones add a 50 m penalty.

```
calmIndex = 100 × (1 − (Σ weight × metres + 50 m × unsignalisedCrossings) / length)
```

Clamped to 0–100 and **absolute**: the same route always gets the same number. Bands
(prior): very calm ≥ 85, calm ≥ 70, some traffic ≥ 50, busy below.

### Climb (`elevation.ts`)

OTP steps carry an elevation profile (a point every ~10 m). OTP's own `elevationGained`
counts every wobble of the elevation model — about twice the profile's raw climb — so the
profile is smoothed with a 100 m moving average and rises count once they clear 2 m above
the last low. Cards show the climb rounded to 5 m. Stress runs (`profile.stressRuns`: where
each stretch of one stress class ends) are sent with each route so the app can show where
the traffic is.

## Selection (`select.ts`)

1. **Fastest** — minimum duration.
2. **Fewest lights** — among routes within +30 % (≥ +4 min) of Fastest, ranked by
   `lights + extraMinutes / 1` (one light is worth one minute, prior). The first that saves
   ≥ 2 lights against every shown card and is distinct gets a card.
3. **Calm** — among routes within +40 % (≥ +5 min), ranked by
   `calmIndex − 3 × extraMinutes`. The first that is ≥ 10 points calmer than every shown
   card and distinct gets a card.
4. Roles are reassigned over the shown cards by metric, so a card never claims a category
   another shown card beats; a card left with no role is dropped. Categories a card also
   wins become badges.
5. **Outside the data** — a route that rides more than 100 m outside the OSM data area
   (`profile.outsideM`) can't take part in Fewest lights or Calm: nothing is known there, so
   it would look better than it is. Gains are measured against routes inside the area only;
   if Fastest itself leaves it, no lights or calm claims are made at all.

**Distinct** (`similarity.ts`): at least max(400 m, 20 % of its length) of a route lies more
than 25 m from every shown route. A near-duplicate can still get a card when it clears
1.5 × the required gain.

## Data (`layers.ts`, `scripts/build-osm-layers.ts`)

`data/osm-layers.json` is built offline by `npm run data:osm` from BBBike's daily Helsinki
extract (lat 60.11–60.35, lon 24.59–25.24): stopping signals, major roads (class,
name, maxspeed, lanes, painted lane, tram, bridge/tunnel, signals on the road), calm-network
nodes every 150 m, and non-major bridges/tunnels. `data/meta.json` records the OSM
timestamp. The API rejects trips outside the file's bbox (autocomplete doesn't offer places
outside it either); routes between two points inside can still leave it (see Selection, 5).
Covering more of north Vantaa and west Espoo needs a larger source than the BBBike extract.

## File map

| File | Role |
| ---- | ---- |
| `src/routing/config.ts` | All tunables |
| `src/routing/otpClient.ts` | OTP `planConnection` request/response |
| `src/routing/generators.ts`, `spur.ts` | Round-2 waypoints, stub trimming |
| `src/routing/signals.ts`, `stress.ts`, `profile.ts` | Measurements and calm index |
| `src/routing/similarity.ts`, `select.ts` | Distinctness and cards |
| `src/routing/planRoutes.ts` | Orchestration |
| `api/route-plan.ts` | Endpoint: validation, layer loading, response |
| `src/api/routePlan.ts` | Client fetch + cache |
