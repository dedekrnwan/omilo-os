/**
 * auth.test.ts — unit tests for createAuthAdapter.
 *
 * All network calls are intercepted via vi.stubGlobal('fetch', ...).
 * No real HTTP connections are made.
 */

import { describe, test, expect, vi, afterEach } from 'vitest'
import { createAuthAdapter, ApiError } from './auth'
import type { AuthTokenStorage } from './auth'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a simple in-memory token storage stub. */
function makeTokenStorage(initial: string | null = null): AuthTokenStorage & { _token: string | null } {
  const storage = {
    _token: initial,
    getToken() { return storage._token },
    setToken(t: string) { storage._token = t },
    clearToken() { storage._token = null },
  }
  return storage
}

/** Build a fetch stub that returns the given body as JSON with the given status. */
function makeFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

const BASE = 'http://localhost:8000'

// ── setup / teardown ──────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── signIn ────────────────────────────────────────────────────────────────────

describe('signIn', () => {
  test('POSTs to /auth/sign-in WITHOUT Authorization header', async () => {
    const rawCompany = { id: 'c1', name: 'Acme', team_size: 'small', pic_role: 'ceo', currency: 'IDR' }
    const stub = makeFetch({
      user: { id: 'u1', email: 'a@b.com', name: 'Alice' },
      session: { access: 'tok-abc', expires_at: '2099-01-01' },
      companies: [rawCompany],
    })
    vi.stubGlobal('fetch', stub)

    const ts = makeTokenStorage()
    const adapter = createAuthAdapter(BASE, ts)

    const result = await adapter.signIn('a@b.com', 'secret')

    // Verify the correct URL was called
    expect(stub).toHaveBeenCalledOnce()
    const [url, init] = stub.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/auth/sign-in`)
    expect(init.method).toBe('POST')

    // CRITICAL: no Authorization header must be sent
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()

    // Token stored
    expect(ts._token).toBe('tok-abc')

    // camelCase mapping
    expect(result.user).toEqual({ id: 'u1', email: 'a@b.com', name: 'Alice' })
    expect(result.token).toBe('tok-abc')
    expect(result.companies).toHaveLength(1)
    expect(result.companies[0]).toMatchObject({
      id: 'c1',
      name: 'Acme',
      teamSize: 'small',   // snake → camel
      picRole: 'ceo',      // snake → camel
      currency: 'IDR',
    })
    // company = companies[0]
    expect(result.company).toEqual(result.companies[0])
  })

  test('company is null when sign-in returns empty companies list', async () => {
    const stub = makeFetch({
      user: { id: 'u2', email: 'b@c.com', name: 'Bob' },
      session: { access: 'tok-bob' },
      companies: [],
    })
    vi.stubGlobal('fetch', stub)

    const adapter = createAuthAdapter(BASE, makeTokenStorage())
    const result = await adapter.signIn('b@c.com', 'pass')
    expect(result.companies).toHaveLength(0)
    expect(result.company).toBeNull()
  })
})

// ── signUp ────────────────────────────────────────────────────────────────────

describe('signUp', () => {
  test('POSTs to /auth/sign-up WITHOUT Authorization header and returns empty companies', async () => {
    const stub = makeFetch({
      user: { id: 'u3', email: 'c@d.com', name: 'Carol' },
      session: { access: 'tok-carol' },
    })
    vi.stubGlobal('fetch', stub)

    const ts = makeTokenStorage()
    const adapter = createAuthAdapter(BASE, ts)

    const result = await adapter.signUp('Carol', 'c@d.com', 'pw123')

    expect(stub).toHaveBeenCalledOnce()
    const [url, init] = stub.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/auth/sign-up`)

    // No Authorization header
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()

    // Token stored
    expect(ts._token).toBe('tok-carol')

    // companies is always [] for sign-up
    expect(result.companies).toHaveLength(0)
    expect(result.company).toBeNull()
    expect(result.token).toBe('tok-carol')
  })
})

