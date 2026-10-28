export type Id = string

export type HelperArea = 'brand' | 'ops' | 'dev' | 'support' | 'finance' | 'marketing' | 'sales' | 'retro'

/** Accent a channel (= company area) is drawn with. `general` is the neutral default channel. */
export type ChannelAccent = 'general' | 'dev' | 'marketing' | 'sales'

export interface Company {
  id: Id
  name: string
  color: string
  /** P5d profile fields — may be absent on legacy records. */
  industry?: string | null
  teamSize?: string | null
  region?: string | null
  currency?: string
  picRole?: string | null
  timezone?: string | null
}

export interface Helper {
  id: Id
  name: string
  area: HelperArea
  /** Role / title (e.g. "Chief of Staff"). */
  role?: string
  /** Health status: 'active' | 'paused' | 'error'. */
  status?: string
  /** True if this is the Chief helper. */
  isChief?: boolean
  /** Autonomy cap: 'yolo' | 'review_first' | 'off'. */
  autonomyCap?: string | null
  /** Free-text job description. */
  jobDescription?: string
  /** Job count in current period (from HelperStat list endpoint). */
  jobs?: number
  /** Success percentage 0-100 (from HelperStat list endpoint). */
  success?: number
}

export interface Channel {
  id: Id
  name: string
  accent: ChannelAccent
  /** The default channel is shown as "Default channel · Chief". */
  isDefault?: boolean
  /** Agents besides Chief that work in this channel. */
  agentCount: number
  chatCount: number
  /** Open Office items in this area (Office › Areas counts). */
  openItems: number
  /** Lucide icon name for the area, e.g. 'rocket', 'headphones'. */
  icon?: string
  /** One-line purpose description for the area. */
  purpose?: string
  /** Agent context scope: 'isolated' | 'isolated_general'. Defaults to 'isolated'. */
  contextScope: string
}

/**
 * An "Area" is the user-facing name for a Channel — the same underlying data,
 * relabeled across the UI. Both modes filter by the selected Area.
 */
export type Area = Channel
export type AreaAccent = ChannelAccent

export interface Goal {
  id: Id
  channelId: Id
  title: string
  /** 0–100 */
  progress: number
}

export interface Folder {
  id: Id
  channelId: Id
  name: string
  /** Total chats in the folder (may exceed the chats listed in the sidebar). */
  count: number
}

export interface Model {
  id: Id
  label: string
}

export interface MessageAuthor {
  kind: 'you' | 'helper'
  name: string
  /** Job title shown next to the name, e.g. "Chief of Staff". */
  role?: string
  area?: HelperArea
}

export interface MessageAttachment {
  title: string
  meta: string
}

export interface MessageAction {
  label: string
  primary?: boolean
}

export interface Message {
  id: Id
  sessionId: Id
  author: MessageAuthor
  content: string
  createdAt: string
  /** If true, render as a centered event line ("Chief added Dev to this chat"). */
  system?: boolean
  /** Optional doc/file attachment card displayed under the message */
  attachment?: MessageAttachment
  /** Optional suggested-action buttons rendered below the message */
  actions?: MessageAction[]
}

export interface SessionParticipant {
  name: string
  area: HelperArea
}

export interface Session {
  id: Id
  title: string
  channelId?: Id
  /** Folder the chat is filed under; chats without a folder show under Recent. */
  folderId?: Id
  /** Relative "last activity" label, e.g. "now", "2h", "Yesterday". */
  updated: string
  unread?: boolean
  /** Goal this chat is linked to (topbar pill). */
  goal?: string
  /** Helpers in the chat (topbar avatars). */
  participants?: SessionParticipant[]
}

export interface InboxProposal {
  who: string
  area: HelperArea
  text: string
  due: string
}

export interface InboxAction {
  label: string
  primary?: boolean
  icon?: 'check' | 'reply'
}

// ── Billing / Plans / Subscription ───────────────────────────────────────────

