/**
 * Control-panel domain types (sweep/control).
 *
 * Read models for the control-panel sections that had no backend before:
 * company detail, seats, credit packs, invites, managed channels, activity
 * log, storage + exports, account/sessions/preferences, billing history and
 * external MCP servers.
 */
import type { Id } from './types'

export interface CompanyDetail {
  id: Id
  name: string
  timezone: string
  logoUrl: string | null
  planId: string | null
  currency: string
  autonomyDefault: string
  picRole: string | null
  industry: string | null
}

export interface SeatSummary {
  selfHosted: boolean
  /** Cloud plans are per company: unlimited people, no seats to buy. */
  unlimited?: boolean
  planId: string | null
  planName: string | null
  /** Seats included in the plan (null on self-hosted). */
  included: number | null
  /** Seats paid for (included + extra). */
  total: number | null
  /** Plan maximum (null = no maximum). */
  max: number | null
  /** Free seats left after members + pending invites. */
  available: number | null
  /** Rp per extra seat per month; null = plan sells no extra seats. */
  seatPriceIdr: number | null
  canAdd: boolean
  /** Members/admins/owners holding a seat. */
  used: number
  /** Open non-viewer invites (each holds a seat). */
  pending: number
  viewers: number
  billingInterval?: 'monthly' | 'yearly'
  periodEnd?: string | null
}

export interface CreditPack {
  id: string
  credits: number
  amountIdr: number
  label: string
  sub: string
  badge: string | null
}

export interface Invite {
  id: Id
  email: string
  role: string
  channelIds: string[] | null
  channelNames: string[] | null
  expiresAt: string
  createdAt: string | null
  invitedBy: string | null
}

export interface ManagedChannelHelper {
  id: Id
  name: string
  area: string
  isChief: boolean
}

export interface ManagedChannel {
  id: Id
  name: string
  accent: string
  icon: string | null
  purpose: string | null
  isDefault: boolean
  contextScope: string
  chatCount: number
  goalCount: number
  helpers: ManagedChannelHelper[]
  helperCount: number
  /** null = everyone in the company. */
  peopleCount: number | null
  archived: boolean
  archivedAt: string | null
  muted: boolean
}

export type AuditType =
  | 'members' | 'billing' | 'settings' | 'helpers' | 'connectors'
  | 'approvals' | 'channels' | 'skills' | 'data' | 'account'

export interface AuditEvent {
  id: Id
  at: string
  actorType: 'person' | 'agent' | 'system' | string
  actorId: string | null
  actorName: string
  actorArea: string | null
  type: AuditType | string
  action: string
  target: string
  channel: string | null
}

export interface AuditPage {
  events: AuditEvent[]
  nextCursor: string | null
}

export interface AuditQuery {
  type?: string
  actor?: string
  days?: number
  cursor?: string
  limit?: number
}

export interface StorageSegment {
  key: string
  label: string
  bytes: number
  /** Counts toward the plan's storage (docs, files, knowledge). Chats and run logs are free. */
  counted?: boolean
}

export interface StorageSummary {
  usedBytes: number
  /** Counted bytes only. null = no quota (self-hosted). */
  quotaBytes: number | null
  segments: StorageSegment[]
}

export interface DataExport {
  id: Id
  status: 'pending' | 'ready' | 'failed' | string
  filename: string
  sizeBytes: number
  summary: Record<string, number>
  error: string | null
  createdAt: string | null
  expiresAt: string | null
}

export interface SignInSession {
  id: Id
  label: string
  kind: 'desktop' | 'mobile' | 'cli' | string
  method: string | null
  ip: string | null
  createdAt: string | null
  lastSeenAt: string | null
  current: boolean
}

export interface AccountInfo {
  id: Id
  email: string
  name: string
  avatarUrl: string | null
  role: string | null
  companyName: string | null
  twoFactorEnabled: boolean
  emailVerified: boolean
  googleLinked: boolean
}

export type NotifChannel = 'app' | 'whatsapp' | 'email' | 'push'

/** Per-user preferences (GET/PATCH /v1/me/preferences). Open shape, deep-merged. */
export interface UserPreferences {
  nickname?: string
  language?: string
  notifications?: {
    matrix?: { label: string; channels: Partial<Record<NotifChannel, boolean>> }[]
    weekends?: boolean
    quietHours?: { from: string; to: string } | null
  }
  [key: string]: unknown
}

export interface Invoice {
  id: Id
  amount: number
  currency: string
  status: string
  period: string
  provider: string
  createdAt: string | null
}

export interface LedgerEntry {
  id: Id
  delta: number
  reason: string
  creditsCharged: number
  createdAt: string
  helperId: string | null
  balanceAfter: number
}

export interface Payment {
  id: Id
  kind: string
  status: string
  credits: number
  amountIdr: number
  hostedUrl: string | null
  planId: string | null
  createdAt: string | null
}

export type McpToolLevel = 'read' | 'ask' | 'blocked'

export interface McpServerTool {
  name: string
  description: string
  level: McpToolLevel | string
}

export interface McpServer {
  id: Id
  name: string
  kind: 'remote' | 'openapi' | string
  url: string | null
  authType: string
  tokenHint: string | null
  status: 'connected' | 'error' | 'pending' | string
  error: string | null
  tools: McpServerTool[]
  enabled: boolean
  createdAt: string | null
}

export interface ConnectorAuth {
  type: string
  provider: string | null
  fields: string[]
}
