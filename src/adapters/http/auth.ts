/**
 * auth.ts — HTTP adapter for authentication endpoints.
 *
 * sign-in / sign-up / public-config are TOKENLESS (no Authorization header).
 * me / switch-company require a Bearer token.
 *
 * Snake_case → camelCase mapping happens here, at the HTTP boundary.
 *
 * Errors are surfaced as `ApiError` from ./client — callers detect 401 with
 * `err instanceof ApiError && err.status === 401`.
 */

import { ApiError } from './client'
import type { SignInResult, MeResult, PublicConfig, Company, SessionUser } from '../../core/domain/session'

// ── re-export so callers can import ApiError from one place ───────────────────
export { ApiError }

// ── TokenStorage interface (mirror of platform/index.ts — no import cycle) ────

export interface AuthTokenStorage {
  getToken(): string | null
  setToken(t: string): void | Promise<void>
  clearToken(): void | Promise<void>
}

// ── Raw backend shapes ────────────────────────────────────────────────────────

interface RawUser {
  id: string
  email: string
  name: string
  created_at?: string
}

interface RawSession {
  access: string
  expires_at?: string
}

interface RawCompany {
  id: string
  name: string
  industry?: string | null
  team_size?: string | null
  region?: string | null
  currency?: string
  pic_role?: string | null
}

interface RawMember {
  role: string
}

/** Raw shape of POST /auth/sign-in and POST /auth/switch-company response. */
interface RawSignInResponse {
  user: RawUser
  session: RawSession
  companies: RawCompany[]
}

/** Raw shape of POST /auth/sign-up response (no companies list). */
interface RawSignUpResponse {
  user: RawUser
  session: RawSession
}

/** Raw shape of GET /me response. */
interface RawMeResponse {
  user: RawUser
  member: RawMember
  company: RawCompany
  companies: RawCompany[]
}

/** Raw shape of GET /v1/public-config response. */
interface RawPublicConfig {
  mode: string
  signup_enabled: boolean
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapUser(r: RawUser): SessionUser {
  return { id: r.id, email: r.email, name: r.name }
}

function mapCompany(r: RawCompany): Company {
  return {
    id: r.id,
    name: r.name,
    industry: r.industry,
    teamSize: r.team_size,
    region: r.region,
    currency: r.currency ?? 'IDR',
    picRole: r.pic_role,
  }
}

// ── Tokenless fetch helper ────────────────────────────────────────────────────

/**
 * A plain `fetch` wrapper that deliberately sends NO Authorization header.
 * Used for sign-in, sign-up, and public-config so a stale token never blocks login.
 *
 * Throws `ApiError` on non-OK responses (same error contract as apiFetch).
 */
async function tokenlessFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  // Explicitly omit Authorization.
  delete headers['Authorization']

  const res = await fetch(url, { ...init, headers })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body && typeof body === 'object') {
        message =
          (body as Record<string, unknown>).detail as string ??
          (body as Record<string, unknown>).title as string ??
          message
      }
    } catch {
      // non-JSON body — keep the default message
    }
    throw new ApiError(res.status, message)
  }

  return res
}

// ── Bearer fetch helper ───────────────────────────────────────────────────────

/**
 * A plain `fetch` wrapper that sends Authorization: Bearer <token>.
 * Throws `ApiError` on non-OK responses.
 */
async function bearerFetch(
  url: string,
  getToken: () => string | null,
  init?: RequestInit,
): Promise<Response> {
  const token = getToken()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(url, { ...init, headers })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body && typeof body === 'object') {
        message =
          (body as Record<string, unknown>).detail as string ??
          (body as Record<string, unknown>).title as string ??
          message
      }
    } catch {
      // non-JSON body — keep the default message
    }
    throw new ApiError(res.status, message)
  }

  return res
}

// ── Adapter factory ───────────────────────────────────────────────────────────

export interface AuthAdapter {
  signIn(email: string, password: string): Promise<SignInResult>
  signUp(name: string, email: string, password: string): Promise<SignInResult>
  me(): Promise<MeResult>
  switchCompany(companyId: string): Promise<SignInResult>
  publicConfig(): Promise<PublicConfig>
}

/**
 * Creates the auth adapter.
 *
 * @param baseUrl       - e.g. "http://localhost:8000"
 * @param tokenStorage  - platform token storage (getToken / setToken / clearToken)
 */
export function createAuthAdapter(
  baseUrl: string,
  tokenStorage: AuthTokenStorage,
): AuthAdapter {
  const getToken = () => tokenStorage.getToken()

  return {
    /**
     * POST /auth/sign-in — TOKENLESS.
     * Stores the returned access token via tokenStorage.setToken.
     */
    async signIn(email: string, password: string): Promise<SignInResult> {
      const res = await tokenlessFetch(`${baseUrl}/auth/sign-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const raw: RawSignInResponse = await res.json()
      await tokenStorage.setToken(raw.session.access)
      const companies = raw.companies.map(mapCompany)
      return {
        user: mapUser(raw.user),
        companies,
        company: companies[0] ?? null,
        token: raw.session.access,
      }
    },

    /**
     * POST /auth/sign-up — TOKENLESS.
     * Sign-up does not return a companies list; companies is set to [].
     */
    async signUp(name: string, email: string, password: string): Promise<SignInResult> {
      const res = await tokenlessFetch(`${baseUrl}/auth/sign-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      const raw: RawSignUpResponse = await res.json()
      await tokenStorage.setToken(raw.session.access)
      return {
        user: mapUser(raw.user),
        companies: [],
        company: null,
        token: raw.session.access,
      }
    },

    /**
     * GET /me — Bearer.
     * Throws ApiError (status 401) when the token is invalid/expired.
     */
    async me(): Promise<MeResult> {
      const res = await bearerFetch(`${baseUrl}/me`, getToken)
      const raw: RawMeResponse = await res.json()
      return {
        user: mapUser(raw.user),
        role: raw.member.role,
        company: mapCompany(raw.company),
        companies: raw.companies.map(mapCompany),
      }
    },

    /**
     * POST /auth/switch-company — Bearer.
     * Stores the new access token returned by the backend.
     */
    async switchCompany(companyId: string): Promise<SignInResult> {
      const res = await bearerFetch(`${baseUrl}/auth/switch-company`, getToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      const raw: RawSignInResponse = await res.json()
      await tokenStorage.setToken(raw.session.access)
      const companies = raw.companies.map(mapCompany)
      return {
        user: mapUser(raw.user),
        companies,
        company: companies[0] ?? null,
        token: raw.session.access,
      }
    },

    /**
     * GET /v1/public-config — TOKENLESS.
     */
    async publicConfig(): Promise<PublicConfig> {
      const res = await tokenlessFetch(`${baseUrl}/v1/public-config`)
      const raw: RawPublicConfig = await res.json()
      return {
        mode: raw.mode,
        signupEnabled: raw.signup_enabled,
      }
    },
  }
}
