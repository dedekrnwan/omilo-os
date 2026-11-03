/**
 * e2e config — agentic end-to-end tests for omilo (web).
 *
 * Driver: Claude via @ai-sdk/anthropic. Provide ANTHROPIC_API_KEY one of two ways:
 *   1. export it in the SAME shell that runs `npx e2e run`, or
 *   2. put it in a `.env.local` (or `.env`) file at the repo root:
 *          ANTHROPIC_API_KEY=sk-ant-...
 * This config loads those files itself (e2e does NOT auto-load .env like Vite does)
 * and passes the key explicitly to the provider, so either way works.
 * Create the key in a Claude Console org linked to your Claude Max plan (Settings →
 * Billing) so it draws on your subscription credits. Swap the model id to
 * claude-sonnet-4-6 (≈40% cheaper) or claude-haiku-4-5 to cut cost.
 *
 * App under test: the running omilo web dev server at :5173. Start the full stack
 * first in another terminal with `make dev` (DB + migrate + seed + API :8000 + web
 * :5173) so the app runs in HTTP mode and the seeded demo account exists.
 *
 * Run:  npx e2e run           ·  npx e2e run --tag chat   ·  e2e list (free dry-run)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { E2EConfig } from 'e2e'
import { web } from '@e2e-dev/web'
import { createAnthropic } from '@ai-sdk/anthropic'

// ── load repo-root .env / .env.local (e2e doesn't do this for us) ─────────────
const root = fileURLToPath(new URL('.', import.meta.url))

function readEnvFile(name: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const raw of readFileSync(root + name, 'utf8').split('\n')) {
      const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      out[m[1]] = v
    }
  } catch {
    /* file absent — fine */
  }
  return out
}

const fileEnv = { ...readEnvFile('.env'), ...readEnvFile('.env.local') }
const anthropicApiKey = process.env.ANTHROPIC_API_KEY || fileEnv.ANTHROPIC_API_KEY

const anthropic = createAnthropic({ apiKey: anthropicApiKey })

export default {
  targets: [
    {
      engine: web(),
      // Connect to the already-running dev server (start it with `make dev`).
      app: { url: 'http://localhost:5173' },
    },
  ],

  // The model behind every agent.* step.
  agents: {
    default: {
      model: anthropic('claude-opus-4-8'),
      system:
        'You are a meticulous QA engineer testing Omilo, an AI-staff web app. ' +
        'Drive the UI to reach the stated goal, then stop. Prefer visible, ' +
        'semantic controls (buttons, links, headings, form fields by label). ' +
        'Do not invent data beyond what the goal provides. If a goal cannot be ' +
        'completed, fail clearly rather than guessing.',
    },
  },

  // Sign-in credentials for the seeded demo account (see apps/api/omilo/seed).
  // Override per-run with E2E_USER_DEMO_USERNAME / E2E_USER_DEMO_PASSWORD.
  credentials: {
    demo: {
      username: process.env.OMILO_DEMO_EMAIL ?? fileEnv.OMILO_DEMO_EMAIL ?? 'demo@omilo.app',
      password:
        process.env.OMILO_DEMO_PASSWORD ?? fileEnv.OMILO_DEMO_PASSWORD ?? 'demo-password-1234',
    },
  },

  timeout: 180_000,
  retries: 1,
} satisfies E2EConfig