export interface BillingPlan {
  id: string
  tier: string
  name: string
  monthlyPriceUsd: number
  monthlyPriceIdr: number
  yearlyPriceUsd: number
  yearlyPriceIdr: number
  includedCredits: number
  seats: number
  trialDays: number
}

export interface BillingSubscription {
  planId: string
  status: string
  currentPeriodEnd: string | null
  seats: number
  billingInterval: 'monthly' | 'yearly'
  isTrial: boolean
  trialEndsAt: string | null
  trialDaysLeft: number
}

// ── Billing / Usage ───────────────────────────────────────────────────────────

export interface UsageSummary {
  /** Current credit balance. */
  balance: number
  /** Credits included in the plan (0 if no plan). */
  included: number
  /** Credits consumed this billing period (job charges). */
  usedThisPeriod: number
  /** Per-helper breakdown for this period. */
  byHelper: { helperId: string; credits: number }[]
  /** Per-day breakdown for this period. */
  byDay: { day: string; credits: number }[]
  /** Pending Doit top-up payments (count + total_credits). */
  pendingTopups?: { count: number; totalCredits: number } | null
  /** Most recent DoitPayment (any kind/status). */
  lastPayment?: {
    id: string
    kind: string
    status: string
    amountIdr: number
    createdAt: string | null
  } | null
}

export interface WalletSettings {
  /** Whether auto top-up is enabled. */
  autoTopupEnabled: boolean
  /** Balance threshold (credits) that triggers an auto top-up. */
  autoTopupThresholdCredits: number
  /** Credit pack to buy on auto top-up ('small' | 'medium' | 'large'). */
  autoTopupPack?: string | null
}

// ── AI Account Pool ───────────────────────────────────────────────────────────

export interface AiAccount {
  id: Id
  /** Harness name, e.g. 'claude', 'openai'. */
  harness: string
  /** Display name (backend label). */
  name: string
  /** Optional free-text tag for grouping. */
  tag?: string | null
  /** Account health status: 'ready' | 'near_limit' | 'cooling' | 'error'. */
  status: string
  /** Context-window usage percentage (0–100). */
  pctWindow: number
  /** Token hint (never the full key), e.g. 'sk-ant-...****'. */
  tokens?: string | null
  /** ISO timestamp of last use. */
  lastUsed?: string | null
}

// ── Marketplace ───────────────────────────────────────────────────────────────

export interface Piece {
  id: Id
  /** Human-readable name, e.g. 'Slack'. */
  label: string
  /** Catalog category, e.g. 'communication', 'productivity'. */
  category: string
  /** One-line description of what the piece does. */
  description: string
  /** OAuth or API-key auth type from the piece manifest. */
  authType?: string | null
  /** Number of actions the piece exposes. */
  actionCount: number
  /** Logo URL. */
  logo?: string | null
  /** Catalog status: 'ok' | 'invalid'. */
  status: string
}

// ── Connectors ────────────────────────────────────────────────────────────────

export interface Connector {
  id: Id
  /** The marketplace piece this connector was installed from. */
  pieceId: string
  /** Display name (copied from the piece at install time). */
  label: string
  /** Installation source: 'marketplace' | 'native'. */
  source: string
  /** Auth/health status: 'needs_auth' | 'connected' | 'error'. */
  status: string
  /** Whether the connector is active for helpers. */
  enabled: boolean
}

// ── MCP Tokens ────────────────────────────────────────────────────────────────

export interface McpToken {
  id: Id
  /** Human label given at mint time. */
  label: string
  /** The helper this token grants access to. */
  helperId: string
  /** Granted MCP scopes. */
  scopes: string[]
  /** ISO expiry timestamp (null = non-expiring). */
  expiresAt?: string | null
  /** ISO timestamp of the last authentication via this token. */
  lastUsedAt?: string | null
  /** ISO timestamp when the token was revoked (null = active). */
  revokedAt?: string | null
  /** True when the token is not revoked and not expired. */
  active: boolean
}

// ── Flows ─────────────────────────────────────────────────────────────────────

