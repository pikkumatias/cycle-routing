import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { config as dotenvConfig } from 'dotenv'
import type { Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'

// Load server-side env vars (DIGITRANSIT_API_KEY etc.) for the API dev middleware.
// Vite only exposes VITE_* vars to the client bundle; dotenv populates process.env here.
dotenvConfig({ path: '.env.local' })

function vercelApiDevPlugin(): Plugin {
  return {
    name: 'vercel-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res: ServerResponse, next) => {
        const url = req.url ?? '/'
        if (!url.startsWith('/api/')) return next()

        const qIdx = url.indexOf('?')
        const pathPart = qIdx === -1 ? url : url.slice(0, qIdx)
        const queryStr = qIdx === -1 ? '' : url.slice(qIdx + 1)
        const handlerName = pathPart.slice('/api/'.length)
        if (!handlerName) return next()

        try {
          const mod = await server.ssrLoadModule(`/api/${handlerName}.ts`)
          if (typeof mod.default !== 'function') return next()

          // Parse query params
          const query: Record<string, string | string[]> = {}
          if (queryStr) {
            new URLSearchParams(queryStr).forEach((value, key) => {
              const existing = query[key]
              if (existing === undefined) {
                query[key] = value
              } else if (Array.isArray(existing)) {
                existing.push(value)
              } else {
                query[key] = [existing, value]
              }
            })
          }

          // Buffer request body for POST/PUT
          let body: unknown
          if (req.method === 'POST' || req.method === 'PUT') {
            body = await new Promise((resolve, reject) => {
              let raw = ''
              req.on('data', (chunk: { toString(): string }) => {
                raw += chunk.toString()
              })
              req.on('end', () => {
                try {
                  resolve(JSON.parse(raw))
                } catch {
                  resolve(raw)
                }
              })
              req.on('error', reject)
            })
          }

          const mockReq = { method: req.method, query, body }
          let statusCode = 200
          const mockRes = {
            setHeader(name: string, value: string) {
              res.setHeader(name, value)
              return mockRes
            },
            status(code: number) {
              statusCode = code
              return mockRes
            },
            json(data: unknown) {
              res.writeHead(statusCode, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(data))
              return mockRes
            },
          }

          await mod.default(mockReq, mockRes)
        } catch (err) {
          console.error(`[api-dev] /api/${handlerName}:`, err)
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Internal server error' }))
          }
        }
      })
    },
  }
}

/**
 * Dev-only endpoints for the calibration sandbox's review page (sandbox/review/), under
 * /__sandbox/. Reads sandbox/out/review/*.json and sandbox/labels/claude/*.json, and saves
 * the user's labels to sandbox/labels/user/<od>.json. Never part of a build.
 */
function sandboxReviewDevPlugin(): Plugin {
  const SAFE_ID = /^[a-z0-9_-]+$/
  const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as unknown
  return {
    name: 'sandbox-review',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res: ServerResponse, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith('/__sandbox/')) return next()
        const send = (status: number, data: unknown) => {
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(data))
        }
        const [kind, id] = url.slice('/__sandbox/'.length).split('/')
        if (id !== undefined && !SAFE_ID.test(id)) return send(400, { error: 'bad id' })
        try {
          if (kind === 'index' && req.method === 'GET') {
            const files = (await readdir('sandbox/out/review')).filter((f) => f.endsWith('.json'))
            const labelled = new Set(await readdir('sandbox/labels/user').catch(() => [] as string[]))
            const trips = await Promise.all(
              files.map(async (f) => {
                const data = (await readJson(`sandbox/out/review/${f}`)) as { od: { id: string; name: string; bucket: string } }
                return { ...data.od, labelled: labelled.has(f) }
              }),
            )
            return send(200, trips)
          }
          if (kind === 'review' && id && req.method === 'GET') return send(200, await readJson(`sandbox/out/review/${id}.json`))
          if (kind === 'claude' && id && req.method === 'GET') {
            return send(200, await readJson(`sandbox/labels/claude/${id}.json`).catch(() => null))
          }
          if (kind === 'labels' && id && req.method === 'GET') {
            return send(200, await readJson(`sandbox/labels/user/${id}.json`).catch(() => null))
          }
          if (kind === 'labels' && id && req.method === 'POST') {
            const body = await new Promise<string>((resolve, reject) => {
              let raw = ''
              req.on('data', (chunk: { toString(): string }) => (raw += chunk.toString()))
              req.on('end', () => resolve(raw))
              req.on('error', reject)
            })
            const label = { ...(JSON.parse(body) as object), savedAt: new Date().toISOString() }
            await mkdir('sandbox/labels/user', { recursive: true })
            await writeFile(`sandbox/labels/user/${id}.json`, JSON.stringify(label, null, 1) + '\n')
            return send(200, { ok: true })
          }
          return send(404, { error: 'not found' })
        } catch (err) {
          return send(500, { error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vercelApiDevPlugin(), sandboxReviewDevPlugin()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split large, rarely-changing vendors into their own chunks so app-code
        // edits don't invalidate them in the browser cache on repeat visits.
        // react + react-dom + scheduler must stay in one chunk to avoid load-order
        // bugs where react-dom initializes before React's runtime.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // Keep all of MUI + Emotion together first. Emotion ships an
          // `@emotion/react` package whose path matches the broad `/react/`
          // test below; if it leaked into the react chunk it would create a
          // circular mui <-> react chunk and a load-order TDZ crash.
          if (id.includes('/@mui/') || id.includes('/@emotion/')) return 'mui'
          if (
            id.includes('/react-dom/') ||
            id.includes('/react/') ||
            id.includes('/scheduler/')
          ) return 'react'
          if (id.includes('leaflet')) return 'leaflet'
          if (id.includes('i18next')) return 'i18n'
        },
      },
    },
  },
})
