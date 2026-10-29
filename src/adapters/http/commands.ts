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
 */

import type {
  AiAccount,
  Channel,
  Company,
  CompanyMember,
  CompanySettings,
  Connector,
  Flow,
  Goal,
  Helper,
  McpToken,
  MemoryDoc,
  Message,
  Routine,
  Session,
  WalletSettings,
} from '../../core/domain/types'
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

/**
 * Raw channel DTO as returned by the backend.
 *
 * The channels LIST/GET endpoints return mostly camelCase (FastAPI by_alias=True),
 * while the channels CREATE endpoint returns snake_case. Both forms are modelled
 * here so a single shared mapper can handle either response.
 */
export type RawChannel = {
  id: string
  name: string
  accent: string
  /** snake_case (CREATE endpoint) */
  is_default?: boolean
  /** camelCase (LIST/GET endpoint, by_alias=True) */
  isDefault?: boolean
  /** snake_case (CREATE endpoint) */
  agent_count?: number
  /** camelCase (LIST/GET endpoint, by_alias=True) */
  agentCount?: number
  /** snake_case (CREATE endpoint) */
  chat_count?: number
  /** camelCase (LIST/GET endpoint, by_alias=True) */
  chatCount?: number
  /** snake_case (CREATE endpoint) */
  open_items?: number
  /** camelCase (LIST/GET endpoint, by_alias=True) */
  openItems?: number
  icon?: string
  purpose?: string
  /** Backend returns contextScope (camelCase via by_alias) or context_scope. */
  contextScope?: string
  context_scope?: string
}

function mapChannel(r: RawChannel): Channel {
  return {
    id: r.id,
    name: r.name,
    accent: r.accent as Channel['accent'],
    isDefault: r.is_default ?? r.isDefault,
    agentCount: (r.agent_count ?? r.agentCount) ?? 0,
    chatCount: (r.chat_count ?? r.chatCount) ?? 0,
    openItems: (r.open_items ?? r.openItems) ?? 0,
    icon: r.icon,
    purpose: r.purpose,
    contextScope: r.contextScope ?? r.context_scope ?? 'isolated',
  }
}

type RawAiAccount = {
  id: string
  harness: string
  name: string
  tag?: string | null
  status: string
  pct: number
  tokens?: string | null
  last_used?: string | null
}