/**
 * FlowCard: lightweight list representation (no nodes/edges).
 * Full Flow (with nodes/edges/trigger) returned by GET /v1/flows/{id}.
 */
export interface Flow {
  id: Id
  title: string
  status: string
  enabled: boolean
  /** Number of nodes in the flow. */
  count: number
  areas: string[]
  createdAt: string | null
  /** Full detail fields (present on GET /v1/flows/{id} only). */
  companyId?: string
  version?: number
  createdBy?: string
  proposedFromPattern?: boolean
  trigger?: { kind: string; spec: Record<string, unknown> }
  nodes?: unknown[]
  edges?: unknown[]
  channelIds?: string[]
  pollCursor?: unknown | null
}

export interface FlowRun {
  id: Id
  flowId: string
  status: string
  triggerSummary: string | null
  startedBy: string | null
  costCredits: number
  duration: number | null
  waitingFor: string | null
  jobIds: string[]
  startedAt: string | null
  endedAt: string | null
}

// ── Routines ──────────────────────────────────────────────────────────────────

export interface Routine {
  id: Id
  companyId: string
  helperId: string
  name: string
  subtitle: string
  instructions: string
  freq: string
  at: string
  days: number[]
  monthly: string | null
  timezone: string
  cron: string
  sendsTo: unknown[]
  enabled: boolean
  paused: boolean
  managedByChief: boolean
  nextAt: string | null
  lastAt: string | null
  goalIds: string[]
  createdBy: string
}

// ── Knowledge Base ────────────────────────────────────────────────────────────

/** A KbSource row (from GET /v1/knowledge/sources — when that endpoint exists). */
export interface KbSource {
  id: Id
  companyId: string
  kind: string
  ref: string
  title: string
  contentHash: string
  helperId: string | null
}

/** A KbItem is a recall result from GET /v1/knowledge?q=… */
export interface KbItem {
  sourceId: string
  heading: string
  text: string
  kind: string
  score: number
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export interface AnalyticsStat {
  label: string
  value: number
  note?: string
}

export interface AnalyticsSeries {
  label: string
  values: number[]
  labels: string[]
}

/** Response from GET /v1/analytics/overview */
export interface AnalyticsOverview {
  stats: AnalyticsStat[]
  series: AnalyticsSeries[]
}

/** One row from GET /v1/analytics/helpers */
export interface HelperStat {
  helperId: string
  name: string
  jobs: number
  success: number
  tokens: number
  spend: number
}

// ── Skills ────────────────────────────────────────────────────────────────────

/** SkillCard from list; full Skill from GET /v1/skills/{id}. */
export interface Skill {
  id: Id
  name: string
  status: string
  version: number
  helperId: string
  usageCount: number
  /** Present on full GET /v1/skills/{id} response. */
  companyId?: string
  bodyMd?: string
  createdBy?: string
  createdAt?: string | null
}

// ── Company Members ───────────────────────────────────────────────────────────

/** A member of the company — joined Member + User from GET /v1/members. */
export interface CompanyMember {
  id: Id
  userId: Id
  name: string
  email: string
  role: string
}

export interface InboxItem {
  id: Id
  title: string
  summary: string
  sessionId: Id
  /** Channel (area) the item belongs to — drives the area chip. */
  channelId: Id
  kind: 'decision' | 'update' | 'mention'
  status: 'pending' | 'running' | 'done'
  createdAt: string
  /** Helper who raised the item */
  asker: string
  askerArea: HelperArea
  /** Human-readable elapsed time, e.g. "2m ago" */
  askedAgo?: string
  /** Shows the "Needs you" chip */
  needsYou?: boolean
  /** Proposed tasks listed inside a decision card */
  proposals?: InboxProposal[]
  actions?: InboxAction[]
  /** Reassurance note next to the action buttons */
  reassurance?: string
  /** Renders as a single-line row instead of a full card */
  compact?: boolean
  /** Running items: progress through the run */
  progress?: { step: number; total: number; elapsed: string }
  /** Done items: footer meta, e.g. "1m 50s · 5 sources · 11 steps" */
  meta?: string
}
