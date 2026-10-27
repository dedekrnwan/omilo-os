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
