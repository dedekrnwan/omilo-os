/**
 * session.test.tsx — unit tests for useSession store (hydrate, applySignIn, signOut).
 *
 * Adapter and token storage are injected via _overrideAdapter / _overrideTokenStorage
 * so no real network calls are made. VITE_USE_HTTP is controlled via vi.stubEnv.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AuthAdapter, AuthTokenStorage } from '../adapters/http/auth'
import type { MeResult, PublicConfig } from '../core/domain/session'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTokenStorage(initial: string | null = null): AuthTokenStorage & { _token: string | null } {
  const ts = {
    _token: initial,
    getToken() { return ts._token },
    setToken(t: string) { ts._token = t },
    clearToken() { ts._token = null },
  }
  return ts
}

function makeAdapter(overrides: Partial<AuthAdapter> = {}): AuthAdapter {
  return {
    signIn: vi.fn(),
    signUp: vi.fn(),
    me: vi.fn(),
    switchCompany: vi.fn(),
    publicConfig: vi.fn(),
    ...overrides,
  } as AuthAdapter
}

const DEMO_ME: MeResult = {
  user: { id: 'u-http', email: 'http@test.com', name: 'HTTP User' },
  role: 'admin',
  company: { id: 'cmp-http', name: 'HTTP Corp', currency: 'USD' },
  companies: [{ id: 'cmp-http', name: 'HTTP Corp', currency: 'USD' }],
}

const DEMO_CONFIG: PublicConfig = { mode: 'cloud', signupEnabled: true }

// ── module reset helpers ──────────────────────────────────────────────────────

/**
 * Fresh-import the session module so each test starts with a clean store.
 * Uses vi.resetModules() to avoid the singleton carrying state between tests.
 */
async function freshSession() {
  vi.resetModules()
  return import('./session')
}

// ── setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

// ── Mock mode ─────────────────────────────────────────────────────────────────

