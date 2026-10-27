/**
 * HTTP mutations client for the omilo-v2 backend API.
 *
 * Implements write-side commands (sendMessage, createSession, approveProposal,
 * rejectProposal, requestChanges, mintMcpToken, revokeMcpToken,
 * installConnector, updateConnector, connectorCredentials, disconnectConnector,
 * createArea, updateWallet, topup, changePlan, updateCompanyProfile).
 *
 * Reuses `apiFetch` from ./client for auth header attachment and error mapping.
 * All camelCase input is mapped to snake_case body keys before sending, and
 * snake_case response fields are mapped back to camelCase.
 *
 * NOTE: POST /v1/channels does NOT currently exist on the backend (only GET
 * endpoints are present). createArea targets that path for future use; T5
 * depends on it being implemented.
 */

import type { Channel, Company, Connector, McpToken, Message, Session, WalletSettings } from '../../core/domain/types'
import { apiFetch } from './client'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a POST RequestInit with JSON body and Content-Type header. */
function postJson(body: unknown, extraHeaders?: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  }
}

/** Build a PATCH RequestInit with JSON body. */
function patchJson(body: unknown): RequestInit {
  return {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/** Build a PUT RequestInit with JSON body. */
function putJson(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/** Build a DELETE RequestInit (no body). */
function deleteReq(): RequestInit {
  return { method: 'DELETE' }
}

// ── response mappers ──────────────────────────────────────────────────────────

type RawMcpToken = {
  id: string
  label: string
  helper_id: string
  scopes: string[]
  token?: string
  expires_at?: string | null
  last_used_at?: string | null
  revoked_at?: string | null
  active: boolean
}

function mapMcpToken(r: RawMcpToken): McpToken & { token: string } {
  return {
    id: r.id,
    label: r.label,
    helperId: r.helper_id,
    scopes: r.scopes,
    token: r.token ?? '',
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
    active: r.active,
  }
}

type RawConnector = {
  id: string
  piece_id: string
  label: string
  source: string
  status: string
  enabled: boolean
}

function mapConnector(r: RawConnector): Connector {
  return {
    id: r.id,
    pieceId: r.piece_id,
    label: r.label,
    source: r.source,
    status: r.status,
    enabled: r.enabled,
  }
}

type RawChannel = {
  id: string
  name: string
  accent: string
  is_default?: boolean
  agent_count: number
  chat_count: number
  open_items: number
}

function mapChannel(r: RawChannel): Channel {
  return {
    id: r.id,
    name: r.name,
    accent: r.accent as Channel['accent'],
    isDefault: r.is_default,
    agentCount: r.agent_count,
    chatCount: r.chat_count,
    openItems: r.open_items,
  }
}

type RawWallet = {
  auto_topup_enabled: boolean
  auto_topup_threshold_credits: number
  auto_topup_pack?: string | null
}

function mapWallet(r: RawWallet): WalletSettings {
  return {
    autoTopupEnabled: r.auto_topup_enabled,
    autoTopupThresholdCredits: r.auto_topup_threshold_credits,
    autoTopupPack: r.auto_topup_pack,
  }
}

type RawCompany = {
  id: string
  name: string
  color?: string
  industry?: string | null
  team_size?: string | null
  region?: string | null
  currency?: string
  pic_role?: string | null
  timezone?: string | null
}

function mapCompany(r: RawCompany): Company {
  return {
    id: r.id,
    name: r.name,
    color: r.color ?? '',
    industry: r.industry,
    teamSize: r.team_size,
    region: r.region,
    currency: r.currency,
    picRole: r.pic_role,
    timezone: r.timezone,
  }
}

// ── input types ──────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  channelId?: string
  goalId?: string
  title?: string
  scope?: string
}

export interface MintMcpTokenInput {
  label: string
  helperId: string
  scopes: string[]
  expiresAt?: string
}

export interface CreateAreaInput {
  name: string
  /** Maps to the channel accent / color. */
  color: string
  icon?: string
  purpose?: string
  contextScope: string
}

export interface UpdateWalletInput {
  autoTopupEnabled: boolean
  autoTopupThresholdCredits: number
  autoTopupPack?: string | null
}

export interface UpdateCompanyProfileInput {
  name?: string
  timezone?: string
  industry?: string
  teamSize?: string
  region?: string
  currency?: string
  picRole?: string
}

// ── Commands port ─────────────────────────────────────────────────────────────

export interface Commands {
  // ── P1 session + proposal commands ─────────────────────────────────────────
  createSession(input: CreateSessionInput): Promise<Session>
  sendMessage(sessionId: string, content: string): Promise<{ message: Message; jobId: string }>
  approveProposal(proposalId: string, note?: string): Promise<{ executionJobId: string }>
  rejectProposal(proposalId: string, note: string): Promise<void>
  requestChanges(proposalId: string, note: string): Promise<void>

  // ── P5d MCP token commands ──────────────────────────────────────────────────
  /** POST /v1/mcp-access-tokens — raw token returned once. */
  mintMcpToken(input: MintMcpTokenInput): Promise<McpToken & { token: string }>
  /** DELETE /v1/mcp-access-tokens/{id} — soft-revoke. */
  revokeMcpToken(id: string): Promise<void>

  // ── P5d Connector commands ──────────────────────────────────────────────────
  /** POST /v1/connectors/install — install a marketplace piece as a Connector. */
  installConnector(pieceId: string): Promise<Connector>
  /** PATCH /v1/connectors/{id} — toggle enabled/disabled. */
  updateConnector(id: string, patch: { enabled?: boolean }): Promise<Connector>
  /** POST /v1/connectors/{id}/credentials — store encrypted credentials. */
  connectorCredentials(id: string, fields: Record<string, string>): Promise<Connector>
  /** DELETE /v1/connectors/{id} — remove a connector. */
  disconnectConnector(id: string): Promise<void>

  // ── P5d Area (Channel) commands ─────────────────────────────────────────────
  /**
   * POST /v1/channels — create a new area.
   * NOTE: This endpoint does NOT yet exist on the backend (channels.py is
   * read-only). createArea is forward-compatible; T5 depends on the backend
   * implementing POST /v1/channels.
   */
  createArea(input: CreateAreaInput): Promise<Channel>

  // ── P5d Wallet + Billing commands ───────────────────────────────────────────
  /** PUT /v1/wallet — upsert WalletSettings. */
  updateWallet(input: UpdateWalletInput): Promise<WalletSettings>
  /** POST /v1/billing/topup — returns raw response (Manual: balance; Doit: hosted_url). */
  topup(pack: string): Promise<unknown>
  /** POST /v1/billing/change-plan — returns raw response (Manual: subscription; Doit: hosted_url). */
  changePlan(planId: string): Promise<unknown>

  // ── P5d Company profile command ─────────────────────────────────────────────
  /** PATCH /v1/company — update writable profile fields. */
  updateCompanyProfile(input: UpdateCompanyProfileInput): Promise<Company>
}

/**
 * Creates a Commands client that calls the real backend over HTTP.
 *
 * @param baseUrl  - e.g. "http://localhost:8000"
 * @param getToken - returns the current JWT or null when unauthenticated
 */
export function createCommands(
  baseUrl: string,
  getToken: () => string | null,
): Commands {
  async function post<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const res = await apiFetch(
      `${baseUrl}${path}`,
      getToken,
      postJson(body, extraHeaders),
    )
    return res.json() as Promise<T>
  }

  async function patch<T>(path: string, body: unknown): Promise<T> {
    const res = await apiFetch(`${baseUrl}${path}`, getToken, patchJson(body))
    return res.json() as Promise<T>
  }

  async function put<T>(path: string, body: unknown): Promise<T> {
    const res = await apiFetch(`${baseUrl}${path}`, getToken, putJson(body))
    return res.json() as Promise<T>
  }

  async function del(path: string): Promise<void> {
    const res = await apiFetch(`${baseUrl}${path}`, getToken, deleteReq())
    // 204 No Content has no body; 200 may have a body — consume either silently.
    if (res.status !== 204) {
      await res.text()
    }
  }

  return {
    // ── P1 session + proposal commands ──────────────────────────────────────

    /**
     * POST /v1/sessions → Session
     * Maps camelCase input → snake_case body as the API expects.
     */
    async createSession(input: CreateSessionInput): Promise<Session> {
      const body: Record<string, unknown> = {}
      if (input.channelId !== undefined) body.channel_id = input.channelId
      if (input.goalId !== undefined) body.goal_id = input.goalId
      if (input.title !== undefined) body.title = input.title
      if (input.scope !== undefined) body.scope = input.scope
      return post<Session>('/v1/sessions', body)
    },

    /**
     * POST /v1/sessions/{sessionId}/messages {content}
     * Returns {message, jobId} — jobId mapped from job_id.
     */
    async sendMessage(
      sessionId: string,
      content: string,
    ): Promise<{ message: Message; jobId: string }> {
      const raw = await post<{ message: Message; job_id: string }>(
        `/v1/sessions/${sessionId}/messages`,
        { content },
      )
      return { message: raw.message, jobId: raw.job_id }
    },

    /**
     * POST /v1/proposals/{proposalId}/approve {note?}
     * Requires an Idempotency-Key header (stable per proposal).
     * Returns {executionJobId} mapped from execution_job_id.
     */
    async approveProposal(
      proposalId: string,
      note?: string,
    ): Promise<{ executionJobId: string }> {
      const body: Record<string, unknown> = {}
      if (note !== undefined) body.note = note
      const raw = await post<{ proposal: unknown; execution_job_id: string }>(
        `/v1/proposals/${proposalId}/approve`,
        body,
        { 'Idempotency-Key': `approve-${proposalId}` },
      )
      return { executionJobId: raw.execution_job_id }
    },

    /**
     * POST /v1/proposals/{proposalId}/reject {note}
     */
    async rejectProposal(proposalId: string, note: string): Promise<void> {
      await post(`/v1/proposals/${proposalId}/reject`, { note })
    },

    /**
     * POST /v1/proposals/{proposalId}/request-changes {note}
     */
    async requestChanges(proposalId: string, note: string): Promise<void> {
      await post(`/v1/proposals/${proposalId}/request-changes`, { note })
    },

    // ── P5d MCP token commands ───────────────────────────────────────────────

    /**
     * POST /v1/mcp-access-tokens — mint a new token.
     * Maps camelCase input → snake_case body. Raw token returned once.
     */
    async mintMcpToken(input: MintMcpTokenInput): Promise<McpToken & { token: string }> {
      const body: Record<string, unknown> = {
        label: input.label,
        helper_id: input.helperId,
        scopes: input.scopes,
      }
      if (input.expiresAt !== undefined) body.expires_at = input.expiresAt
      const raw = await post<RawMcpToken>('/v1/mcp-access-tokens', body)
      return mapMcpToken(raw)
    },

    /**
     * DELETE /v1/mcp-access-tokens/{id} — soft-revoke.
     */
    async revokeMcpToken(id: string): Promise<void> {
      await del(`/v1/mcp-access-tokens/${id}`)
    },

    // ── P5d Connector commands ───────────────────────────────────────────────

    /**
     * POST /v1/connectors/install {piece_id} → Connector.
     */
    async installConnector(pieceId: string): Promise<Connector> {
      const raw = await post<RawConnector>('/v1/connectors/install', { piece_id: pieceId })
      return mapConnector(raw)
    },

    /**
     * PATCH /v1/connectors/{id} {enabled?} → Connector.
     */
    async updateConnector(id: string, p: { enabled?: boolean }): Promise<Connector> {
      const body: Record<string, unknown> = {}
      if (p.enabled !== undefined) body.enabled = p.enabled
      const raw = await patch<RawConnector>(`/v1/connectors/${id}`, body)
      return mapConnector(raw)
    },

    /**
     * POST /v1/connectors/{id}/credentials {fields} → Connector.
     */
    async connectorCredentials(id: string, fields: Record<string, string>): Promise<Connector> {
      const raw = await post<RawConnector>(`/v1/connectors/${id}/credentials`, { fields })
      return mapConnector(raw)
    },

    /**
     * DELETE /v1/connectors/{id} — remove a connector (204).
     */
    async disconnectConnector(id: string): Promise<void> {
      await del(`/v1/connectors/${id}`)
    },

    // ── P5d Area (Channel) commands ──────────────────────────────────────────

    /**
     * POST /v1/channels — create a new area/channel.
     *
     * The backend (channels.py, added in P5d-T2b) expects `accent` for the
     * colour/accent field; the frontend input names it `color`, so we map
     * color → accent at the body boundary.
     */
    async createArea(input: CreateAreaInput): Promise<Channel> {
      const body: Record<string, unknown> = {
        name: input.name,
        accent: input.color,
        context_scope: input.contextScope,
      }
      if (input.icon !== undefined) body.icon = input.icon
      if (input.purpose !== undefined) body.purpose = input.purpose
      const raw = await post<RawChannel>('/v1/channels', body)
      return mapChannel(raw)
    },

    // ── P5d Wallet + Billing commands ────────────────────────────────────────

    /**
     * PUT /v1/wallet — upsert WalletSettings.
     * Maps camelCase input → snake_case body.
     */
    async updateWallet(input: UpdateWalletInput): Promise<WalletSettings> {
      const body: Record<string, unknown> = {
        auto_topup_enabled: input.autoTopupEnabled,
        auto_topup_threshold_credits: input.autoTopupThresholdCredits,
        auto_topup_pack: input.autoTopupPack ?? null,
      }
      const raw = await put<RawWallet>('/v1/wallet', body)
      return mapWallet(raw)
    },

    /**
     * POST /v1/billing/topup {pack} — returns the raw response as-is.
     * Manual provider: {balance, invoice}; Doit provider: {payment_id, hosted_url, ...}.
     */
    async topup(pack: string): Promise<unknown> {
      return post<unknown>('/v1/billing/topup', { pack })
    },

    /**
     * POST /v1/billing/change-plan {plan_id} — returns the raw response as-is.
     * Manual provider: {subscription, balance}; Doit: {payment_id, hosted_url, ...}.
     */
    async changePlan(planId: string): Promise<unknown> {
      return post<unknown>('/v1/billing/change-plan', { plan_id: planId })
    },

    // ── P5d Company profile command ──────────────────────────────────────────

    /**
     * PATCH /v1/company — update writable profile fields.
     * Maps camelCase input → snake_case body (only non-undefined fields).
     */
    async updateCompanyProfile(input: UpdateCompanyProfileInput): Promise<Company> {
      const body: Record<string, unknown> = {}
      if (input.name !== undefined) body.name = input.name
      if (input.timezone !== undefined) body.timezone = input.timezone
      if (input.industry !== undefined) body.industry = input.industry
      if (input.teamSize !== undefined) body.team_size = input.teamSize
      if (input.region !== undefined) body.region = input.region
      if (input.currency !== undefined) body.currency = input.currency
      if (input.picRole !== undefined) body.pic_role = input.picRole
      const raw = await patch<RawCompany>('/v1/company', body)
      return mapCompany(raw)
    },
  }
}
