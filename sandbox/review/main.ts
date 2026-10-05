// Review page for the calibration sandbox: `npm run dev`, then open /sandbox/review/.
// Shows each trip's candidates with Claude's pre-grades and records the user's labels.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import polyline from '@mapbox/polyline'

type Candidate = {
  letter: string
  id: string
  durationSec: number
  distanceM: number
  extraSec: number
  legs: string[]
  signalStops: [number, number][]
  lights: number
  dossier: string[]
}
type CardSet = Array<{ letter: string; roles: string[] }>
type Review = {
  od: { id: string; name: string; bucket: string; from: [number, number]; to: [number, number] }
  candidates: Candidate[]
  similarPairs: Array<[string, string]>
  cardSets: { legacy: CardSet; production: CardSet }
}
type ClaudeLabel = {
  calmRanking: string[]
  tiers: Record<string, string>
  sameRoute: string[][]
  picks: { fewestLights: string | null; calm: string | null }
  rationale: Record<string, string>
}
type UserLabel = {
  od: string
  blind: boolean
  revealed: boolean
  calmRanking: string[]
  sameRoute: Record<string, boolean>
  picks: { fewestLights: string | null; calm: string | null }
  ratings: Record<string, number>
  lightCounts: Record<string, number>
  preferredSet: 'legacy' | 'new' | 'same' | null
  notes: string
}