function mapAiAccount(r: RawAiAccount): AiAccount {
  return {
    id: r.id,
    harness: r.harness,
    name: r.name,
    tag: r.tag,
    status: r.status,
    pctWindow: r.pct,
    tokens: r.tokens,
    lastUsed: r.last_used,
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

// Goal write-endpoints emit snake_case; reads emit camelCase (by_alias). Map defensively.
type RawGoal = {
  id: string
  title: string
  progress?: number
  channel_id?: string
  channelId?: string
}

function mapGoal(r: RawGoal): Goal {
  return {
    id: r.id,
    channelId: (r.channel_id ?? r.channelId) ?? '',
    title: r.title,
    progress: r.progress ?? 0,
  }
}

type RawRoutine = {
  id: string
  company_id: string
  helper_id: string
  name: string
  subtitle: string
  instructions: string
  freq: string
  at: string
  days: number[]
  monthly: string | null
  timezone: string
  cron: string
  sends_to: unknown[]
  enabled: boolean
  paused: boolean
  managed_by_chief: boolean
  next_at: string | null
  last_at: string | null
  goal_ids: string[]
  created_by: string
}

function mapRoutine(r: RawRoutine): Routine {
  return {
    id: r.id,
    companyId: r.company_id,
    helperId: r.helper_id,
    name: r.name,
    subtitle: r.subtitle,
    instructions: r.instructions,
    freq: r.freq,
    at: r.at,
    days: r.days ?? [],
    monthly: r.monthly,
    timezone: r.timezone,
    cron: r.cron,
    sendsTo: r.sends_to ?? [],
    enabled: r.enabled,
    paused: r.paused,
    managedByChief: r.managed_by_chief,
    nextAt: r.next_at,
    lastAt: r.last_at,
    goalIds: r.goal_ids ?? [],
    createdBy: r.created_by,
  }
}

type RawFlow = {
  id: string
  title: string
  status: string
  enabled: boolean
  count: number
  areas: string[]
  created_at: string | null
  company_id?: string
  version?: number
  created_by?: string
  proposed_from_pattern?: boolean
  trigger?: { kind: string; spec: Record<string, unknown> }
  nodes?: unknown[]
  edges?: unknown[]
  channel_ids?: string[]
  poll_cursor?: unknown | null
}

function mapFlow(r: RawFlow): Flow {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    enabled: r.enabled,
    count: r.count,
    areas: r.areas ?? [],
    createdAt: r.created_at,
    companyId: r.company_id,
    version: r.version,
    createdBy: r.created_by,
    proposedFromPattern: r.proposed_from_pattern,
    trigger: r.trigger,
    nodes: r.nodes,
    edges: r.edges,
    channelIds: r.channel_ids,
    pollCursor: r.poll_cursor,
  }
}

// Helper write-endpoints emit snake_case for the extra fields; reads emit camelCase.
type RawHelper = {
  id: string
  name: string
  area: string
  role?: string
  status?: string
  is_chief?: boolean
  isChief?: boolean
  autonomy_cap?: string | null
  autonomyCap?: string | null
  job_description?: string
  jobDescription?: string
  model?: string
}

function mapHelper(r: RawHelper): Helper {
  return {
    id: r.id,
    name: r.name,
    area: r.area as Helper['area'],
    role: r.role,
    status: r.status,
    isChief: r.is_chief ?? r.isChief,
    autonomyCap: r.autonomy_cap ?? r.autonomyCap,
    jobDescription: r.job_description ?? r.jobDescription,
  }
}

type RawMember = {
  id: string
  user_id: string
  name: string
  email: string
  role: string
}

function mapMember(r: RawMember): CompanyMember {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    email: r.email,
    role: r.role,
  }
}

type RawMemoryDoc = {
  id: string
  title: string
  content: string
  kind?: string
}

