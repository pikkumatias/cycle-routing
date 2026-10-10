import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

// MapLibre 6 loads its worker from a URL next to its own module, which Vite's
// dependency pre-bundling (dev) and chunking (build) both move. Point it at
// the self-contained worker file explicitly; Vite serves or emits it as-is.
setWorkerUrl(workerUrl)