// ── me ────────────────────────────────────────────────────────────────────────

describe('me', () => {
  test('sends Bearer token and maps snake_case fields to camelCase', async () => {
    const rawCompany = {
      id: 'cmp-1',
      name: 'Beta Corp',
      team_size: 'medium',
      pic_role: 'cto',
      region: 'SEA',
      currency: 'USD',
    }
    const stub = makeFetch({
      user: { id: 'u4', email: 'd@e.com', name: 'Dave' },
      member: { role: 'admin' },
      company: rawCompany,
      companies: [rawCompany],
    })
    vi.stubGlobal('fetch', stub)

    const ts = makeTokenStorage('my-bearer-token')
    const adapter = createAuthAdapter(BASE, ts)

    const result = await adapter.me()

    expect(stub).toHaveBeenCalledOnce()
    const [url, init] = stub.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/me`)

    // Bearer header must be present
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.['Authorization']).toBe('Bearer my-bearer-token')

    // camelCase mapping
    expect(result.user).toEqual({ id: 'u4', email: 'd@e.com', name: 'Dave' })
    expect(result.role).toBe('admin')
    expect(result.company).toMatchObject({
      id: 'cmp-1',
      name: 'Beta Corp',
      teamSize: 'medium',  // snake → camel
      picRole: 'cto',      // snake → camel
      region: 'SEA',
      currency: 'USD',
    })
    expect(result.companies).toHaveLength(1)
  })

  test('throws ApiError with status 401 on unauthorized response', async () => {
    const stub = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ detail: 'Not authenticated' }),
    })
    vi.stubGlobal('fetch', stub)

    const adapter = createAuthAdapter(BASE, makeTokenStorage('bad-token'))

    await expect(adapter.me()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    })
  })

  test('me() error is an instance of ApiError', async () => {
    const stub = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({}),
    })
    vi.stubGlobal('fetch', stub)

    const adapter = createAuthAdapter(BASE, makeTokenStorage('expired'))

    try {
      await adapter.me()
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(401)
    }
  })
})

// ── switchCompany ─────────────────────────────────────────────────────────────

describe('switchCompany', () => {
  test('POSTs with Bearer, stores new token, returns mapped SignInResult', async () => {
    const stub = makeFetch({
      user: { id: 'u5', email: 'e@f.com', name: 'Eve' },
      session: { access: 'tok-switched' },
      companies: [{ id: 'cmp-2', name: 'New Corp', currency: 'SGD' }],
    })
    vi.stubGlobal('fetch', stub)

    const ts = makeTokenStorage('old-token')
    const adapter = createAuthAdapter(BASE, ts)

    const result = await adapter.switchCompany('cmp-2')

    const [url, init] = stub.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/auth/switch-company`)
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.['Authorization']).toBe('Bearer old-token')

    // Backend expects snake_case `company_id` (cf. SwitchCompanyRequest) — not camelCase.
    expect(JSON.parse(init?.body as string)).toEqual({ company_id: 'cmp-2' })

    // New token stored
    expect(ts._token).toBe('tok-switched')
    expect(result.token).toBe('tok-switched')
    expect(result.companies[0]?.name).toBe('New Corp')
    expect(result.company?.id).toBe('cmp-2')
  })
})

// ── publicConfig ──────────────────────────────────────────────────────────────

describe('publicConfig', () => {
  test('GETs /v1/public-config WITHOUT Authorization header and maps signup_enabled', async () => {
    const stub = makeFetch({ mode: 'cloud', signup_enabled: true })
    vi.stubGlobal('fetch', stub)

    const ts = makeTokenStorage('has-token') // token present but must NOT be sent
    const adapter = createAuthAdapter(BASE, ts)

    const result = await adapter.publicConfig()

    const [url, init] = stub.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/public-config`)

    // No Authorization header
    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.['Authorization']).toBeUndefined()

    expect(result.mode).toBe('cloud')
    expect(result.signupEnabled).toBe(true)    // snake → camel
  })
})