describe('hydrate() — mock mode (VITE_USE_HTTP !== "1")', () => {
  test('sets status authed with demo session and ZERO fetch calls', async () => {
    // VITE_USE_HTTP not set (default) → mock mode
    vi.stubEnv('VITE_USE_HTTP', '')
    vi.stubGlobal('fetch', vi.fn())

    const session = await freshSession()
    const { useSession, _overrideAdapter, _overrideTokenStorage } = session

    _overrideAdapter(null)
    _overrideTokenStorage(null)

    await useSession.getState().hydrate()

    const state = useSession.getState()
    expect(state.status).toBe('authed')
    expect(state.user?.email).toBe('demo@omilo.app')
    expect(state.user?.id).toBe('usr-demo')
    expect(state.company?.id).toBe('cmp-demo')
    expect(state.companies).toHaveLength(1)
    expect(state.mode).toBe('local')

    // Zero fetch calls in mock mode
    expect(vi.mocked(fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
})

// ── HTTP mode — no token ──────────────────────────────────────────────────────

describe('hydrate() — HTTP mode, no stored token', () => {
  test('sets status anon without calling me()', async () => {
    vi.stubEnv('VITE_USE_HTTP', '1')

    const session = await freshSession()
    const { useSession, _overrideAdapter, _overrideTokenStorage } = session

    const meStub = vi.fn()
    const adapter = makeAdapter({
      publicConfig: vi.fn().mockResolvedValue(DEMO_CONFIG),
      me: meStub,
    })
    const ts = makeTokenStorage(null) // no token

    _overrideAdapter(adapter)
    _overrideTokenStorage(ts)

    await useSession.getState().hydrate()

    const state = useSession.getState()
    expect(state.status).toBe('anon')
    expect(state.user).toBeNull()
    expect(meStub).not.toHaveBeenCalled()
    expect(state.mode).toBe('cloud')
  })
})

// ── HTTP mode — token present, /me succeeds ───────────────────────────────────

describe('hydrate() — HTTP mode, token present, /me succeeds', () => {
  test('sets status authed with company and companies from /me', async () => {
    vi.stubEnv('VITE_USE_HTTP', '1')

    const session = await freshSession()
    const { useSession, _overrideAdapter, _overrideTokenStorage } = session

    const adapter = makeAdapter({
      publicConfig: vi.fn().mockResolvedValue(DEMO_CONFIG),
      me: vi.fn().mockResolvedValue(DEMO_ME),
    })
    const ts = makeTokenStorage('valid-jwt')

    _overrideAdapter(adapter)
    _overrideTokenStorage(ts)

    await useSession.getState().hydrate()

    const state = useSession.getState()
    expect(state.status).toBe('authed')
    expect(state.user?.id).toBe('u-http')
    expect(state.company?.id).toBe('cmp-http')
    expect(state.companies).toHaveLength(1)
    expect(state.mode).toBe('cloud')
  })
})

// ── HTTP mode — token present, /me returns 401 ────────────────────────────────

describe('hydrate() — HTTP mode, token present, /me 401', () => {
  test('sets status anon AND clears the stored token', async () => {
    vi.stubEnv('VITE_USE_HTTP', '1')

    const session = await freshSession()
    const { useSession, _overrideAdapter, _overrideTokenStorage } = session
    const { ApiError } = await import('../adapters/http/auth')

    const adapter = makeAdapter({
      publicConfig: vi.fn().mockResolvedValue(DEMO_CONFIG),
      me: vi.fn().mockRejectedValue(new ApiError(401, 'Not authenticated')),
    })
    const ts = makeTokenStorage('expired-jwt')

    _overrideAdapter(adapter)
    _overrideTokenStorage(ts)

    await useSession.getState().hydrate()

    const state = useSession.getState()
    expect(state.status).toBe('anon')
    expect(state.user).toBeNull()
    // Token must have been cleared
    expect(ts._token).toBeNull()
  })
})

// ── applySignIn ───────────────────────────────────────────────────────────────

describe('applySignIn', () => {
  test('sets authed with user and company from result', async () => {
    vi.stubEnv('VITE_USE_HTTP', '')
    const { useSession } = await freshSession()

    useSession.getState().applySignIn({
      user: { id: 'u-si', email: 'si@test.com', name: 'SI User' },
      company: { id: 'cmp-si', name: 'SI Corp', currency: 'IDR' },
      companies: [{ id: 'cmp-si', name: 'SI Corp', currency: 'IDR' }],
      token: 'tok-si',
    })

    const state = useSession.getState()
    expect(state.status).toBe('authed')
    expect(state.user?.email).toBe('si@test.com')
    expect(state.company?.id).toBe('cmp-si')
    expect(state.companies).toHaveLength(1)
  })

  test('uses companies[0] as company when result.company is null', async () => {
    vi.stubEnv('VITE_USE_HTTP', '')
    const { useSession } = await freshSession()

    useSession.getState().applySignIn({
      user: { id: 'u-fb', email: 'fb@test.com', name: 'FB User' },
      company: null,
      companies: [{ id: 'cmp-fallback', name: 'Fallback Corp', currency: 'SGD' }],
      token: 'tok-fb',
    })

    const state = useSession.getState()
    expect(state.company?.id).toBe('cmp-fallback')
  })
})

// ── signOut ───────────────────────────────────────────────────────────────────

describe('signOut', () => {
  test('resets to anon state and clears token, preserves mode', async () => {
    vi.stubEnv('VITE_USE_HTTP', '1')

    const session = await freshSession()
    const { useSession, _overrideAdapter, _overrideTokenStorage } = session

    const adapter = makeAdapter({
      publicConfig: vi.fn().mockResolvedValue(DEMO_CONFIG),
      me: vi.fn().mockResolvedValue(DEMO_ME),
    })
    const ts = makeTokenStorage('valid-jwt')

    _overrideAdapter(adapter)
    _overrideTokenStorage(ts)

    await useSession.getState().hydrate()
    expect(useSession.getState().status).toBe('authed')
    expect(useSession.getState().mode).toBe('cloud')

    useSession.getState().signOut()

    const state = useSession.getState()
    expect(state.status).toBe('anon')
    expect(state.user).toBeNull()
    expect(state.company).toBeNull()
    expect(state.companies).toHaveLength(0)
    // mode is preserved after sign-out
    expect(state.mode).toBe('cloud')
    expect(ts._token).toBeNull()
  })
})
