import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { config as dotenvConfig } from 'dotenv'
import type { Plugin } from 'vite'
import type { ServerResponse } from 'node:http'

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), vercelApiDevPlugin()],
  build: {
    chunkSizeWarningLimit: 700,
  },
})
