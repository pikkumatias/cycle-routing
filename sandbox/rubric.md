# Grading rubric (v0 — approved by the user 2026-10-08)

Used by Claude to pre-grade the sandbox dossiers and by the user when reviewing. Labels
record which rubric version they followed (`rubricVersion`).

## Calm = away from car traffic

Judge how much of the ride is spent near motor traffic, not scenery or stops. Tiers, best
first:

| Tier | What it looks like |
| ---- | ------------------ |
| A | Car-free and away from roads: park and shore paths, Baana, forest paths, long unnamed bike paths that are not beside a major road |
| B | Quiet streets (≤ 30 km/h residential, living streets), separated tracks along minor streets |
| C | Separated tracks or shared paths alongside arterials — physically safe but next to traffic; 40 km/h streets |
| D | Mixed traffic or painted lanes on collector streets |
| E | Mixed traffic on arterials, streets with tram rails in the carriageway, unsignalised crossings of arterials |

Rank a trip's candidates by the share of distance in each tier, worst stretches weighing
most: 300 m of tier E hurts more than 1 km of tier C. Unsignalised arterial crossings count
against a route. Walking the bike is not traffic stress (note it, don't penalise it for calm).

## Detours

A calmer or lower-light alternative earns its extra time only if the gain is clear:

- **Fewest lights:** worth roughly 1 extra minute per light avoided; a single light saved is
  within counting noise and never worth a separate card.
- **Calm:** worth it when a substantial share of the distance (≈ ¼ or more) moves up at
  least one tier, or a tier-E stretch disappears; a few minutes for a park path instead of
  an arterial is a good trade, ten minutes for a marginal gain is not.

## Same route

Two routes are "the same" when they share most of their length (≈ 80 %+) and the
differences are within a block — e.g. the cycle track on the other side of the same street,
or a one-block jog. Different streets for a kilometre are different routes even when
parallel.

## What each label records

- `calmRanking`: candidates best → worst for calm
- `tiers`: the dominant tier of each candidate
- `sameRoute`: groups of candidates that are effectively the same
- `picks.fewestLights` / `picks.calm`: the route to show for that card, or `null` when no
  candidate is worth a separate card (it would merge into Fastest)
- `rationale`: one line per candidate
