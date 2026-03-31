/**
 * Route benchmark script — runs the full routing + scoring pipeline locally
 * and prints a structured report without touching the UI.
 *
 * Usage:
 *   node scripts/benchmark-routes.js <from> <to>
 *   node scripts/benchmark-routes.js 60.192059,24.945831 60.169857,24.938379
 *
 * Or run interactively (no args) and you'll be prompted for coordinates.
 * Requires DIGITRANSIT_API_KEY in .env.local.
 */

import dotenv from 'dotenv'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import polyline from '@mapbox/polyline'

dotenv.config()
dotenv.config({ path: '.env.local', override: true })

const DIGITRANSIT_ENDPOINT = 'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1'
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'
const OVERPASS_FALLBACK = 'https://overpass.kumi.systems/api/interpreter'
const OVERLAP_THRESHOLD = 0.85
const SCORE_THRESHOLD_M = 150
const NUM_ITINERARIES = 2

// ── Edit these to experiment with different preset combinations ───────────────

const CANDIDATE_PRESETS = [
  { label: 'fastest possible',   time: 1.00, safety: 0.00, slope: 0.00 },
  { label: 'best cycling infra', time: 0.00, safety: 1.00, slope: 0.00 },
  { label: 'flattest route',     time: 0.00, safety: 0.00, slope: 1.00 },
  { label: 'balanced',           time: 0.33, safety: 0.34, slope: 0.33 },
  { label: 'safe + flat hybrid', time: 0.10, safety: 0.60, slope: 0.30 },
]

// ── Math helpers ──────────────────────────────────────────────────────────────

