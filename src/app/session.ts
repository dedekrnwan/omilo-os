/**
 * session.ts — zustand store for the authenticated user session.
 *
 * Responsibilities:
 *   - `hydrate()` — called once on app boot; resolves auth state from
 *     token storage (HTTP mode) or sets a synthetic demo session (mock mode).
 *   - `applySignIn(result)` — called after a successful sign-in or company
 *     switch to push the new session into the store.
 *   - `signOut()` — clears token and resets to anon state.
 *
 * The auth adapter and token storage are built from `import.meta.env` the
 * same way ReposProvider does, but can be overridden via `_overrideAdapter`
 * (for tests) and `_overrideTokenStorage` (for tests) before hydrate() runs.
 */

import { create } from 'zustand'
import type { AuthAdapter, AuthTokenStorage } from '../adapters/http/auth'
import { createAuthAdapter } from '../adapters/http/auth'
import { platform } from '../platform'
import type { SessionUser, Company, SignInResult, MeResult } from '../core/domain/session'

// ── Injectable overrides (for tests) ─────────────────────────────────────────

let _adapterOverride: AuthAdapter | null = null
let _tokenStorageOverride: AuthTokenStorage | null = null

/**
 * Override the auth adapter used by the session store.
 * Call before `hydrate()` — typically in test beforeEach / beforeAll.
 */
export function _overrideAdapter(adapter: AuthAdapter | null): void {
  _adapterOverride = adapter
}

/**
 * Override the token storage used by the session store.
 * Call before `hydrate()` — typically in test beforeEach / beforeAll.
 */
export function _overrideTokenStorage(ts: AuthTokenStorage | null): void {
  _tokenStorageOverride = ts
}

// ── Factory helpers ───────────────────────────────────────────────────────────

function getTokenStorage(): AuthTokenStorage {
  if (_tokenStorageOverride) return _tokenStorageOverride
  return platform.tokenStorage
}

function getAdapter(): AuthAdapter {
  if (_adapterOverride) return _adapterOverride
  const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
  return createAuthAdapter(baseUrl, getTokenStorage())
}

// ── Demo fixture (mock mode only) ─────────────────────────────────────────────

const DEMO_USER: SessionUser = { id: 'usr-demo', email: 'demo@omilo.app', name: 'Demo' }
// Mock demo company is always onboarded so mock mode never triggers the onboarding gate.
const DEMO_COMPANY: Company = { id: 'cmp-demo', name: 'Demo Workspace', currency: 'IDR', onboarded: true }

// ── Store ─────────────────────────────────────────────────────────────────────

export interface SessionState {
  /** Loading: hydration in progress. Authed: valid token + user. Anon: no session. */
  status: 'loading' | 'authed' | 'anon'
  user: SessionUser | null
  company: Company | null
  companies: Company[]
  /** Server-reported deployment mode ('local' | 'cloud' | …). */
  mode: string | null
  /** Whether the backend is configured for Google OAuth. False in mock mode and unconfigured local. */
  googleEnabled: boolean

  /**
   * Boot-time hydration. Resolves auth state:
   *   - Mock mode: synthetic demo session; zero network calls.
   *   - HTTP mode: fetch publicConfig → if token present, call /me; on failure clear token.
   */
  hydrate(): Promise<void>

  /**
   * Apply a successful sign-in / sign-up / company-switch result.
   * Sets status to 'authed' and updates user / company / companies.
   */
  applySignIn(result: SignInResult): void

  /**
   * Apply a fresh /me result (e.g. after PATCH /v1/me) into the session so the
   * Rail / avatar reflect the updated user and company context immediately.
   * Does not touch `status` or the stored token.
   */
  applyMe(result: MeResult): void

  /**
   * Sign out: clear the stored token and reset to anon state (preserves `mode`).
   */
  signOut(): void
}

export const useSession = create<SessionState>()((set, get) => ({
  status: 'loading',
  user: null,
  company: null,
  companies: [],
  mode: null,
  googleEnabled: false,

  async hydrate() {
    const isMock = import.meta.env.VITE_USE_HTTP !== '1'

    if (isMock) {
      // Mock mode: set synthetic authed demo session, no network call.
      set({
        status: 'authed',
        user: DEMO_USER,
        company: DEMO_COMPANY,
        companies: [DEMO_COMPANY],
        mode: 'local',
      })
      return
    }

    // HTTP mode.
    const adapter = getAdapter()
    const tokenStorage = getTokenStorage()

    // 1. Fetch public config to get the deployment mode and feature flags.
    let serverMode = get().mode
    try {
      const cfg = await adapter.publicConfig()
      serverMode = cfg.mode
      set({ mode: serverMode, googleEnabled: cfg.googleEnabled })
    } catch {
      // publicConfig failure is non-fatal — continue to token check.
    }

    // 2. Check for an existing token.
    const token = tokenStorage.getToken()
    if (!token) {
      set({ status: 'anon' })
      return
    }

    // 3. Validate the token by calling /me.
    try {
      const meResult = await adapter.me()
      set({
        status: 'authed',
        user: meResult.user,
        company: meResult.company,
        companies: meResult.companies,
      })
    } catch {
      // Token invalid or network error → clear token and set anon.
      await tokenStorage.clearToken()
      set({ status: 'anon' })
    }
  },

  applySignIn(result: SignInResult) {
    set({
      status: 'authed',
      user: result.user,
      company: result.company ?? result.companies[0] ?? null,
      companies: result.companies,
    })
  },

  applyMe(result: MeResult) {
    set({
      user: result.user,
      company: result.company,
      companies: result.companies,
    })
  },

  signOut() {
    const tokenStorage = getTokenStorage()
    void tokenStorage.clearToken()
    set({ status: 'anon', user: null, company: null, companies: [] })
  },
}))
