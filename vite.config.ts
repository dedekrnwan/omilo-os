import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Dev server only (ignored by `vite build` / vitest): proxy the API paths to the
  // local backend so `make dev` runs a wired full stack with no CORS. The frontend
  // uses VITE_API_URL=http://localhost:5173 (this dev server) and these routes are
  // forwarded to the API on :8000; `/v1/ws` upgrades as a WebSocket (ws: true).
  server: {
    proxy: {
      // All API routes (auth, me, company, etc.) are mounted under /v1 on the
      // backend, so this single entry covers everything; /v1/ws upgrades as a
      // WebSocket (ws: true).
      '/v1': { target: 'http://localhost:8000', changeOrigin: true, ws: true },
    },
  },
})
