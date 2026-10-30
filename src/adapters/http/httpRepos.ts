/**
 * HTTP implementation of the Repos port.
 *
 * Maps every port method to the §2 read endpoints defined in
 * docs/technical/02-api-contracts.md.  Response JSON is structurally
 * identical to the TS domain types (camelCase), so no transformation is
 * needed — parse and return as the typed value.
 *
 * 404 responses on .get() methods resolve to null instead of throwing.
 */

import type {
  AiAccount,
  AnalyticsOverview,
  BillingPlan,
  BillingSubscription,
  Channel,
  CompanyMember,
  Connector,
  Flow,
  FlowRun,
  Folder,
  Goal,
  Helper,
  HelperStat,
  Id,
  KbItem,
  KbSource,
  McpToken,
  Message,
  Piece,
  Routine,
  Session,
  Skill,
  InboxItem,
  UsageSummary,
  WalletSettings,
  // ── sweep/inbox-flows ──
  FlowSuggestion,
  FlowVersionInfo,
  HelperArea,
  ProposalDetail,
} from '../../core/domain/types'
import type { ChiefNudge, FolderFile, SessionResults, Shares } from '../../core/domain/types' // sweep/chat
import type { Repos } from '../../core/ports/repos'
import { apiFetch, ApiError } from './client'
// ── sweep/docs ──
import type {
  DocDetail,
  DocGraph,
  DocSummary,
  DocVersion,
  HandbookFile,
  HandbookFileDetail,
  HandbookSuggestion,
  Lesson,
} from '../../core/domain/types'
import type { RawChannel } from './commands'
// ── sweep/goals-routines ──
import {
  mapGoalDetail,
  mapRunDetail,
  mapSchedule,
  mapSuggestion,
  routineExtras,
  type RawGoalDetail,
  type RawRoutineExtras,
  type RawRoutineRun,
  type RawRunDetail,
  type RawSchedule,
  type RawSuggestion,
} from './routineMappers'
// ── sweep/control ──
import type { ControlPanelRepo } from '../../core/ports/repos'
import type {
  AuditQuery,
  CompanyDetail,
  DataExport,
  Invite,
  ManagedChannel,
  McpServer,
  Payment,
  UserPreferences,
} from '../../core/domain/controlPanel'

// ── snake_case → camelCase mappers ────────────────────────────────────────────
// The legacy endpoints (channels, sessions, inbox, …) return camelCase already.
// The new endpoints (usage, wallet, ai-accounts, marketplace, connectors,
// mcp-access-tokens, billing) return snake_case fields that must be mapped here.

// ── Billing Plans + Subscription ─────────────────────────────────────────────

type RawBillingPlan = {
  id: string
  tier: string
  name: string
  monthly_price_usd: number
  monthly_price_idr: number
  yearly_price_usd: number
  yearly_price_idr: number
  included_credits: number
  seats: number
  trial_days: number
  max_seats?: number | null
  max_helpers?: number | null
  seat_price_idr?: number | null
  storage_gb?: number | null
  features?: string[]
  badge?: string | null
}

function mapBillingPlan(r: RawBillingPlan): BillingPlan {
  return {
    id: r.id,
    tier: r.tier,
    name: r.name,
    monthlyPriceUsd: r.monthly_price_usd,
    monthlyPriceIdr: r.monthly_price_idr,
    yearlyPriceUsd: r.yearly_price_usd,
    yearlyPriceIdr: r.yearly_price_idr,
    includedCredits: r.included_credits,
    seats: r.seats,
    trialDays: r.trial_days,
    maxSeats: r.max_seats,
    maxHelpers: r.max_helpers,
    seatPriceIdr: r.seat_price_idr,
    storageGb: r.storage_gb ?? null,
    features: r.features,
    badge: r.badge,
  }
}

type RawBillingSubscription = {
  plan_id?: string
  /** GET /v1/billing/subscription returns the plan object + period_end. */
  plan?: { id: string; name: string } | null
  period_end?: string | null
  status: string
  current_period_end?: string | null
  seats: number
  billing_interval: 'monthly' | 'yearly'
  is_trial: boolean
  trial_ends_at: string | null
  trial_days_left: number
}

function mapBillingSubscription(r: RawBillingSubscription): BillingSubscription {
  return {
    planId: r.plan_id ?? r.plan?.id ?? '',
    planName: r.plan?.name,
    status: r.status,
    currentPeriodEnd: r.current_period_end ?? r.period_end ?? null,
    seats: r.seats,
    billingInterval: r.billing_interval,
    isTrial: r.is_trial,
    trialEndsAt: r.trial_ends_at,
    trialDaysLeft: r.trial_days_left,
  }
}

type RawUsage = {
  balance: number
  included: number
  used_this_period: number
  by_helper: { helper_id: string; credits: number }[]
  by_day: { day: string; credits: number }[]
  pending_topups?: { count: number; total_credits: number } | null
  last_payment?: {
    id: string; kind: string; status: string
    amount_idr: number; created_at: string | null
  } | null
}

