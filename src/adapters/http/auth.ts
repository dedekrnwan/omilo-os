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
  /** P13 onboarding gate — backend CompanyOut field. */
  onboarded?: boolean
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

/** Raw shape of GET /v1/public-config response. NOTE: this endpoint emits
 * camelCase keys (PublicConfigOut has no alias), unlike the snake_case bodies
 * elsewhere — so we read camelCase here. */
interface RawPublicConfig {
  mode: string
  signupEnabled: boolean
  googleEnabled?: boolean
}

/** Raw shape of GET /v1/auth/invite?token= response. */
interface RawInvitePreview {
  email: string
  role: string
  channels: string | null
  company_name: string
  inviter_name: string | null
  expires_at: string
  has_account: boolean
}

/** Preview of a pending invite (for the accept page). */
export interface InvitePreview {
  email: string
  role: string
  channels: string | null
  companyName: string
  inviterName: string | null
  expiresAt: string
  hasAccount: boolean
}

/** Sign-in returns this instead of a session when 2FA is enabled. */
export interface TwoFactorChallenge {
  twoFactorRequired: true
  email: string
}

/** True when a sign-in outcome is a 2FA challenge rather than a full session. */
export function isTwoFactorChallenge(
  r: SignInResult | TwoFactorChallenge,
): r is TwoFactorChallenge {
  return (r as TwoFactorChallenge).twoFactorRequired === true
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapUser(r: RawUser): SessionUser {
  return { id: r.id, email: r.email, name: r.name }
}

function mapInvite(r: RawInvitePreview): InvitePreview {
  return {
    email: r.email,
    role: r.role,
    channels: r.channels,
    companyName: r.company_name,
    inviterName: r.inviter_name,
    expiresAt: r.expires_at,
    hasAccount: r.has_account,
  }
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
    onboarded: r.onboarded ?? false,
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
  signIn(email: string, password: string): Promise<SignInResult | TwoFactorChallenge>
  signUp(name: string, email: string, password: string): Promise<SignInResult>
  me(): Promise<MeResult>
  switchCompany(companyId: string): Promise<SignInResult>
  publicConfig(): Promise<PublicConfig>

  // ── email-based flows ──
  /** Email a 6-digit sign-in code ("email me a code"). */
  requestEmailCode(email: string): Promise<void>
  /** Exchange a sign-in code for a session. */
  verifyEmailCode(email: string, code: string): Promise<SignInResult>
  /** Email a 6-digit address-verification code. */
  requestVerifyEmail(email: string): Promise<void>
  /** Confirm the email address with its code. */
  confirmEmail(email: string, code: string): Promise<void>
  /** Email a password-reset link. Always resolves (no account enumeration). */
  forgotPassword(email: string): Promise<void>
  /** Set a new password from a reset token; returns a fresh session. */
  resetPassword(token: string, password: string): Promise<SignInResult>
  /** Finish a 2FA sign-in with the emailed code. */
  twoFactorVerify(email: string, code: string): Promise<SignInResult>
  /** Preview a pending invite by token. */
  getInvite(token: string): Promise<InvitePreview>
  /** Accept an invite (new users supply name + password). */
  acceptInvite(token: string, name?: string, password?: string): Promise<SignInResult>
  /** Create an invite for the signed-in company (owner/admin). */
  createInvite(email: string, role: string, channels?: string): Promise<void>
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

  /** Map a RawSignInResponse, store the token, and return a SignInResult. */
  async function consumeSession(raw: RawSignInResponse): Promise<SignInResult> {
    await tokenStorage.setToken(raw.session.access)
    const companies = raw.companies.map(mapCompany)
    return {
      user: mapUser(raw.user),
      companies,
      company: companies[0] ?? null,
      token: raw.session.access,
    }
  }

  const jsonPost = (path: string, body: unknown) =>
    tokenlessFetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  return {
    /**
     * POST /auth/sign-in — TOKENLESS.
     * Stores the returned access token, UNLESS 2FA is required — then returns a
     * TwoFactorChallenge and stores nothing (the token comes from /two-factor/verify).
     */
    async signIn(email: string, password: string): Promise<SignInResult | TwoFactorChallenge> {
      const res = await jsonPost('/v1/auth/sign-in', { email, password })
      const raw = (await res.json()) as RawSignInResponse & { two_factor_required?: boolean; email?: string }
      if (raw.two_factor_required) {
        return { twoFactorRequired: true, email: raw.email ?? email }
      }
      return consumeSession(raw)
    },

    async requestEmailCode(email: string): Promise<void> {
      await jsonPost('/v1/auth/code/request', { email })
    },

    async verifyEmailCode(email: string, code: string): Promise<SignInResult> {
      const res = await jsonPost('/v1/auth/code/verify', { email, code })
      return consumeSession(await res.json())
    },

    async requestVerifyEmail(email: string): Promise<void> {
      await jsonPost('/v1/auth/verify-email/request', { email })
    },

    async confirmEmail(email: string, code: string): Promise<void> {
      await jsonPost('/v1/auth/verify-email/confirm', { email, code })
    },

    async forgotPassword(email: string): Promise<void> {
      await jsonPost('/v1/auth/password/forgot', { email })
    },

    async resetPassword(token: string, password: string): Promise<SignInResult> {
      const res = await jsonPost('/v1/auth/password/reset', { token, password })
      return consumeSession(await res.json())
    },

    async twoFactorVerify(email: string, code: string): Promise<SignInResult> {
      const res = await jsonPost('/v1/auth/two-factor/verify', { email, code })
      return consumeSession(await res.json())
    },

    async getInvite(token: string): Promise<InvitePreview> {
      const res = await tokenlessFetch(
        `${baseUrl}/v1/auth/invite?token=${encodeURIComponent(token)}`,
      )
      return mapInvite(await res.json())
    },

    async acceptInvite(token: string, name?: string, password?: string): Promise<SignInResult> {
      const res = await jsonPost('/v1/auth/invite/accept', { token, name, password })
      return consumeSession(await res.json())
    },

    async createInvite(email: string, role: string, channels?: string): Promise<void> {
      await bearerFetch(`${baseUrl}/v1/auth/invites`, getToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, channels }),
      })
    },

    /**
     * POST /auth/sign-up — TOKENLESS.
     * Sign-up does not return a companies list; companies is set to [].
     */
    async signUp(name: string, email: string, password: string): Promise<SignInResult> {
      const res = await tokenlessFetch(`${baseUrl}/v1/auth/sign-up`, {
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
      const res = await bearerFetch(`${baseUrl}/v1/me`, getToken)
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
      const res = await bearerFetch(`${baseUrl}/v1/auth/switch-company`, getToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Backend speaks snake_case for request bodies (cf. changePlan → {plan_id}).
        body: JSON.stringify({ company_id: companyId }),
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
        signupEnabled: raw.signupEnabled,
        googleEnabled: raw.googleEnabled ?? false,
      }
    },
  }
}
