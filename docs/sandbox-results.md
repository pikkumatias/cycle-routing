# Sandbox results — prior config (`prior-1`)

First full run of the calibration sandbox (45 trips, OSM data 2026-10-02, OTP responses
cached). All card sets are measured with the new engine so they are comparable; the
weights are still priors, so absolute numbers will move after calibration.

## Card sets

| Set | Mean cards | Trips with duplicate cards | Separate Fewest-lights card | Median lights saved | Median extra min | Lights card worse than Fastest | Mean calm gain |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Legacy, initial view | 1.58 | 2 | 26 | 3 | 2.5 | 1 | – |
| Legacy, after "more options" | 3.67 | 35 | 30 | 2 | 1.1 | 1 | 10.5 |
| New, production pool (7 calls) | 1.8 | 0 | 31 | 3 | 2.2 | 0 | 13.6 |
| New, full pool (~46 calls) | 1.89 | 0 | 33 | 3 | 1.9 | 0 | 15 |

"Duplicate cards" = a later card that is the same route or not distinct from an earlier
one by the engine's rule (≥ max(400 m, 20 %) of the route elsewhere). The legacy app showed
the same or a near-identical route under several labels on 35 of 45 trips once
"more options" was opened; the new selection never does.

## Generator yield (budget decision)

Greedy forward selection from the three production presets; regret = extra lights versus
the full pool's Fewest-lights pick + lost calm points / 10, averaged over trips.

| OTP calls | Added generator | Mean regret |
| --- | --- | --- |
| 3 | `preset:fastest + preset:safety + preset:balanced` | 1.382 |
| 4 | `via:lights#2` | 0.833 |
| 5 | `via:lights#3` | 0.558 |
| 6 | `via:calm#3` | 0.356 |
| 7 | `via:calm#4` | 0.242 |
| 8 | `via:geo#11` | 0.144 |
| 9 | `tri:0,0.75,0.25` | 0.104 |
| 10 | `via:calm#2` | 0.064 |
| 11 | `tri:0.25,0.25,0.5` | 0.033 |
| 12 | `legacy:safeflat` | 0.027 |
| 13 | `via:geo#9` | 0.022 |
| 14 | `tri:0.25,0.75,0` | 0.007 |
| 15 | `via:geo#3` | 0.002 |
| 16 | `tri:0,0.5,0.5` | 0 |

Today's production set (presets + `via:lights#1-2` + `via:calm#1-2`, 7 calls) has mean
regret 0.564; the same number of calls chosen greedily reaches 0.242. The wider
via offsets (`#3`/`#4`: 600 m beside a signal cluster, 30 % of the trip sideways) earn more
than the nearest ones, and returns flatten after ~8–10 calls. The exact generator indices are
fitted in-sample; the family-level choice is what should carry over.

## Claude pre-grading (dry run of `fit`)

Three graders, working only from the rubric and the dossiers (never the model's scores),
graded all 45 trips; each also graded the same 3 calibration trips. Agreement between
graders on those trips: calm-ranking pair agreement 0.93–1.00, card picks identical on 2 of
3 trips (2-of-3 majority on the third).

Fitting the calm weights to these 1,202 within-trip ranking pairs (`npm run sandbox -- fit claude`):

| | Pair agreement (leave-one-trip-out) |
| --- | --- |
| Prior weights | 0.848 |
| Fitted weights | 0.866 |

Fitted weights: away 0, quiet 0.01, adjacent 0.31, mixedLow 0.71, mixedHigh 1 (fixed),
crossing penalty 49 m. This is a dry run — the user's reviewed labels are the training data.

### Rubric gaps the graders hit (to settle when approving the rubric)

1. **Same route, different experience** — riding in a street's carriageway vs on the
   separated track beside the same street matches the geometric "same route" rule but
   differs a lot for calm. Graders grouped these inconsistently.
2. **"Dominant tier"** has no aggregation rule; graders knocked a route down a tier when
   ~15 %+ of it is in tram-street or arterial traffic.
3. **Zero-cost calm gains** — the detour rules cover only routes that cost extra time.
4. **Unsignalised arterial crossings** appear often (e.g. Mannerheimintie). Some are likely
   OSM gaps or a too-tight signal-attachment radius (`signals.crossM`); they affect calm.