function mapUsage(r: RawUsage): UsageSummary {
  return {
    balance: r.balance,
    included: r.included,
    usedThisPeriod: r.used_this_period,
    byHelper: r.by_helper.map(h => ({ helperId: h.helper_id, credits: h.credits })),
    byDay: r.by_day.map(d => ({ day: d.day, credits: d.credits })),
    pendingTopups: r.pending_topups
      ? { count: r.pending_topups.count, totalCredits: r.pending_topups.total_credits }
      : r.pending_topups,
    lastPayment: r.last_payment
      ? {
          id: r.last_payment.id,
          kind: r.last_payment.kind,
          status: r.last_payment.status,
          amountIdr: r.last_payment.amount_idr,
          createdAt: r.last_payment.created_at,
        }
      : r.last_payment,
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

type RawPiece = {
  id: string
  label: string
  category: string
  description: string
  auth_type?: string | null
  action_count: number
  logo?: string | null
  status: string
}

function mapPiece(r: RawPiece): Piece {
  return {
    id: r.id,
    label: r.label,
    category: r.category,
    description: r.description,
    authType: r.auth_type,
    actionCount: r.action_count,
    logo: r.logo,
    status: r.status,
  }
}

type RawConnector = {
  id: string
  piece_id: string
  label: string
  source: string
  status: string
  enabled: boolean
  auth?: { type: string; provider?: string | null; fields: string[] }
}

function mapConnector(r: RawConnector): Connector {
  return {
    id: r.id,
    pieceId: r.piece_id,
    label: r.label,
    source: r.source,
    status: r.status,
    enabled: r.enabled,
    ...(r.auth ? { auth: { type: r.auth.type, provider: r.auth.provider ?? null, fields: r.auth.fields } } : {}),
  }
}

type RawMcpToken = {
  id: string
  label: string
  helper_id: string
  scopes: string[]
  expires_at?: string | null
  last_used_at?: string | null
  revoked_at?: string | null
  active: boolean
}

function mapMcpToken(r: RawMcpToken): McpToken {
  return {
    id: r.id,
    label: r.label,
    helperId: r.helper_id,
    scopes: r.scopes,
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
    active: r.active,
  }
}

// ── Members ────────────────────────────────────────────────────────────────────

type RawMember = {
  id: string
  user_id: string
  name: string
  email: string
  role: string
  channels?: string[] | null
  channel_names?: string[] | null
  last_seen_at?: string | null
  avatar_url?: string | null
}

function mapMember(r: RawMember): CompanyMember {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    email: r.email,
    role: r.role,
    channels: r.channels ?? null,
    channelNames: r.channel_names ?? null,
    lastSeenAt: r.last_seen_at ?? null,
    avatarUrl: r.avatar_url ?? null,
  }
}

// ── P8 raw types + mappers ─────────────────────────────────────────────────────

// Flow: GET /v1/flows returns FlowCard (id, title, status, enabled, count, areas, created_at)
// GET /v1/flows/{id} returns full Flow (adds company_id, version, trigger, nodes, edges, etc.)
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

type RawFlowRun = {
  id: string
  flow_id: string
  status: string
  trigger_summary: string | null
  started_by: string | null
  cost_credits: number
  tokens?: number
  duration: number | null
  waiting_for: string | null
  job_ids: string[]
  started_at: string | null
  ended_at: string | null
}

function mapFlowRun(r: RawFlowRun): FlowRun {
  return {
    id: r.id,
    flowId: r.flow_id,
    status: r.status,
    triggerSummary: r.trigger_summary,
    startedBy: r.started_by,
    costCredits: r.cost_credits,
    tokens: r.tokens ?? 0,
    duration: r.duration,
    waitingFor: r.waiting_for,
    jobIds: r.job_ids ?? [],
    startedAt: r.started_at,
    endedAt: r.ended_at,
  }
}

// Routine: GET /v1/routines returns _routine_to_dict (snake_case)
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

// GET /v1/routines/{id} returns {routine: RoutineRow, runs: []}
type RawRoutineDetail = { routine: RawRoutine & RawRoutineExtras; runs: RawRoutineRun[] }

// KbSource: GET /v1/knowledge/sources → [{id, kind, ref, title, chunks, created_at, …}]
type RawKbSource = {
  id: string
  company_id: string
  kind: string
  ref: string
  title: string
  content_hash: string
  helper_id: string | null
  chunks?: number
  created_at?: string | null
}

function mapKbSource(r: RawKbSource): KbSource {
  return {
    id: r.id,
    companyId: r.company_id,
    kind: r.kind,
    ref: r.ref,
    title: r.title,
    contentHash: r.content_hash,
    helperId: r.helper_id,
    chunks: r.chunks ?? 0,
    createdAt: r.created_at ?? null,
  }
}

// KbItem: GET /v1/knowledge returns [{source_id, heading, text, kind, score}] — already snake_case
type RawKbItem = {
  source_id: string
  heading: string
  text: string
  kind: string
  score: number
}

function mapKbItem(r: RawKbItem): KbItem {
  return {
    sourceId: r.source_id,
    heading: r.heading,
    text: r.text,
    kind: r.kind,
    score: r.score,
  }
}

// Analytics: GET /v1/analytics/overview returns {stats[], series[]} — fields already camelCase (NOT snake_case)
// Helpers: GET /v1/analytics/helpers returns [{helperId, name, jobs, success, tokens, spend}] — already camelCase

// Skills: GET /v1/skills returns SkillCard[] (id, name, status, version, helperId, usageCount — already camelCase via _skill_card)
// GET /v1/skills/{id} returns full Skill (camelCase via _skill_to_dict)

// Helpers: GET /v1/helpers returns HelperStat[] (id, name, area, role, status, jobs, success, isChief — camelCase via _helper_to_stat)
// GET /v1/helpers/{id} returns {helper, jobs[], skills[]} (camelCase via _helper_to_dict)
type RawHelperDetail = { helper: Helper; jobs: unknown[]; skills: unknown[] }

/**
 * Creates a Repos implementation that calls the real backend over HTTP.
 *
 * @param baseUrl  - e.g. "http://localhost:8000"
 * @param getToken - returns the current JWT or null when unauthenticated
 */
export function createHttpRepos(
  baseUrl: string,
  getToken: () => string | null,
): Repos {
  async function get<T>(path: string): Promise<T> {
    const res = await apiFetch(`${baseUrl}${path}`, getToken)
    return res.json() as Promise<T>
  }

  async function getOrNull<T>(path: string): Promise<T | null> {
    try {
      const res = await apiFetch(`${baseUrl}${path}`, getToken)
      return res.json() as Promise<T>
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  }

  // ── channel mapper (surfaces icon, purpose, contextScope from backend DTO) ──
  // The backend channels LIST/GET endpoints return mostly camelCase (by_alias=True).
  // RawChannel (imported from commands.ts) models both camelCase and snake_case
  // field variants so the same type covers the LIST/GET and CREATE responses.
  function mapChannel(raw: RawChannel): Channel {
    return {
      id: raw.id,
      name: raw.name,
      accent: raw.accent as Channel['accent'],
      isDefault: raw.is_default ?? raw.isDefault,
      agentCount: (raw.agent_count ?? raw.agentCount) ?? 0,
      chatCount: (raw.chat_count ?? raw.chatCount) ?? 0,
      openItems: (raw.open_items ?? raw.openItems) ?? 0,
      icon: raw.icon,
      purpose: raw.purpose,
      contextScope: raw.contextScope ?? raw.context_scope ?? 'isolated',
      ...((raw as RawChannel & { color?: string }).color ? { color: (raw as RawChannel & { color?: string }).color } : {}), // sweep/chat
    }
  }

  return {
    channels: {
      list: async () => {
        const rows = await get<RawChannel[]>('/v1/channels')
        return rows.map(mapChannel)
      },
      get: async (id: Id) => {
        const raw = await getOrNull<RawChannel>(`/v1/channels/${id}`)
        return raw ? mapChannel(raw) : null
      },
    },

    folders: {
      listByChannel: (channelId: Id) =>
        get<Folder[]>(`/v1/channels/${channelId}/folders`),
      listAll: () => get<Folder[]>('/v1/folders'),
    },

    goals: {
      listByChannel: (channelId: Id) =>
        get<Goal[]>(`/v1/channels/${channelId}/goals`),
      listAll: () => get<Goal[]>('/v1/goals'),
      // ── sweep/goals-routines ──
      get: async (id: Id) => {
        const raw = await getOrNull<RawGoalDetail>(`/v1/goals/${id}`)
        return raw ? mapGoalDetail(raw) : null
      },
    },

    sessions: {
      get: (id: Id) => getOrNull<Session>(`/v1/sessions/${id}`),
      listByChannel: (channelId: Id) =>
        get<Session[]>(`/v1/channels/${channelId}/sessions`),
      listAll: () => get<Session[]>('/v1/sessions'),
    },

    messages: {
      listBySession: (sessionId: Id) =>
        get<Message[]>(`/v1/sessions/${sessionId}/messages`),
    },

    inbox: {
      list: () => get<InboxItem[]>('/v1/inbox'),
      get: (id: Id) => getOrNull<InboxItem>(`/v1/inbox/${id}`),
    },

    billingPlans: {
      list: async () => {
        const res = await apiFetch(`${baseUrl}/v1/billing/plans`, getToken)
        const raw = await res.json() as RawBillingPlan[]
        return raw.map(mapBillingPlan)
      },
    },

    billingSubscription: {
      get: async () => {
        try {
          const res = await apiFetch(`${baseUrl}/v1/billing/subscription`, getToken)
          const raw = await res.json() as RawBillingSubscription
          // No active subscription → the backend returns all-null fields.
          if (!raw.status && !raw.plan && !raw.plan_id) return null
          return mapBillingSubscription(raw)
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return null
          throw err
        }
      },
    },

    usage: {
      get: async () => {
        const res = await apiFetch(`${baseUrl}/v1/usage`, getToken)
        const raw = await res.json() as RawUsage
        return mapUsage(raw)
      },
    },

    wallet: {
      get: async () => {
        const res = await apiFetch(`${baseUrl}/v1/wallet`, getToken)
        const raw = await res.json() as RawWallet
        return mapWallet(raw)
      },
    },

    aiAccounts: {
      list: async () => {
        const res = await apiFetch(`${baseUrl}/v1/ai-accounts`, getToken)
        const raw = await res.json() as RawAiAccount[]
        return raw.map(mapAiAccount)
      },
      detect: async () => {
        const res = await apiFetch(`${baseUrl}/v1/ai-accounts/detect`, getToken)
        const body = await res.json() as {
          harnesses?: { id: string; name: string; installed: boolean; signed_in: boolean; detail: string }[]
        }
        return (body.harnesses ?? []).map((h) => ({
          id: h.id,
          name: h.name,
          installed: h.installed,
          signedIn: h.signed_in,
          detail: h.detail,
        }))
      },
    },

    marketplace: {
      list: async (params?: { category?: string; q?: string }) => {
        const qs = new URLSearchParams()
        if (params?.category) qs.set('category', params.category)
        if (params?.q) qs.set('q', params.q)
        const query = qs.toString()
        const path = query ? `/v1/marketplace?${query}` : '/v1/marketplace'
        const res = await apiFetch(`${baseUrl}${path}`, getToken)
        const raw = await res.json() as RawPiece[]
        return raw.map(mapPiece)
      },
    },

    connectors: {
      list: async () => {
        const res = await apiFetch(`${baseUrl}/v1/connectors`, getToken)
        const raw = await res.json() as RawConnector[]
        return raw.map(mapConnector)
      },
    },

    mcpTokens: {
      list: async () => {
        const res = await apiFetch(`${baseUrl}/v1/mcp-access-tokens`, getToken)
        const raw = await res.json() as RawMcpToken[]
        return raw.map(mapMcpToken)
      },
    },

    // ── P8 new repos ────────────────────────────────────────────────────────

    flows: {
      list: async () => {
        const res = await apiFetch(`${baseUrl}/v1/flows`, getToken)
        const raw = await res.json() as RawFlowSweep[]
        return raw.map(mapFlowSweep)
      },
      get: async (id: Id) => {
        try {
          const res = await apiFetch(`${baseUrl}/v1/flows/${id}`, getToken)
          const raw = await res.json() as RawFlowSweep
          return mapFlowSweep(raw)
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return null
          throw err
        }
      },
      runs: async (id: Id) => {
        const res = await apiFetch(`${baseUrl}/v1/flows/${id}/runs`, getToken)
        const raw = await res.json() as RawFlowRunSweep[]
        return raw.map(mapFlowRunSweep)
      },
      // ── sweep/inbox-flows ──
      run: async (id: Id, runId: Id) => {
        const raw = await getOrNull<RawFlowRunSweep>(`/v1/flows/${id}/runs/${runId}`)
        return raw ? mapFlowRunSweep(raw) : null
      },
      versions: async (id: Id) => {
        const raw = await get<RawFlowVersion[]>(`/v1/flows/${id}/versions`)
        return raw.map(mapFlowVersion)
      },
      suggestions: async () => {
        const raw = await get<RawFlowSuggestion[]>('/v1/flows/suggestions')
        return raw.map(mapFlowSuggestion)
      },
    },

    routines: {
      list: async () => {
        const res = await apiFetch(`${baseUrl}/v1/routines`, getToken)
        const raw = await res.json() as (RawRoutine & RawRoutineExtras)[]
        return raw.map((r) => ({ ...mapRoutine(r), ...routineExtras(r) }))
      },
      get: async (id: Id) => {
        try {
          const res = await apiFetch(`${baseUrl}/v1/routines/${id}`, getToken)
          const raw = await res.json() as RawRoutineDetail
          return { ...mapRoutine(raw.routine), ...routineExtras(raw.routine, raw.runs) }
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return null
          throw err
        }
      },
      // ── sweep/goals-routines ──
      schedule: async (from: string, to: string) => {
        const qs = new URLSearchParams({ from, to }).toString()
        return mapSchedule(await get<RawSchedule>(`/v1/routines/schedule?${qs}`))
      },
      run: async (routineId: Id, runId: Id) => {
        const raw = await getOrNull<RawRunDetail>(`/v1/routines/${routineId}/runs/${runId}`)
        return raw ? mapRunDetail(raw) : null
      },
      suggestions: async () => (await get<RawSuggestion[]>('/v1/routines/suggestions')).map(mapSuggestion),
    },

    knowledge: {
      sources: async () => {
        const res = await apiFetch(`${baseUrl}/v1/knowledge/sources`, getToken)
        const raw = await res.json() as RawKbSource[]
        return raw.map(mapKbSource)
      },
      list: async (params?: { q?: string }) => {
        const qs = new URLSearchParams()
        if (params?.q) qs.set('q', params.q)
        const query = qs.toString()
        const path = query ? `/v1/knowledge?${query}` : '/v1/knowledge'
        const res = await apiFetch(`${baseUrl}${path}`, getToken)
        const raw = await res.json() as RawKbItem[]
        return raw.map(mapKbItem)
      },
    },

    analytics: {
      overview: async (range?: string) => {
        const qs = range ? `?range=${encodeURIComponent(range)}` : ''
        const res = await apiFetch(`${baseUrl}/v1/analytics/overview${qs}`, getToken)
        // Response fields are already camelCase from the backend (stats, series)
        return res.json() as Promise<AnalyticsOverview>
      },
      helpers: async (range?: string) => {
        const qs = range ? `?range=${encodeURIComponent(range)}` : ''
        const res = await apiFetch(`${baseUrl}/v1/analytics/helpers${qs}`, getToken)
        // Response fields are already camelCase: helperId, name, jobs, success, tokens, spend
        return res.json() as Promise<HelperStat[]>
      },
      // ── sweep/team-analytics ──
      overviewFor: (range: string, channelId?: string) =>
        get<AnalyticsOverview>(`/v1/analytics/overview${analyticsQs(range, channelId)}`),
      helpersFor: (range: string, channelId?: string) =>
        get<HelperStat[]>(`/v1/analytics/helpers${analyticsQs(range, channelId)}`),
      spendByChannel: (range: string, channelId?: string) =>
        get<AnalyticsStackedSeries>(`/v1/analytics/spend-by-channel${analyticsQs(range, channelId)}`),
      tokensByHelper: (range: string, channelId?: string) =>
        get<AnalyticsStackedSeries>(`/v1/analytics/tokens-by-helper${analyticsQs(range, channelId)}`),
      loops: (range: string) => get<AnalyticsLoop[]>(`/v1/analytics/loops${analyticsQs(range)}`),
      reliability: (range: string, channelId?: string) =>
        get<AnalyticsReliability>(`/v1/analytics/reliability${analyticsQs(range, channelId)}`),
      failures: (range: string, channelId?: string) =>
        get<AnalyticsFailure[]>(`/v1/analytics/failures${analyticsQs(range, channelId)}`),
      activity: (q: ActivityQuery) => {
        const p = new URLSearchParams()
        if (q.kinds) p.set('kinds', q.kinds.join(','))
        if (q.helperIds) p.set('helper', q.helperIds.join(','))
        if (q.cursor) p.set('cursor', q.cursor)
        if (q.limit) p.set('limit', String(q.limit))
        if (q.channelId) p.set('channel_id', q.channelId)
        const qs = p.toString()
        return get<ActivityPage>(`/v1/activity${qs ? `?${qs}` : ''}`)
      },
    },

    skills: {
      list: async () => {
        const res = await apiFetch(`${baseUrl}/v1/skills`, getToken)
        // Already camelCase: id, name, status, version, helperId, usageCount
        return res.json() as Promise<Skill[]>
      },
      get: async (id: Id) => {
        try {
          const res = await apiFetch(`${baseUrl}/v1/skills/${id}`, getToken)
          return res.json() as Promise<Skill>
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return null
          throw err
        }
      },
    },

    helpers: {
      list: async () => {
        const res = await apiFetch(`${baseUrl}/v1/helpers`, getToken)
        // Already camelCase: id, name, area, role, status, jobs, success, isChief
        return res.json() as Promise<Helper[]>
      },
      get: async (id: Id) => {
        try {
          const res = await apiFetch(`${baseUrl}/v1/helpers/${id}`, getToken)
          const raw = await res.json() as RawHelperDetail
          return raw.helper
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return null
          throw err
        }
      },
      // ── sweep/team-analytics ──
      detail: (id: Id) => getOrNull<HelperDetail>(`/v1/helpers/${id}`),
      channels: (id: Id) => get<HelperChannelBinding[]>(`/v1/helpers/${id}/channels`),
      tools: (id: Id) => get<HelperTools>(`/v1/helpers/${id}/tools`),
      skillRows: (id: Id) => get<HelperSkillRow[]>(`/v1/helpers/${id}/skills`),
      files: (id: Id) => get<HelperFile[]>(`/v1/helpers/${id}/files`),
    },

    members: {
      list: async () => {
        const res = await apiFetch(`${baseUrl}/v1/members`, getToken)
        const raw = await res.json() as RawMember[]
        return raw.map(mapMember)
      },
    },

    // ── sweep/docs ──
    docs: {
      list: async (params?: { helperId?: string; kind?: string }) => {
        const qs = new URLSearchParams()
        if (params?.helperId) qs.set('helper_id', params.helperId)
        if (params?.kind) qs.set('kind', params.kind)
        const query = qs.toString()
        const raw = await get<RawDoc[]>(query ? `/v1/memory?${query}` : '/v1/memory')
        return raw.map(mapDoc)
      },
      get: async (id: Id) => {
        const raw = await getOrNull<RawDocDetail>(`/v1/memory/${encodeURIComponent(id)}`)
        return raw ? mapDocDetail(raw) : null
      },
      versions: async (id: Id) => get<DocVersion[]>(`/v1/memory/${encodeURIComponent(id)}/versions`),
      graph: async () => get<DocGraph>('/v1/memory/graph'),
    },
    lessons: {
      list: async (params?: { status?: 'review' | 'active' }) => {
        const raw = await get<RawLesson[]>(params?.status ? `/v1/lessons?status=${params.status}` : '/v1/lessons')
        return raw.map(mapLesson)
      },
    },
    handbook: {
      index: async () => {
        const raw = await get<{ files: RawHandbookFile[]; open_suggestions: number }>('/v1/handbook')
        return { files: raw.files.map(mapHandbookFile), openSuggestions: raw.open_suggestions }
      },
      file: async (name: string) => {
        const raw = await getOrNull<RawHandbookDetail>(`/v1/handbook/${encodeURIComponent(name)}`)
        return raw ? mapHandbookDetail(raw) : null
      },
      suggestions: async (params?: { file?: string; status?: string }) => {
        const qs = new URLSearchParams()
        if (params?.file) qs.set('file', params.file)
        if (params?.status) qs.set('status', params.status)
        const raw = await get<RawHandbookSuggestion[]>(`/v1/handbook/suggestions?${qs.toString()}`)
        return raw.map(mapHandbookSuggestion)
      },
    },

    // ── sweep/inbox-flows ──
    proposals: {
      get: async (id: Id) => {
        const raw = await getOrNull<RawProposalDetail>(`/v1/proposals/${id}`)
        return raw ? mapProposalDetail(raw) : null
      },
    },

    // ── sweep/chat ──
    chat: {
      archived: (areaId: Id | null) =>
        get<Session[]>(`/v1/sessions?archived=1${areaId ? `&channel_id=${encodeURIComponent(areaId)}` : ''}`),
      chiefThreads: () => get<Session[]>('/v1/sessions?kind=chief_private'),
      chiefNudges: () => get<ChiefNudge[]>('/v1/chief/nudges'),
      folder: (id: Id) => getOrNull<Folder>(`/v1/folders/${id}`),
      folderFiles: (id: Id) => get<FolderFile[]>(`/v1/folders/${id}/files`),
      folderShares: (id: Id) => get<Shares>(`/v1/folders/${id}/shares`),
      sessionShares: (id: Id) => get<Shares>(`/v1/sessions/${id}/shares`),
      sessionResults: (id: Id) => get<SessionResults>(`/v1/sessions/${id}/results`),
    },

    // ── sweep/control ──
    controlPanel: createHttpControlPanelRepo(baseUrl, getToken),
  }
}

// ── sweep/docs ──────────────────────────────────────────────────────────────

export type RawDoc = {
  id: string
  path: string
  title: string
  content: string
  kind: string
  area: string | null
  pinned: boolean
  hidden: boolean
  helper_id: string | null
  version: number
  updatedAt: string | null
  updatedBy: string
  createdAt: string | null
  createdBy: string
}

type RawDocDetail = RawDoc & {
  links: DocDetail['links']
  goals: DocDetail['goals']
  unresolved: string[]
  backlinks: DocDetail['backlinks']
}

export function mapDoc(r: RawDoc): DocSummary {
  return {
    id: r.id,
    path: r.path,
    title: r.title,
    content: r.content,
    kind: r.kind ?? 'doc',
    area: r.area ?? null,
    pinned: !!r.pinned,
    hidden: !!r.hidden,
    helperId: r.helper_id ?? null,
    version: r.version ?? 1,
    updatedAt: r.updatedAt ?? null,
    updatedBy: r.updatedBy ?? '',
    createdAt: r.createdAt ?? null,
    createdBy: r.createdBy ?? r.updatedBy ?? '',
  }
}

function mapDocDetail(r: RawDocDetail): DocDetail {
  return {
    ...mapDoc(r),
    links: r.links ?? [],
    goals: r.goals ?? [],
    unresolved: r.unresolved ?? [],
    backlinks: r.backlinks ?? [],
  }
}

export type RawLesson = {
  id: string
  helper_id: string | null
  tag: Lesson['tag']
  text: string
  source: string
  status: Lesson['status']
  created_by: string
  created_at: string | null
}

export function mapLesson(r: RawLesson): Lesson {
  return {
    id: r.id,
    helperId: r.helper_id,
    tag: r.tag,
    text: r.text,
    source: r.source,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }
}

type RawHandbookFile = {
  id: string
  name: string
  title: string
  description: string
  visibility: HandbookFile['visibility']
  brief: boolean
  version: number
  updated_at: string | null
  updated_by: string
  open_suggestions: number
}

export type RawHandbookSuggestion = {
  id: string
  doc_id: string
  file: string | null
  helper_id: string | null
  author: string
  text: string
  proposed_content: string | null
  status: HandbookSuggestion['status']
  created_at: string | null
  resolved_at: string | null
}

export type RawHandbookDetail = RawHandbookFile & {
  content: string
  versions: { version: number; updated_by: string; note: string | null; created_at: string | null }[]
  suggestions: RawHandbookSuggestion[]
}

function mapHandbookFile(r: RawHandbookFile): HandbookFile {
  return {
    id: r.id,
    name: r.name,
    title: r.title,
    description: r.description,
    visibility: r.visibility,
    brief: r.brief,
    version: r.version,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
    openSuggestions: r.open_suggestions,
  }
}

export function mapHandbookSuggestion(r: RawHandbookSuggestion): HandbookSuggestion {
  return {
    id: r.id,
    docId: r.doc_id,
    file: r.file,
    helperId: r.helper_id,
    author: r.author,
    text: r.text,
    proposedContent: r.proposed_content,
    status: r.status,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  }
}

export function mapHandbookDetail(r: RawHandbookDetail): HandbookFileDetail {
  return {
    ...mapHandbookFile(r),
    content: r.content,
    versions: (r.versions ?? []).map((v) => ({ version: v.version, updatedBy: v.updated_by, note: v.note, createdAt: v.created_at })),
    suggestions: (r.suggestions ?? []).map(mapHandbookSuggestion),
  }
}

// ── sweep/inbox-flows ──

type RawFlowRunStep = {
  node_id: string
  kind: string
  label: string
  status: string
  duration_ms?: number
  output?: Record<string, unknown>
  note?: string
}

type RawFlowRunSweep = RawFlowRun & { steps?: RawFlowRunStep[] }

type RawFlowSweep = RawFlow & {
  settings?: Record<string, unknown>
  trigger_kind?: string | null
  apps?: string[]
  ai_steps?: number
  runs_7d?: number[]
  last_run?: RawFlowRunSweep | null
  tokens_this_month?: number
  publish_state?: 'draft' | 'pending' | 'live'
  pending_proposal_id?: string | null
  published_version?: number | null
}

export function mapFlowRunSweep(r: RawFlowRunSweep): FlowRun {
  const run = mapFlowRun(r)
  if (r.steps) {
    run.steps = r.steps.map((st) => ({
      nodeId: st.node_id,
      kind: st.kind,
      label: st.label,
      status: st.status,
      durationMs: st.duration_ms ?? 0,
      output: st.output,
      note: st.note,
    }))
  }
  return run
}

export function mapFlowSweep(r: RawFlowSweep): Flow {
  const f: Flow = mapFlow(r)
  if (r.settings !== undefined) f.settings = r.settings
  if (r.trigger_kind !== undefined) f.triggerKind = r.trigger_kind
  if (r.apps !== undefined) f.apps = r.apps
  if (r.ai_steps !== undefined) f.aiSteps = r.ai_steps
  if (r.runs_7d !== undefined) f.runs7d = r.runs_7d
  if (r.last_run !== undefined) f.lastRun = r.last_run ? mapFlowRunSweep(r.last_run) : null
  if (r.tokens_this_month !== undefined) f.tokensThisMonth = r.tokens_this_month
  if (r.publish_state !== undefined) f.publishState = r.publish_state
  if (r.pending_proposal_id !== undefined) f.pendingProposalId = r.pending_proposal_id
  if (r.published_version !== undefined) f.publishedVersion = r.published_version
  return f
}

type RawFlowVersion = {
  id: string
  flow_id: string
  version: number
  title: string
  note: string
  status: string
  created_by: string
  node_count: number
  created_at: string | null
}

function mapFlowVersion(r: RawFlowVersion): FlowVersionInfo {
  return {
    id: r.id,
    flowId: r.flow_id,
    version: r.version,
    title: r.title,
    note: r.note,
    status: r.status,
    createdBy: r.created_by,
    nodeCount: r.node_count,
    createdAt: r.created_at,
  }
}

type RawFlowSuggestion = Omit<FlowSuggestion, 'runsAs' | 'helperArea'> & { runs_as: string; helper_area: HelperArea }

function mapFlowSuggestion(r: RawFlowSuggestion): FlowSuggestion {
  const { runs_as, helper_area, ...rest } = r
  return { ...rest, runsAs: runs_as, helperArea: helper_area }
}

type RawProposalDetail = {
  proposal: {
    id: string
    type: string
    risk: string
    title: string
    body_md: string
    status: string
    helper_id: string
    assignee?: string | null
    due?: string | null
    params?: Record<string, unknown> | null
    created_at: string | null
  }
  revisions: { n: number; author: string; summary: string; body_md: string; at: string | null }[]
}

export function mapProposalDetail(r: RawProposalDetail): ProposalDetail {
  const p = r.proposal
  return {
    id: p.id,
    type: p.type,
    risk: p.risk,
    title: p.title,
    bodyMd: p.body_md,
    status: p.status,
    helperId: p.helper_id,
    assignee: p.assignee ?? null,
    due: p.due ?? null,
    params: p.params ?? null,
    createdAt: p.created_at,
    revisions: (r.revisions ?? []).map((v) => ({ n: v.n, author: v.author, summary: v.summary, bodyMd: v.body_md, at: v.at })),
  }
}

// ── sweep/team-analytics ──

import type {
  ActivityPage,
  AnalyticsFailure,
  AnalyticsLoop,
  AnalyticsReliability,
  AnalyticsStackedSeries,
  HelperChannelBinding,
  HelperDetail,
  HelperFile,
  HelperSkillRow,
  HelperTools,
} from '../../core/domain/types'
import type { ActivityQuery } from '../../core/ports/repos'

/** ?range=…&channel_id=… for the analytics endpoints. */
function analyticsQs(range: string, channelId?: string): string {
  const p = new URLSearchParams({ range })
  if (channelId) p.set('channel_id', channelId)
  return `?${p.toString()}`
}


// ── sweep/control ──
// Control-panel reads. snake_case → camelCase mapping lives here.

type RawCompanyDetail = {
  id: string; name: string; timezone?: string; logo_url?: string | null; plan_id?: string | null
  currency?: string; autonomy_default?: string; pic_role?: string | null; industry?: string | null
}
type RawSeats = {
  self_hosted: boolean; unlimited?: boolean; plan_id: string | null; plan_name: string | null; included: number | null
  total: number | null; max: number | null; available: number | null; seat_price_idr: number | null
  can_add: boolean; used: number; pending: number; viewers: number
  billing_interval?: 'monthly' | 'yearly'; period_end?: string | null
}
type RawInvite = {
  id: string; email: string; role: string; channel_ids?: string[] | null; channel_names?: string[] | null
  expires_at: string; created_at?: string | null; invited_by?: string | null
}
type RawManagedChannel = {
  id: string; name: string; accent: string; icon: string | null; purpose: string | null; is_default: boolean
  context_scope: string; chat_count: number; goal_count: number
  helpers: { id: string; name: string; area: string; is_chief: boolean }[]
  helper_count: number; people_count: number | null; archived: boolean; archived_at: string | null; muted: boolean
}
type RawAuditEvent = {
  id: string; at: string; actor_type: string; actor_id: string | null; actor_name: string
  actor_area: string | null; type: string; action: string; target: string; channel: string | null
}
type RawExport = {
  id: string; status: string; filename: string; size_bytes: number; summary: Record<string, number>
  error: string | null; created_at: string | null; expires_at: string | null
}
type RawSession = {
  id: string; label: string; kind: string; method: string | null; ip: string | null
  created_at: string | null; last_seen_at: string | null; current: boolean
}
type RawPayment = {
  id: string; kind: string; status: string; credits: number; amount_idr: number
  hosted_url: string | null; plan_id: string | null; created_at: string | null
}

export type RawMcpServer = {
  id: string; name: string; kind: string; url: string | null; auth_type: string; token_hint: string | null
  status: string; error: string | null; tools: { name: string; description: string; level: string }[]
  enabled: boolean; created_at: string | null
}

export function mapMcpServer(r: RawMcpServer): McpServer {
  return {
    id: r.id, name: r.name, kind: r.kind, url: r.url, authType: r.auth_type, tokenHint: r.token_hint,
    status: r.status, error: r.error, tools: r.tools ?? [], enabled: r.enabled, createdAt: r.created_at,
  }
}

export function mapManagedChannel(r: RawManagedChannel): ManagedChannel {
  return {
    id: r.id, name: r.name, accent: r.accent, icon: r.icon, purpose: r.purpose, isDefault: r.is_default,
    contextScope: r.context_scope, chatCount: r.chat_count, goalCount: r.goal_count,
    helpers: (r.helpers ?? []).map((h) => ({ id: h.id, name: h.name, area: h.area, isChief: h.is_chief })),
    helperCount: r.helper_count, peopleCount: r.people_count, archived: r.archived,
    archivedAt: r.archived_at, muted: r.muted,
  }
}

export function mapInvite(r: RawInvite): Invite {
  return {
    id: r.id, email: r.email, role: r.role, channelIds: r.channel_ids ?? null,
    channelNames: r.channel_names ?? null, expiresAt: r.expires_at, createdAt: r.created_at ?? null,
    invitedBy: r.invited_by ?? null,
  }
}

export function mapCompanyDetail(r: RawCompanyDetail): CompanyDetail {
  return {
    id: r.id, name: r.name, timezone: r.timezone ?? 'UTC', logoUrl: r.logo_url ?? null,
    planId: r.plan_id ?? null, currency: r.currency ?? 'IDR', autonomyDefault: r.autonomy_default ?? 'ask',
    picRole: r.pic_role ?? null, industry: r.industry ?? null,
  }
}

export function mapPayment(r: RawPayment): Payment {
  return {
    id: r.id, kind: r.kind, status: r.status, credits: r.credits, amountIdr: r.amount_idr,
    hostedUrl: r.hosted_url, planId: r.plan_id, createdAt: r.created_at,
  }
}

function createHttpControlPanelRepo(baseUrl: string, getToken: () => string | null): ControlPanelRepo {
  async function get<T>(path: string): Promise<T> {
    const res = await apiFetch(`${baseUrl}${path}`, getToken)
    return res.json() as Promise<T>
  }
  return {
    company: async () => mapCompanyDetail(await get<RawCompanyDetail>('/v1/company')),
    seats: async () => {
      const r = await get<RawSeats>('/v1/billing/seats')
      return {
        selfHosted: r.self_hosted, unlimited: r.unlimited ?? r.self_hosted, planId: r.plan_id, planName: r.plan_name, included: r.included,
        total: r.total, max: r.max, available: r.available, seatPriceIdr: r.seat_price_idr,
        canAdd: r.can_add, used: r.used, pending: r.pending, viewers: r.viewers,
        billingInterval: r.billing_interval, periodEnd: r.period_end ?? null,
      }
    },
    packs: async () => {
      const raw = await get<{ id: string; credits: number; amount_idr: number; label: string; sub: string; badge: string | null }[]>('/v1/billing/packs')
      return raw.map((p) => ({ id: p.id, credits: p.credits, amountIdr: p.amount_idr, label: p.label, sub: p.sub, badge: p.badge }))
    },
    invoices: async () => {
      const raw = await get<{ id: string; amount: number; currency: string; status: string; period: string; provider: string; created_at: string | null }[]>('/v1/billing/invoices')
      return raw.map((i) => ({ id: i.id, amount: i.amount, currency: i.currency, status: i.status, period: i.period, provider: i.provider, createdAt: i.created_at }))
    },
    ledger: async () => {
      const raw = await get<{ id: string; delta: number; reason: string; credits_charged: number; created_at: string; helper_id: string | null; balance_after: number }[]>('/v1/billing/ledger')
      return raw.map((l) => ({ id: l.id, delta: l.delta, reason: l.reason, creditsCharged: l.credits_charged, createdAt: l.created_at, helperId: l.helper_id, balanceAfter: l.balance_after }))
    },
    payment: async (id: string) => {
      try {
        return mapPayment(await get<RawPayment>(`/v1/wallet/payments/${id}`))
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    invites: async () => (await get<RawInvite[]>('/v1/auth/invites')).map(mapInvite),
    channels: async () => (await get<RawManagedChannel[]>('/v1/channels/manage')).map(mapManagedChannel),
    audit: async (q?: AuditQuery) => {
      const params = new URLSearchParams()
      if (q?.type) params.set('type', q.type)
      if (q?.actor) params.set('actor', q.actor)
      if (q?.days) params.set('days', String(q.days))
      if (q?.cursor) params.set('cursor', q.cursor)
      if (q?.limit) params.set('limit', String(q.limit))
      const qs = params.toString()
      const raw = await get<{ events: RawAuditEvent[]; next_cursor: string | null }>(`/v1/audit${qs ? `?${qs}` : ''}`)
      return {
        events: raw.events.map((e) => ({
          id: e.id, at: e.at, actorType: e.actor_type, actorId: e.actor_id, actorName: e.actor_name,
          actorArea: e.actor_area, type: e.type, action: e.action, target: e.target, channel: e.channel,
        })),
        nextCursor: raw.next_cursor,
      }
    },
    storage: async () => {
      const r = await get<{ used_bytes: number; quota_bytes: number | null; segments: { key: string; label: string; bytes: number; counted?: boolean }[] }>('/v1/data/storage')
      return { usedBytes: r.used_bytes, quotaBytes: r.quota_bytes, segments: r.segments }
    },
    exports: async () => (await get<RawExport[]>('/v1/data/exports')).map(mapExport),
    account: async () => {
      const r = await get<{ id: string; email: string; name: string; avatar_url: string | null; role: string | null; company_name: string | null; two_factor_enabled: boolean; email_verified: boolean; google_linked: boolean }>('/v1/me/account')
      return {
        id: r.id, email: r.email, name: r.name, avatarUrl: r.avatar_url, role: r.role, companyName: r.company_name,
        twoFactorEnabled: r.two_factor_enabled, emailVerified: r.email_verified, googleLinked: r.google_linked,
      }
    },
    preferences: () => get<UserPreferences>('/v1/me/preferences'),
    sessions: async () => (await get<RawSession[]>('/v1/me/sessions')).map((s) => ({
      id: s.id, label: s.label, kind: s.kind, method: s.method, ip: s.ip, createdAt: s.created_at,
      lastSeenAt: s.last_seen_at, current: s.current,
    })),
    mcpServers: async () => (await get<RawMcpServer[]>('/v1/mcp-servers')).map(mapMcpServer),
    telemetryOptedOut: async () => (await get<{ opted_out?: boolean }>('/v1/telemetry-config')).opted_out ?? false,
  }
}

export function mapExport(r: RawExport): DataExport {
  return {
    id: r.id, status: r.status, filename: r.filename, sizeBytes: r.size_bytes, summary: r.summary ?? {},
    error: r.error, createdAt: r.created_at, expiresAt: r.expires_at,
  }
}