function mapMemoryDoc(r: RawMemoryDoc): MemoryDoc {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    kind: r.kind ?? 'note',
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

export interface CreateAiAccountInput {
  /** Harness identifier, e.g. 'claude-code', 'codex', 'copilot', 'gemini-cli', 'cursor', 'anthropic', 'openai'. */
  harness: string
  /** Human-readable display name, stored as label on the backend. */
  name: string
  /** Encrypted API key / token (may be empty for subscription-based accounts). */
  tokenEnc?: string
  /** Masked key hint shown in the UI, e.g. 'sk-ant-...****'. */
  tokenHint?: string
  /** Optional free-text tag for grouping (e.g. 'primary', 'overflow'). */
  tag?: string | null
}

// ── P2 dead-CTA / form-wiring input types ───────────────────────────────────────

export interface CreateGoalInput {
  channelId: string
  title: string
  target: string
  due?: string
  autonomyOverride?: string
}

export interface UpdateGoalInput {
  title?: string
  target?: string
  due?: string
  status?: string
  channelId?: string
}

export interface CreateRoutineInput {
  helperId: string
  name: string
  instructions: string
  freq: string
  at: string
  days?: number[]
  monthly?: string | null
  timezone?: string
  sendsTo?: unknown[]
  goalIds?: string[]
  subtitle?: string
}

export interface UpdateRoutineInput {
  paused?: boolean
  enabled?: boolean
  instructions?: string
  name?: string
  subtitle?: string
  helperId?: string
  sendsTo?: unknown[]
  goalIds?: string[]
  freq?: string
  at?: string
  days?: number[]
  monthly?: string | null
  timezone?: string
}

export interface CreateFlowInput {
  title?: string
  trigger: { kind: string; spec: Record<string, unknown> }
  nodes: unknown[]
  edges: unknown[]
  channelIds?: string[]
  areas?: string[]
}

export interface UpdateFlowInput {
  title?: string
  trigger?: { kind: string; spec: Record<string, unknown> }
  nodes?: unknown[]
  edges?: unknown[]
  enabled?: boolean
  areas?: string[]
}

export interface CreateHelperInput {
  name: string
  area: string
  role: string
  jobDescription?: string
  autonomyCap?: string
  isChief?: boolean
}

export interface UpdateHelperInput {
  status?: string
  role?: string
  jobDescription?: string
  autonomyCap?: string
  model?: string
}

export interface InviteMemberInput {
  email: string
  role?: string
  channels?: string[]
}

export interface CreateDocInput {
  title: string
  content: string
  kind?: string
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
   * POST /v1/channels — create a new area (name, accent, icon, purpose,
   * context_scope). Added to the backend in P5d-T2b.
   */
  createArea(input: CreateAreaInput): Promise<Channel>

  // ── P5d Wallet + Billing commands ───────────────────────────────────────────
  /** PUT /v1/wallet — upsert WalletSettings. */
  updateWallet(input: UpdateWalletInput): Promise<WalletSettings>
  /** POST /v1/billing/topup — returns raw response (Manual: balance; Doit: hosted_url). */
  topup(pack: string): Promise<unknown>
  /** POST /v1/billing/change-plan {plan_id, interval} — returns raw response (Manual: subscription; Doit: hosted_url). */
  changePlan(planId: string, interval: 'monthly' | 'yearly'): Promise<unknown>

  // ── P5d Company profile command ─────────────────────────────────────────────
  /** PATCH /v1/company — update writable profile fields. */
  updateCompanyProfile(input: UpdateCompanyProfileInput): Promise<Company>

  // ── P13 AI account commands ──────────────────────────────────────────────────
  /**
   * POST /v1/ai-accounts — create/connect a new HarnessAccount.
   * Body: {harness, name, token_enc?, token_hint?, tag?}.
   * Returns the created PoolAccount (id, harness, name, tag, status, pct, tokens, last_used).
   */
  createAiAccount(input: CreateAiAccountInput): Promise<AiAccount>

  // ── P13 onboarding gate command ─────────────────────────────────────────────
  /**
   * POST /v1/company/onboard — mark the authed company as onboarded (idempotent).
   * Returns the updated company object with onboarded: true.
   */
  onboardCompany(): Promise<{ id: string; name: string; onboarded: boolean; [key: string]: unknown }>

  // ── P8 flow + routine + goal + skill commands ────────────────────────────────
  /** POST /v1/flows/{id}/publish → Proposal */
  publishFlow(id: string): Promise<unknown>
  /** POST /v1/flows/{id}/run → FlowRun */
  runFlow(id: string): Promise<unknown>
  /** POST /v1/flows/{id}/test-run {sample?} → FlowRun */
  testRunFlow(id: string, input?: Record<string, unknown>): Promise<unknown>
  /** POST /v1/routines/{id}/run-now → {job_id} */
  runRoutineNow(id: string): Promise<{ jobId: string }>
  /** POST /v1/goals/{id}/replan → {job_id} */
  replanGoal(id: string): Promise<{ jobId: string }>
  /** POST /v1/skills/{id}/publish → Proposal */
  publishSkill(id: string): Promise<unknown>

  // ── P2 Goal commands ──────────────────────────────────────────────────────────
  /** POST /v1/goals {channel_id,title,target,due?,autonomy_override?} → Goal. */
  createGoal(input: CreateGoalInput): Promise<Goal>
  /** PATCH /v1/goals/{id} {title?,target?,due?,status?,channel_id?} → Goal. */
  updateGoal(id: string, input: UpdateGoalInput): Promise<Goal>
  /** DELETE /v1/goals/{id} → 204. */
  deleteGoal(id: string): Promise<void>

  // ── P2 Routine commands ───────────────────────────────────────────────────────
  /** POST /v1/routines {helper_id,name,instructions,freq,at,...} → Routine. */
  createRoutine(input: CreateRoutineInput): Promise<Routine>
  /** PATCH /v1/routines/{id} {paused?,enabled?,instructions?,...} → Routine. */
  updateRoutine(id: string, input: UpdateRoutineInput): Promise<Routine>
  /** DELETE /v1/routines/{id} → 204. */
  deleteRoutine(id: string): Promise<void>
  /** POST /v1/routines/{id}/skip-next → {next_at}. */
  skipRoutineNext(id: string): Promise<{ nextAt: string | null }>

  // ── P2 Flow commands ──────────────────────────────────────────────────────────
  /** POST /v1/flows {title?,trigger,nodes,edges,channel_ids?,areas?} → Flow. */
  createFlow(input: CreateFlowInput): Promise<Flow>
  /** PATCH /v1/flows/{id} {title?,trigger?,nodes?,edges?,enabled?,areas?} → Flow. */
  updateFlow(id: string, input: UpdateFlowInput): Promise<Flow>
  /** DELETE /v1/flows/{id} → 204. */
  deleteFlow(id: string): Promise<void>
  /** POST /v1/flows — create a new flow from a copied flow body (duplicate). */
  duplicateFlow(input: CreateFlowInput): Promise<Flow>

  // ── P2 Helper commands ────────────────────────────────────────────────────────
  /** POST /v1/helpers {name,area,role,job_description?,autonomy_cap?,is_chief?} → Helper. */
  createHelper(input: CreateHelperInput): Promise<Helper>
  /** PATCH /v1/helpers/{id} {status?,role?,job_description?,autonomy_cap?,model?} → Helper. */
  updateHelper(id: string, input: UpdateHelperInput): Promise<Helper>

  // ── P2 Member commands ────────────────────────────────────────────────────────
  /** PATCH /v1/members/{id} {role} → CompanyMember. */
  changeMemberRole(id: string, role: string): Promise<CompanyMember>
  /** DELETE /v1/members/{id} → 204. */
  removeMember(id: string): Promise<void>
  /** POST /v1/auth/invites {email,role?,channels?} → raw invite response. */
  inviteMember(input: InviteMemberInput): Promise<unknown>

  // ── P2 Company commands ───────────────────────────────────────────────────────
  /** DELETE /v1/company → 204 (owner only). */
  deleteCompany(): Promise<void>
  /** GET /v1/company/settings → CompanySettings. */
  getCompanySettings(): Promise<CompanySettings>
  /** PATCH /v1/company/settings {partial} → merged CompanySettings. */
  updateCompanySettings(patch: CompanySettings): Promise<CompanySettings>

  // ── P2 AI-account commands ──────────────────────────────────────────────────────
  /** POST /v1/ai-accounts/check → raw check result. */
  checkAiAccounts(): Promise<unknown>
  /** POST /v1/ai-accounts/{id}/test → raw test result. */
  testAiAccount(id: string): Promise<unknown>

  // ── P2 Doc (memory) commands ─────────────────────────────────────────────────────
  /** POST /v1/memory {title,content,kind?} → MemoryDoc. */
  createDoc(input: CreateDocInput): Promise<MemoryDoc>
  /** PATCH /v1/memory/{id} {content} → MemoryDoc. */
  updateDoc(id: string, content: string): Promise<MemoryDoc>
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
     * POST /v1/billing/change-plan {plan_id, interval} — returns the raw response as-is.
     * Manual provider: {subscription, balance}; Doit: {payment_id, hosted_url, ...}.
     */
    async changePlan(planId: string, interval: 'monthly' | 'yearly'): Promise<unknown> {
      return post<unknown>('/v1/billing/change-plan', { plan_id: planId, interval })
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

    // ── P13 AI account commands ──────────────────────────────────────────────

    /**
     * POST /v1/ai-accounts — create a new HarnessAccount.
     * Maps camelCase input → snake_case body; maps the PoolAccount response
     * (pct → pctWindow, last_used → lastUsed).
     */
    async createAiAccount(input: CreateAiAccountInput): Promise<AiAccount> {
      const body: Record<string, unknown> = {
        harness: input.harness,
        name: input.name,
      }
      if (input.tokenEnc !== undefined) body.token_enc = input.tokenEnc
      if (input.tokenHint !== undefined) body.token_hint = input.tokenHint
      if (input.tag !== undefined) body.tag = input.tag
      const raw = await post<RawAiAccount>('/v1/ai-accounts', body)
      return mapAiAccount(raw)
    },

    // ── P13 onboarding gate command ──────────────────────────────────────────

    /**
     * POST /v1/company/onboard — mark the authed company as onboarded (idempotent).
     * Returns the updated CompanyOut with onboarded: true.
     */
    async onboardCompany(): Promise<{ id: string; name: string; onboarded: boolean; [key: string]: unknown }> {
      return post('/v1/company/onboard', {})
    },

    // ── P8 flow + routine + goal + skill commands ────────────────────────────

    /**
     * POST /v1/flows/{id}/publish → Proposal (type=flow_publish, pending).
     * Returns the raw Proposal object from the backend.
     */
    async publishFlow(id: string): Promise<unknown> {
      return post<unknown>(`/v1/flows/${id}/publish`, {})
    },

    /**
     * POST /v1/flows/{id}/run → FlowRun.
     * Manually triggers a flow run (test=False).
     */
    async runFlow(id: string): Promise<unknown> {
      return post<unknown>(`/v1/flows/${id}/run`, {})
    },

    /**
     * POST /v1/flows/{id}/test-run {sample?} → FlowRun.
     * Simulates a flow run (test=True — no real side effects).
     */
    async testRunFlow(id: string, input?: Record<string, unknown>): Promise<unknown> {
      return post<unknown>(`/v1/flows/${id}/test-run`, { sample: input ?? {} })
    },

    /**
     * POST /v1/routines/{id}/run-now → {job_id}.
     * Returns {jobId} mapped from job_id.
     */
    async runRoutineNow(id: string): Promise<{ jobId: string }> {
      const raw = await post<{ job_id: string }>(`/v1/routines/${id}/run-now`, {})
      return { jobId: raw.job_id }
    },

    /**
     * POST /v1/goals/{id}/replan → {job_id}.
     * Re-runs plan_goal for the given goal. Returns {jobId} mapped from job_id.
     */
    async replanGoal(id: string): Promise<{ jobId: string }> {
      const raw = await post<{ job_id: string }>(`/v1/goals/${id}/replan`, {})
      return { jobId: raw.job_id }
    },

    /**
     * POST /v1/skills/{id}/publish → Proposal (type=skill_publish, pending).
     * Returns the raw Proposal object from the backend.
     */
    async publishSkill(id: string): Promise<unknown> {
      return post<unknown>(`/v1/skills/${id}/publish`, {})
    },

    // ── P2 Goal commands ────────────────────────────────────────────────────────

    /** POST /v1/goals — create a goal. Maps camelCase input → snake_case body. */
    async createGoal(input: CreateGoalInput): Promise<Goal> {
      const body: Record<string, unknown> = {
        channel_id: input.channelId,
        title: input.title,
        target: input.target,
      }
      if (input.due !== undefined) body.due = input.due
      if (input.autonomyOverride !== undefined) body.autonomy_override = input.autonomyOverride
      const raw = await post<RawGoal>('/v1/goals', body)
      return mapGoal(raw)
    },

    /** PATCH /v1/goals/{id} — update writable goal fields (only non-undefined). */
    async updateGoal(id: string, input: UpdateGoalInput): Promise<Goal> {
      const body: Record<string, unknown> = {}
      if (input.title !== undefined) body.title = input.title
      if (input.target !== undefined) body.target = input.target
      if (input.due !== undefined) body.due = input.due
      if (input.status !== undefined) body.status = input.status
      if (input.channelId !== undefined) body.channel_id = input.channelId
      const raw = await patch<RawGoal>(`/v1/goals/${id}`, body)
      return mapGoal(raw)
    },

    /** DELETE /v1/goals/{id} → 204. */
    async deleteGoal(id: string): Promise<void> {
      await del(`/v1/goals/${id}`)
    },

    // ── P2 Routine commands ───────────────────────────────────────────────────────

    /** POST /v1/routines — create a routine. Maps camelCase → snake_case body. */
    async createRoutine(input: CreateRoutineInput): Promise<Routine> {
      const body: Record<string, unknown> = {
        helper_id: input.helperId,
        name: input.name,
        instructions: input.instructions,
        freq: input.freq,
        at: input.at,
      }
      if (input.days !== undefined) body.days = input.days
      if (input.monthly !== undefined) body.monthly = input.monthly
      if (input.timezone !== undefined) body.timezone = input.timezone
      if (input.sendsTo !== undefined) body.sends_to = input.sendsTo
      if (input.goalIds !== undefined) body.goal_ids = input.goalIds
      if (input.subtitle !== undefined) body.subtitle = input.subtitle
      const raw = await post<RawRoutine>('/v1/routines', body)
      return mapRoutine(raw)
    },

    /** PATCH /v1/routines/{id} — update writable routine fields. */
    async updateRoutine(id: string, input: UpdateRoutineInput): Promise<Routine> {
      const body: Record<string, unknown> = {}
      if (input.paused !== undefined) body.paused = input.paused
      if (input.enabled !== undefined) body.enabled = input.enabled
      if (input.instructions !== undefined) body.instructions = input.instructions
      if (input.name !== undefined) body.name = input.name
      if (input.subtitle !== undefined) body.subtitle = input.subtitle
      if (input.helperId !== undefined) body.helper_id = input.helperId
      if (input.sendsTo !== undefined) body.sends_to = input.sendsTo
      if (input.goalIds !== undefined) body.goal_ids = input.goalIds
      if (input.freq !== undefined) body.freq = input.freq
      if (input.at !== undefined) body.at = input.at
      if (input.days !== undefined) body.days = input.days
      if (input.monthly !== undefined) body.monthly = input.monthly
      if (input.timezone !== undefined) body.timezone = input.timezone
      const raw = await patch<RawRoutine>(`/v1/routines/${id}`, body)
      return mapRoutine(raw)
    },

    /** DELETE /v1/routines/{id} → 204. */
    async deleteRoutine(id: string): Promise<void> {
      await del(`/v1/routines/${id}`)
    },

    /** POST /v1/routines/{id}/skip-next → {next_at} mapped to {nextAt}. */
    async skipRoutineNext(id: string): Promise<{ nextAt: string | null }> {
      const raw = await post<{ next_at: string | null }>(`/v1/routines/${id}/skip-next`, {})
      return { nextAt: raw.next_at }
    },

    // ── P2 Flow commands ──────────────────────────────────────────────────────────

    /** POST /v1/flows — create a flow. Maps camelCase → snake_case body. */
    async createFlow(input: CreateFlowInput): Promise<Flow> {
      const body: Record<string, unknown> = {
        trigger: input.trigger,
        nodes: input.nodes,
        edges: input.edges,
      }
      if (input.title !== undefined) body.title = input.title
      if (input.channelIds !== undefined) body.channel_ids = input.channelIds
      if (input.areas !== undefined) body.areas = input.areas
      const raw = await post<RawFlow>('/v1/flows', body)
      return mapFlow(raw)
    },

    /** PATCH /v1/flows/{id} — update writable flow fields. */
    async updateFlow(id: string, input: UpdateFlowInput): Promise<Flow> {
      const body: Record<string, unknown> = {}
      if (input.title !== undefined) body.title = input.title
      if (input.trigger !== undefined) body.trigger = input.trigger
      if (input.nodes !== undefined) body.nodes = input.nodes
      if (input.edges !== undefined) body.edges = input.edges
      if (input.enabled !== undefined) body.enabled = input.enabled
      if (input.areas !== undefined) body.areas = input.areas
      const raw = await patch<RawFlow>(`/v1/flows/${id}`, body)
      return mapFlow(raw)
    },

    /** DELETE /v1/flows/{id} → 204. */
    async deleteFlow(id: string): Promise<void> {
      await del(`/v1/flows/${id}`)
    },

    /** POST /v1/flows — duplicate = create a new flow from a copied body. */
    async duplicateFlow(input: CreateFlowInput): Promise<Flow> {
      const body: Record<string, unknown> = {
        trigger: input.trigger,
        nodes: input.nodes,
        edges: input.edges,
      }
      if (input.title !== undefined) body.title = input.title
      if (input.channelIds !== undefined) body.channel_ids = input.channelIds
      if (input.areas !== undefined) body.areas = input.areas
      const raw = await post<RawFlow>('/v1/flows', body)
      return mapFlow(raw)
    },

    // ── P2 Helper commands ────────────────────────────────────────────────────────

    /** POST /v1/helpers — create a helper. Maps camelCase → snake_case body. */
    async createHelper(input: CreateHelperInput): Promise<Helper> {
      const body: Record<string, unknown> = {
        name: input.name,
        area: input.area,
        role: input.role,
      }
      if (input.jobDescription !== undefined) body.job_description = input.jobDescription
      if (input.autonomyCap !== undefined) body.autonomy_cap = input.autonomyCap
      if (input.isChief !== undefined) body.is_chief = input.isChief
      const raw = await post<RawHelper>('/v1/helpers', body)
      return mapHelper(raw)
    },

    /** PATCH /v1/helpers/{id} — update writable helper fields. */
    async updateHelper(id: string, input: UpdateHelperInput): Promise<Helper> {
      const body: Record<string, unknown> = {}
      if (input.status !== undefined) body.status = input.status
      if (input.role !== undefined) body.role = input.role
      if (input.jobDescription !== undefined) body.job_description = input.jobDescription
      if (input.autonomyCap !== undefined) body.autonomy_cap = input.autonomyCap
      if (input.model !== undefined) body.model = input.model
      const raw = await patch<RawHelper>(`/v1/helpers/${id}`, body)
      return mapHelper(raw)
    },

    // ── P2 Member commands ────────────────────────────────────────────────────────

    /** PATCH /v1/members/{id} {role} → CompanyMember. */
    async changeMemberRole(id: string, role: string): Promise<CompanyMember> {
      const raw = await patch<RawMember>(`/v1/members/${id}`, { role })
      return mapMember(raw)
    },

    /** DELETE /v1/members/{id} → 204. */
    async removeMember(id: string): Promise<void> {
      await del(`/v1/members/${id}`)
    },

    /** POST /v1/auth/invites {email,role?,channels?} → raw invite response. */
    async inviteMember(input: InviteMemberInput): Promise<unknown> {
      const body: Record<string, unknown> = { email: input.email }
      if (input.role !== undefined) body.role = input.role
      if (input.channels !== undefined) body.channels = input.channels
      return post<unknown>('/v1/auth/invites', body)
    },

    // ── P2 Company commands ───────────────────────────────────────────────────────

    /** DELETE /v1/company → 204 (owner only). */
    async deleteCompany(): Promise<void> {
      await del('/v1/company')
    },

    /** GET /v1/company/settings → CompanySettings (free-form JSON). */
    async getCompanySettings(): Promise<CompanySettings> {
      const res = await apiFetch(`${baseUrl}/v1/company/settings`, getToken, { method: 'GET' })
      return res.json() as Promise<CompanySettings>
    },

    /** PATCH /v1/company/settings {partial} → merged CompanySettings. */
    async updateCompanySettings(p: CompanySettings): Promise<CompanySettings> {
      return patch<CompanySettings>('/v1/company/settings', p)
    },

    // ── P2 AI-account commands ──────────────────────────────────────────────────────

    /** POST /v1/ai-accounts/check → raw check result. */
    async checkAiAccounts(): Promise<unknown> {
      return post<unknown>('/v1/ai-accounts/check', {})
    },

    /** POST /v1/ai-accounts/{id}/test → raw test result. */
    async testAiAccount(id: string): Promise<unknown> {
      return post<unknown>(`/v1/ai-accounts/${id}/test`, {})
    },

    // ── P2 Doc (memory) commands ─────────────────────────────────────────────────────

    /** POST /v1/memory {title,content,kind?} → MemoryDoc. */
    async createDoc(input: CreateDocInput): Promise<MemoryDoc> {
      const body: Record<string, unknown> = {
        title: input.title,
        content: input.content,
      }
      if (input.kind !== undefined) body.kind = input.kind
      const raw = await post<RawMemoryDoc>('/v1/memory', body)
      return mapMemoryDoc(raw)
    },

    /** PATCH /v1/memory/{id} {content} → MemoryDoc. */
    async updateDoc(id: string, content: string): Promise<MemoryDoc> {
      const raw = await patch<RawMemoryDoc>(`/v1/memory/${id}`, { content })
      return mapMemoryDoc(raw)
    },
  }
}
