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
  Channel,
  Connector,
  Folder,
  Goal,
  Id,
  McpToken,
  Message,
  Piece,
  Session,
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
// mcp-access-tokens) return snake_case fields that must be mapped here.

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
  }
}
