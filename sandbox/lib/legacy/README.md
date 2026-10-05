# Legacy grading (frozen)

Verbatim copies of `src/utils/{scenicScore,overpass,routeSelection,routeGeometry}.ts` at
commit `c197bee` — the grading the app used before the routing overhaul — plus the few
types they imported (`types.ts`). The sandbox's `baseline` step runs these so new grading
can be compared against what users actually saw. Do not edit; behaviour must stay frozen.

Note: `overpass.ts` fetches through the app's `/api/overpass` proxy; the sandbox only uses
its pure parts (`classifyPoi`, the query builder logic is reproduced in the sandbox).
