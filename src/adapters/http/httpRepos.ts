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
} from '../../core/domain/types'
import type { Repos } from '../../core/ports/repos'
import { apiFetch, ApiError } from './client'
import type { RawChannel } from './commands'

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
  }
}

type RawBillingSubscription = {
  plan_id: string
  status: string
  current_period_end: string | null
  seats: number
  billing_interval: 'monthly' | 'yearly'
  is_trial: boolean
  trial_ends_at: string | null
  trial_days_left: number
}

function mapBillingSubscription(r: RawBillingSubscription): BillingSubscription {
  return {
    planId: r.plan_id,
    status: r.status,
    currentPeriodEnd: r.current_period_end,
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
type RawRoutineDetail = { routine: RawRoutine; runs: unknown[] }

// KbSource: GET /v1/knowledge/sources — this endpoint does NOT exist on the backend yet.
// The frontend repo is defined for forward-compatibility; it will 404 until the endpoint is added.
type RawKbSource = {
  id: string
  company_id: string
  kind: string
  ref: string
  title: string
  content_hash: string
  helper_id: string | null
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
        const raw = await res.json() as RawFlow[]
        return raw.map(mapFlow)
      },
      get: async (id: Id) => {
        try {
          const res = await apiFetch(`${baseUrl}/v1/flows/${id}`, getToken)
          const raw = await res.json() as RawFlow
          return mapFlow(raw)
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return null
          throw err
        }
      },
      runs: async (id: Id) => {
        const res = await apiFetch(`${baseUrl}/v1/flows/${id}/runs`, getToken)
        const raw = await res.json() as RawFlowRun[]
        return raw.map(mapFlowRun)
      },
    },

    routines: {
      list: async () => {
        const res = await apiFetch(`${baseUrl}/v1/routines`, getToken)
        const raw = await res.json() as RawRoutine[]
        return raw.map(mapRoutine)
      },
      get: async (id: Id) => {
        try {
          const res = await apiFetch(`${baseUrl}/v1/routines/${id}`, getToken)
          const raw = await res.json() as RawRoutineDetail
          return mapRoutine(raw.routine)
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return null
          throw err
        }
      },
    },

    knowledge: {
      sources: async () => {
        // NOTE: GET /v1/knowledge/sources does NOT exist on the backend yet.
        // This call will fail until the endpoint is added. Flagged as absent.
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
    },

    members: {
      list: async () => {
        const res = await apiFetch(`${baseUrl}/v1/members`, getToken)
        const raw = await res.json() as RawMember[]
        return raw.map(mapMember)
      },
    },
  }
}
