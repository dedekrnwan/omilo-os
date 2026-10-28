/**
 * session.ts — auth / session domain types.
 *
 * All types are camelCase. snake_case → camelCase mapping happens at the HTTP
 * adapter boundary (src/adapters/http/auth.ts), never here.
 */

export interface SessionUser {
  id: string
  email: string
  name: string
}

/**
 * Company record returned by auth endpoints.
 *
 * Maps: team_size → teamSize, pic_role → picRole.
 * `currency` is required (always present in CompanyOut from the backend).
 */
export interface Company {
  id: string
  name: string
  industry?: string | null
  teamSize?: string | null
  region?: string | null
  currency: string
  picRole?: string | null
  /** P13 onboarding gate — true once the company completed the onboarding wizard. */
  onboarded?: boolean
}

/**
 * Result of sign-in or company switch.
 *
 * `company` is the active company (companies[0] for sign-in/switch, null if
 * the companies list is empty).
 * `token` is the raw JWT access token; the adapter stores it via tokenStorage.
 */
export interface SignInResult {
  user: SessionUser
  company: Company | null
  companies: Company[]
  token: string
}

/**
 * Result of GET /me — the authenticated user with their current company context.
 */
export interface MeResult {
  user: SessionUser
  role: string
  company: Company
  companies: Company[]
}

/**
 * Public server configuration — fetched without auth on every app boot.
 *
 * Maps: signup_enabled → signupEnabled, google_enabled → googleEnabled.
 */
export interface PublicConfig {
  mode: string
  signupEnabled: boolean
  googleEnabled: boolean
}