function haversineDistance(a, b) {
  const R = 6_371_000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function samplePolyline(pts, step = 3) {
  if (step <= 1 || pts.length <= step) return pts
  const out = [pts[0]]
  for (let i = step; i < pts.length - 1; i += step) out.push(pts[i])
  if (pts.length > 1) out.push(pts[pts.length - 1])
  return out
}

function computeOverlap(a, b, thresholdM = 50, step = 3) {
  const sa = samplePolyline(a, step)
  const sb = samplePolyline(b, step)
  if (sa.length === 0) return 0
  let close = 0
  for (const ptA of sa) {
    for (const ptB of sb) {
      if (haversineDistance(ptA, ptB) <= thresholdM) {
        close++
        break
      }
    }
  }
  return close / sa.length
}

function minDistToPolyline(pt, pts) {
  let min = Infinity
  for (const v of pts) {
    const d = haversineDistance(pt, v)
    if (d < min) min = d
  }
  return min
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${s}s`
}

function pad(str, len) { return String(str).padEnd(len) }
function padL(str, len) { return String(str).padStart(len) }
function hr(char = '─', len = 70) { return char.repeat(len) }

// ── POI classification & scoring ──────────────────────────────────────────────

const SCENIC_WEIGHTS = {
  nature_reserve: 4, park: 3, garden: 3, forest: 3, wood: 3,
  meadow: 2, water: 2, river_stream: 2, fountain: 1, grass: 1,
}
const INFRA_WEIGHTS = {
  cycleway_separated: 4, cycleway_designated: 2, cycleway_lane: 1,
}

function classifyPoi(tags) {
  if (!tags) return undefined
  if (tags.highway === 'cycleway') return 'cycleway_separated'
  if (tags.cycleway === 'track' || tags['cycleway:left'] === 'track' || tags['cycleway:right'] === 'track') return 'cycleway_separated'
  if (tags.cycleway === 'lane') return 'cycleway_lane'
  if (tags.bicycle === 'designated' && (tags.highway === 'path' || tags.highway === 'footway')) return 'cycleway_designated'
  if (tags.leisure === 'park') return 'park'
  if (tags.leisure === 'garden') return 'garden'
  if (tags.leisure === 'nature_reserve') return 'nature_reserve'
  if (tags.landuse === 'forest') return 'forest'
  if (tags.natural === 'wood') return 'wood'
  if (tags.landuse === 'meadow') return 'meadow'
  if (tags.landuse === 'grass') return 'grass'
  if (tags.natural === 'water') return 'water'
  if (tags.amenity === 'fountain') return 'fountain'
  if (tags.waterway === 'river' || tags.waterway === 'stream') return 'river_stream'
  return undefined
}

function scoreCandidate(pois, pts) {
  const sampled = samplePolyline(pts, 3)
  let scenic = 0
  let infra = 0
  for (const poi of pois) {
    const d = minDistToPolyline([poi.lat, poi.lon], sampled)
    if (d <= SCORE_THRESHOLD_M) {
      const cat = classifyPoi(poi.tags)
      if (cat && SCENIC_WEIGHTS[cat]) scenic += SCENIC_WEIGHTS[cat]
      if (cat && INFRA_WEIGHTS[cat]) infra += INFRA_WEIGHTS[cat]
    }
  }
  return { scenic, infra }
}

// ── Input ─────────────────────────────────────────────────────────────────────

function parseLatLon(s) {
  const cleaned = s.trim()
  const parts = cleaned.includes(',') ? cleaned.split(',') : cleaned.split(/\s+/)
  if (parts.length !== 2) throw new Error(`Invalid coords: "${cleaned}" — use "lat,lon"`)
  const lat = Number(parts[0])
  const lon = Number(parts[1])
  if (isNaN(lat) || isNaN(lon)) throw new Error('Coordinates must be numbers')
  return { lat, lon }
}

async function getCoords() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (args.length >= 2) {
    return { from: parseLatLon(args[0]), to: parseLatLon(args[1]) }
  }
  const rl = readline.createInterface({ input, output })
  try {
    const fromStr = await rl.question('From (lat,lon): ')
    const toStr = await rl.question('To   (lat,lon): ')
    return { from: parseLatLon(fromStr), to: parseLatLon(toStr) }
  } finally {
    rl.close()
  }
}

// ── Digitransit fetch ─────────────────────────────────────────────────────────

async function fetchPreset(from, to, preset, apiKey) {
  const query = `
    query Benchmark(
      $fromLat: Float! $fromLon: Float! $toLat: Float! $toLon: Float!
      $time: Float! $safety: Float! $slope: Float!
    ) {
      plan(
        from: { lat: $fromLat, lon: $fromLon }
        to:   { lat: $toLat,   lon: $toLon   }
        numItineraries: ${NUM_ITINERARIES}
        transportModes: [{ mode: BICYCLE }]
        optimize: TRIANGLE
        triangle: { timeFactor: $time, safetyFactor: $safety, slopeFactor: $slope }
      ) {
        itineraries {
          duration
          legs {
            distance
            legGeometry { points }
          }
        }
      }
    }
  `
  const res = await fetch(DIGITRANSIT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'digitransit-subscription-key': apiKey,
    },
    body: JSON.stringify({
      query,
      variables: {
        fromLat: from.lat, fromLon: from.lon,
        toLat: to.lat, toLon: to.lon,
        time: preset.time, safety: preset.safety, slope: preset.slope,
      },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Digitransit ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  if (data.errors?.length) throw new Error(`GraphQL: ${data.errors[0].message}`)
  return data.data?.plan?.itineraries ?? []
}

// ── Overpass fetch ────────────────────────────────────────────────────────────

function estimateBbox(from, to, padding = 0.2) {
  const minLat = Math.min(from.lat, to.lat)
  const maxLat = Math.max(from.lat, to.lat)
  const minLon = Math.min(from.lon, to.lon)
  const maxLon = Math.max(from.lon, to.lon)
  const latPad = (maxLat - minLat) * padding || 0.005
  const lonPad = (maxLon - minLon) * padding || 0.005
  return {
    south: minLat - latPad, west: minLon - lonPad,
    north: maxLat + latPad, east: maxLon + lonPad,
  }
}

async function runOverpassQuery(query) {
  for (const endpoint of [OVERPASS_ENDPOINT, OVERPASS_FALLBACK]) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return data.elements ?? []
    } catch (e) {
      if (endpoint === OVERPASS_FALLBACK) throw e
    }
  }
  return []
}

async function fetchPois(from, to) {
  const { south, west, north, east } = estimateBbox(from, to)
  const b = `(${south},${west},${north},${east})`

  const scenicQ = `[out:json][timeout:20];
(
  node["leisure"="park"]${b}; way["leisure"="park"]${b};
  node["leisure"="garden"]${b}; way["leisure"="garden"]${b};
  node["leisure"="nature_reserve"]${b}; way["leisure"="nature_reserve"]${b};
  node["landuse"="forest"]${b}; way["landuse"="forest"]${b};
  node["natural"="wood"]${b}; way["natural"="wood"]${b};
  node["landuse"="meadow"]${b}; way["landuse"="meadow"]${b};
  node["landuse"="grass"]${b}; way["landuse"="grass"]${b};
  node["natural"="water"]${b}; way["natural"="water"]${b};
  node["amenity"="fountain"]${b};
  node["waterway"="river"]${b}; way["waterway"="river"]${b};
  node["waterway"="stream"]${b}; way["waterway"="stream"]${b};
);out center;`

  const infraQ = `[out:json][timeout:20];
(
  way["highway"="cycleway"]${b};
  way["cycleway"="track"]${b};
  way["cycleway"="lane"]${b};
  way["cycleway:left"="track"]${b};
  way["cycleway:right"="track"]${b};
  way["bicycle"="designated"]["highway"="path"]${b};
  way["bicycle"="designated"]["highway"="footway"]${b};
);out center;`

  const [scenicEls, infraEls] = await Promise.all([
    runOverpassQuery(scenicQ).catch(() => []),
    runOverpassQuery(infraQ).catch(() => []),
  ])

  return [...scenicEls, ...infraEls]
    .map((el) => ({
      lat: el.type === 'node' ? el.lat : el.center?.lat,
      lon: el.type === 'node' ? el.lon : el.center?.lon,
      tags: el.tags,
    }))
    .filter((p) => p.lat != null && p.lon != null)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.DIGITRANSIT_API_KEY
  if (!apiKey) {
    console.error('DIGITRANSIT_API_KEY not set — add it to .env.local')
    process.exit(1)
  }

  const { from, to } = await getCoords()
  console.log(`\nFrom: ${from.lat},${from.lon}  →  To: ${to.lat},${to.lon}`)

  // ── 1. Fetch all presets in parallel ────────────────────────────────────────
  console.log(`\nFetching ${CANDIDATE_PRESETS.length} presets × ${NUM_ITINERARIES} itineraries...`)
  const results = await Promise.allSettled(
    CANDIDATE_PRESETS.map((p) =>
      fetchPreset(from, to, p, apiKey).then((its) => ({ preset: p, itineraries: its })),
    ),
  )

  const candidates = []
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn(`  Preset failed: ${result.reason?.message}`)
      continue
    }
    const { preset, itineraries } = result.value
    for (const it of itineraries) {
      const legs = it.legs ?? []
      const pts = legs.flatMap((l) => {
        try { return polyline.decode(l?.legGeometry?.points ?? '') } catch { return [] }
      })
      const distKm = legs.reduce((s, l) => s + (l.distance ?? 0), 0) / 1000
      candidates.push({ label: preset.label, durationSec: it.duration, distanceKm: distKm, polyline: pts })
    }
  }

  if (candidates.length === 0) {
    console.error('No candidates returned. Check coordinates and API key.')
    process.exit(1)
  }

  // ── 2. Raw candidates table ──────────────────────────────────────────────────
  console.log(`\n${hr()}`)
  console.log(`  RAW CANDIDATES (${candidates.length} total)`)
  console.log(hr())
  console.log(`  ${pad('#', 3)} ${pad('Preset', 22)} ${pad('Duration', 10)} ${pad('Distance', 10)} Points`)
  console.log(`  ${hr('-', 65)}`)
  candidates.forEach((c, i) => {
    console.log(
      `  ${pad(i, 3)} ${pad(c.label, 22)} ${pad(formatDuration(c.durationSec), 10)} ` +
      `${pad(c.distanceKm.toFixed(1) + ' km', 10)} ${c.polyline.length}`,
    )
  })

  // ── 3. Overlap matrix ────────────────────────────────────────────────────────
  if (candidates.length > 1) {
    console.log(`\n${hr()}`)
    console.log('  OVERLAP MATRIX  (A→B%, bidirectional >85% = duplicate)')
    console.log(hr())
    const colW = 5
    const header = '       ' + candidates.map((_, i) => padL(`[${i}]`, colW)).join('')
    console.log(header)
    candidates.forEach((a, i) => {
      const row = candidates.map((b, j) => {
        if (i === j) return padL('-', colW)
        const ov = Math.round(computeOverlap(a.polyline, b.polyline) * 100)
        const cell = `${ov}%`
        const isDup = ov > OVERLAP_THRESHOLD * 100
        return padL(isDup ? `*${cell}` : cell, colW)
      }).join('')
      console.log(`  [${i}]  ${row}`)
    })
    console.log('  * = likely duplicate direction')
  }

  // ── 4. Deduplication ─────────────────────────────────────────────────────────
  console.log(`\n${hr()}`)
  console.log('  DEDUPLICATION')
  console.log(hr())

  const sorted = [...candidates].sort((a, b) => a.durationSec - b.durationSec)
  const kept = []
  const dropped = []
  for (const c of sorted) {
    const dup = kept.find(
      (k) =>
        computeOverlap(c.polyline, k.polyline) > OVERLAP_THRESHOLD &&
        computeOverlap(k.polyline, c.polyline) > OVERLAP_THRESHOLD,
    )
    if (dup) dropped.push({ candidate: c, duplicateOf: dup })
    else kept.push(c)
  }

  console.log(`  ${candidates.length} candidates → ${kept.length} unique routes`)
  if (dropped.length > 0) {
    console.log('  Dropped (too similar to a kept route):')
    for (const { candidate: c, duplicateOf: d } of dropped) {
      const ci = candidates.indexOf(c)
      const di = candidates.indexOf(d)
      console.log(`    [${ci}] "${c.label}" (${formatDuration(c.durationSec)}) ≈ [${di}] "${d.label}" (${formatDuration(d.durationSec)})`)
    }
  }

  if (kept.length === 0) {
    console.log('\nNo unique routes to score.')
    return
  }

  // ── 5. Fetch POIs ────────────────────────────────────────────────────────────
  process.stdout.write('\nFetching Overpass POIs...')
  const pois = await fetchPois(from, to).catch((e) => {
    console.warn(` failed (${e.message}) — scoring without POIs`)
    return []
  })
  console.log(` ${pois.length} POIs loaded.`)

  // ── 6. Score & normalize ─────────────────────────────────────────────────────
  const scores = kept.map((c) => ({ ...c, ...scoreCandidate(pois, c.polyline) }))
  const maxScenic = Math.max(...scores.map((s) => s.scenic), 1)
  const maxInfra = Math.max(...scores.map((s) => s.infra), 1)
  const scored = scores.map((s) => ({
    ...s,
    scenicNorm: Math.round((s.scenic / maxScenic) * 100),
    infraNorm: Math.round((s.infra / maxInfra) * 100),
    calmNorm: Math.round((0.5 * (s.scenic / maxScenic) + 0.5 * (s.infra / maxInfra)) * 100),
  }))

  // ── 7. Selection ─────────────────────────────────────────────────────────────
  const fastest = scored.reduce((best, c) => (c.durationSec < best.durationSec ? c : best))
  const scenicPool = scored.length > 1 ? scored.filter((c) => c !== fastest) : scored
  const scenic = scenicPool.reduce((best, c) => (c.scenicNorm > best.scenicNorm ? c : best))
  const calmPool =
    scored.length > 2
      ? scored.filter((c) => c !== fastest && c !== scenic)
      : scored.length > 1
        ? scored.filter((c) => c !== fastest)
        : scored
  const calm = calmPool.reduce((best, c) => (c.infraNorm > best.infraNorm ? c : best))

  console.log(`\n${hr()}`)
  console.log('  ROUTE SELECTION  (scores normalized 0-100 across unique candidates)')
  console.log(hr())
  console.log(
    `  ${pad('Category', 10)} ${pad('Duration', 10)} ${pad('Distance', 10)} ` +
    `${padL('Scenic', 7)} ${padL('Infra', 6)} ${padL('Calm', 6)}  Preset`,
  )
  console.log(`  ${hr('-', 65)}`)
  for (const [category, route] of [['FASTEST', fastest], ['SCENIC', scenic], ['CALM', calm]]) {
    console.log(
      `  ${pad(category, 10)} ${pad(formatDuration(route.durationSec), 10)} ` +
      `${pad(route.distanceKm.toFixed(1) + ' km', 10)} ` +
      `${padL(route.scenicNorm, 7)} ${padL(route.infraNorm, 6)} ${padL(route.calmNorm, 6)}  ${route.label}`,
    )
  }
  console.log()
}

main().catch((err) => {
  console.error('\nError:', err.message)
  process.exit(1)
})