const COLORS = ['#2563eb', '#f59e0b', '#16a34a', '#dc2626', '#7c3aed', '#0891b2', '#be185d', '#65a30d', '#ea580c', '#475569']
const app = document.getElementById('app')!

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}
const save = (id: string, label: unknown) =>
  api(`/__sandbox/labels/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(label) })

/** Stable pseudo-random number in [0, 1) per string — decides blind trips and A/B order. */
function hash01(s: string): number {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return (h >>> 0) / 2 ** 32
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Array<Node | string>) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  node.append(...children)
  return node
}

// ── Index: trip list + trade-off questions ────────────────────────────────────────

const TRADEOFFS = [
  { id: 'l1', q: 'Fastest has 6 lights. An alternative has 4 lights and takes +2 min. Show it as Fewest lights?' },
  { id: 'l2', q: 'Fastest has 6 lights. An alternative has 3 lights and takes +5 min. Show it?' },
  { id: 'l3', q: 'Fastest has 10 lights. An alternative has 4 lights and takes +6 min. Show it?' },
  { id: 'l4', q: 'Fastest has 4 lights. An alternative has 2 lights and takes +4 min. Show it?' },
  { id: 'l5', q: 'Fastest has 3 lights. An alternative has 2 lights and takes +1 min. Show it?' },
  { id: 'c1', q: 'Fastest rides 1 km of 5 km in traffic on an arterial. An alternative is all park/shore paths, +3 min. Show it as Calm?' },
  { id: 'c2', q: 'Same, but the calm alternative takes +8 min.' },
  { id: 'c3', q: 'Fastest is mostly separated tracks beside arterials. An alternative is mostly quiet residential streets, +2 min. Show it?' },
  { id: 'c4', q: 'Fastest has 300 m in mixed traffic on a tram street, otherwise calm. An alternative avoids it, +2 min. Show it?' },
  { id: 'c5', q: 'Fastest is half park paths, half tracks beside arterials. An alternative is three-quarters park paths, +6 min. Show it?' },
]

async function renderIndex() {
  const trips = await api<Array<{ id: string; name: string; bucket: string; labelled: boolean }>>('/__sandbox/index')
  const saved = await api<{ answers?: Record<string, string> } | null>('/__sandbox/labels/_tradeoffs')
  const answers: Record<string, string> = saved?.answers ?? {}
  app.style.display = 'block'
  const list = el('table', {}, el('tr', {}, el('th', {}, 'trip'), el('th', {}, 'length'), el('th', {}, 'reviewed')))
  for (const t of trips.sort((a, b) => a.name.localeCompare(b.name))) {
    list.append(el('tr', {}, el('td', {}, el('a', { href: `?od=${t.id}` }, t.name)), el('td', {}, t.bucket), el('td', {}, t.labelled ? '✓' : '')))
  }
  const form = el('div')
  for (const t of TRADEOFFS) {
    const select = el('select', {}, el('option', { value: '' }, '–'), el('option', { value: 'yes' }, 'yes'), el('option', { value: 'no' }, 'no'))
    select.value = answers[t.id] ?? ''
    select.addEventListener('change', async () => {
      answers[t.id] = select.value
      await save('_tradeoffs', { answers })
    })
    form.append(el('p', {}, `${t.q} `, select))
  }
  app.append(
    el('div', { style: 'padding:16px;max-width:900px' },
      el('h1', {}, 'Route review'),
      el('p', { class: 'muted' }, `${trips.filter((t) => t.labelled).length} of ${trips.length} trips reviewed. Rubric: sandbox/rubric.md`),
      el('h2', {}, 'Trade-off questions (answer once)'),
      form,
      el('h2', {}, 'Trips'),
      list,
    ),
  )
}

// ── Trip review ───────────────────────────────────────────────────────────────────

async function renderTrip(id: string) {
  const [review, claude, existing] = await Promise.all([
    api<Review>(`/__sandbox/review/${id}`),
    api<ClaudeLabel | null>(`/__sandbox/claude/${id}`),
    api<UserLabel | null>(`/__sandbox/labels/${id}`),
  ])
  const letters = review.candidates.map((c) => c.letter)
  const blind = hash01(id) < 0.3
  const label: UserLabel = existing ?? {
    od: id,
    blind,
    revealed: false,
    calmRanking: blind || !claude ? letters : claude.calmRanking.filter((l) => letters.includes(l)),
    sameRoute: Object.fromEntries(review.similarPairs.map(([a, b]) => [`${a}-${b}`, true])),
    picks: blind || !claude ? { fewestLights: null, calm: null } : claude.picks,
    ratings: {},
    lightCounts: Object.fromEntries(review.candidates.map((c) => [c.letter, c.lights])),
    preferredSet: null,
    notes: '',
  }
  const showClaude = () => !!claude && (!label.blind || label.revealed)

  const mapDiv = el('div', { id: 'map' })
  const panel = el('div', { id: 'panel' })
  app.append(mapDiv, panel)
  const map = L.map(mapDiv)
  L.tileLayer(
    `https://cdn.digitransit.fi/map/v3/hsl-map-en/{z}/{x}/{y}.png?digitransit-subscription-key=${import.meta.env.VITE_DIGITRANSIT_API_KEY}`,
    { maxZoom: 19, tileSize: 512, zoomOffset: -1, attribution: '© HSL, OpenStreetMap contributors' },
  ).addTo(map)
  const color = (letter: string) => COLORS[letters.indexOf(letter) % COLORS.length]
  const lines = new Map<string, L.Polyline[]>()
  for (const c of review.candidates) {
    lines.set(c.letter, c.legs.map((leg) => L.polyline(polyline.decode(leg), { color: color(c.letter), weight: 3, opacity: 0.55 }).addTo(map)))
  }
  L.circleMarker(review.od.from, { radius: 7, color: '#16a34a', fillOpacity: 1 }).addTo(map)
  L.circleMarker(review.od.to, { radius: 7, color: '#dc2626', fillOpacity: 1 }).addTo(map)
  map.fitBounds(L.featureGroup([...lines.values()].flat()).getBounds().pad(0.05))
  const stopLayer = L.layerGroup().addTo(map)

  let active = letters[0]
  const focus = (letter: string) => {
    active = letter
    for (const [l, ls] of lines) for (const line of ls) line.setStyle({ weight: l === letter ? 6 : 3, opacity: l === letter ? 0.95 : 0.35 })
    lines.get(letter)?.forEach((line) => line.bringToFront())
    stopLayer.clearLayers()
    for (const s of review.candidates.find((c) => c.letter === letter)!.signalStops) {
      L.circleMarker(s, { radius: 5, color: '#1e1b4b', fillColor: '#facc15', fillOpacity: 1, weight: 2 }).addTo(stopLayer)
    }
    render()
  }

  const persist = () => save(id, label).then(() => (status.textContent = `saved ${new Date().toLocaleTimeString()}`))
  const status = el('span', { class: 'muted' })

  const render = () => {
    panel.replaceChildren()
    panel.append(
      el('div', {}, el('a', { href: '?' }, '← all trips')),
      el('h1', {}, review.od.name),
      el('p', { class: 'muted' }, label.blind && !label.revealed ? 'Blind trip: Claude’s grades appear after you save.' : 'Claude’s pre-grades are shown; change anything you disagree with.'),
      el('h2', {}, 'Calm ranking (best first) — click a route to show it and its light stops'),
    )
    label.calmRanking.forEach((letter, i) => {
      const c = review.candidates.find((x) => x.letter === letter)!
      const up = el('button', {}, '▲')
      const down = el('button', {}, '▼')
      up.onclick = (e) => {
        e.stopPropagation()
        if (i > 0) [label.calmRanking[i - 1], label.calmRanking[i]] = [label.calmRanking[i], label.calmRanking[i - 1]]
        render()
      }
      down.onclick = (e) => {
        e.stopPropagation()
        if (i < label.calmRanking.length - 1) [label.calmRanking[i + 1], label.calmRanking[i]] = [label.calmRanking[i], label.calmRanking[i + 1]]
        render()
      }
      const rating = el('select', {}, ...['', '1', '2', '3', '4', '5'].map((v) => el('option', { value: v }, v || '–')))
      rating.value = String(label.ratings[letter] ?? '')
      rating.onclick = (e) => e.stopPropagation()
      rating.onchange = () => {
        if (rating.value) label.ratings[letter] = Number(rating.value)
        else delete label.ratings[letter]
      }
      const lightsInput = el('input', { type: 'number', min: '0', style: 'width:48px' }) as HTMLInputElement
      lightsInput.value = String(label.lightCounts[letter] ?? c.lights)
      lightsInput.onclick = (e) => e.stopPropagation()
      lightsInput.onchange = () => (label.lightCounts[letter] = Number(lightsInput.value))
      const row = el('div', { class: `row${letter === active ? ' active' : ''}` },
        el('div', {},
          el('span', { class: 'swatch', style: `background:${color(letter)}` }),
          el('b', {}, letter), ` · ${Math.round(c.durationSec / 60)} min (+${Math.round(c.extraSec / 60)}) · ${(c.distanceM / 1000).toFixed(1)} km  `,
          up, down,
          el('span', { class: 'muted' }, '  calm 1–5: '), rating,
          el('span', { class: 'muted' }, '  real lights: '), lightsInput,
          el('span', { class: 'muted' }, ` (counted ${c.lights})`),
        ),
        el('ul', { class: 'dossier' }, ...c.dossier.slice(1).map((d) => el('li', {}, d))),
        ...(showClaude() ? [el('div', { class: 'claude' }, `Claude: tier ${claude!.tiers[letter] ?? '?'} — ${claude!.rationale[letter] ?? ''}`)] : []),
      )
      row.onclick = () => focus(letter)
      panel.append(row)
    })

    if (review.similarPairs.length > 0) {
      panel.append(el('h2', {}, 'Effectively the same route?'))
      for (const [a, b] of review.similarPairs) {
        const key = `${a}-${b}`
        const box = el('input', { type: 'checkbox' }) as HTMLInputElement
        box.checked = label.sameRoute[key] ?? true
        box.onchange = () => (label.sameRoute[key] = box.checked)
        panel.append(el('label', { style: 'display:block' }, box, ` ${a} and ${b} are the same route`))
      }
    }

    panel.append(el('h2', {}, 'Which route should get its own card?'))
    for (const role of ['fewestLights', 'calm'] as const) {
      const select = el('select', {}, el('option', { value: '' }, 'none — merge into Fastest'), ...letters.map((l) => el('option', { value: l }, l)))
      select.value = label.picks[role] ?? ''
      select.onchange = () => (label.picks[role] = select.value || null)
      panel.append(el('p', {}, role === 'fewestLights' ? 'Fewest lights: ' : 'Calm: ', select,
        ...(showClaude() ? [el('span', { class: 'muted' }, `  Claude: ${claude!.picks[role] ?? 'none'}`)] : [])))
    }

    panel.append(el('h2', {}, 'Which set of cards would you rather get?'))
    const legacyFirst = hash01(`${id}:ab`) < 0.5
    const sets = legacyFirst
      ? [['legacy', review.cardSets.legacy], ['new', review.cardSets.production]] as const
      : [['new', review.cardSets.production], ['legacy', review.cardSets.legacy]] as const
    sets.forEach(([key, set], i) => {
      const radio = el('input', { type: 'radio', name: 'set' }) as HTMLInputElement
      radio.checked = label.preferredSet === key
      radio.onchange = () => (label.preferredSet = key)
      panel.append(el('label', { style: 'display:block' }, radio, ` Option ${i + 1}: ${set.map((c) => `${c.letter} (${c.roles.join(', ')})`).join(' · ')}`))
    })
    const same = el('input', { type: 'radio', name: 'set' }) as HTMLInputElement
    same.checked = label.preferredSet === 'same'
    same.onchange = () => (label.preferredSet = 'same')
    panel.append(el('label', { style: 'display:block' }, same, ' No real difference'))

    const notes = el('textarea', { rows: '2', style: 'width:100%' }) as HTMLTextAreaElement
    notes.value = label.notes
    notes.onchange = () => (label.notes = notes.value)
    panel.append(el('h2', {}, 'Notes'), notes)

    const saveBtn = el('button', {}, 'Save')
    saveBtn.onclick = async () => {
      await persist()
      if (label.blind && !label.revealed) {
        label.revealed = true
        await persist()
        render()
      }
    }
    panel.append(el('div', { class: 'save' }, saveBtn, ' ', status))
  }
  focus(active)
}

const id = new URLSearchParams(location.search).get('od')
void (id ? renderTrip(id) : renderIndex())
