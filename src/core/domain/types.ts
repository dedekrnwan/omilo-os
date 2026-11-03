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
  /** Workspace autonomy dial (the column the enforcement engine reads): strict | ask | yolo. */
  autonomyDefault?: string
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
  /** sweep/chat — custom area colour (hex) chosen in the icon picker. */
  color?: string
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
  // ── sweep/goals-routines (optional; set by the backend) ──
  /** Derived by Chief/system unless the user overrode it (statusSetBy='user'). */
  status?: GoalStatus
  target?: string
  /** Due date, ISO `YYYY-MM-DD` (or a free-form label from older goals). */
  due?: string
  measuredBy?: string
  /** Helpers assigned to the goal. */
  helperIds?: string[]
  /** Reporting period, e.g. "2026-Q4". */
  period?: string
  /** The goal's chat session (created once on first open). */
  sessionId?: string
  statusSetBy?: 'user' | 'system'
}

export interface Folder {
  id: Id
  channelId: Id
  name: string
  /** Total chats in the folder (may exceed the chats listed in the sidebar). */
  count: number
  // ── sweep/chat ──
  icon?: string
  /** Hex colour of the folder glyph. */
  color?: string
  /** Instructions every chat in the folder gets as context. */
  instructions?: string
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

/** One step in a `todos` block. */
export interface TodoItem {
  text: string
  status?: 'done' | 'active' | 'pending'
}

/** One citation in a `sources` block. */
export interface SourceItem {
  /** Display number; falls back to the 1-based index. */
  n?: number
  title?: string
  subtitle?: string
  url?: string
}

/** An owner's decision on an interactive block (action_card, confirmation). */
export type BlockDecision = 'approve' | 'changes' | 'reject'

/**
 * A typed segment of an agent reply (ported from omilo-os "chat components").
 * An assistant message is either plain `content` (legacy) or a sequence of
 * `blocks`. `type` is intentionally open — an unknown/future type renders as
 * markdown (safe fallback), so the backend can add block types without a
 * frontend release.
 */
export interface MessageBlock {
  type:
    | 'reasoning'
    | 'markdown'
    | 'code'
    | 'todos'
    | 'sources'
    | 'action_card'
    | 'confirmation'
    | 'task'
    | 'usage_meter'
    | 'document'
    | 'image'
    | 'streaming'
    | 'pr_card'
    | (string & {})
  /** Primary text: markdown for reasoning/markdown, source for code, body for confirmation. */
  text?: string
  /** reasoning/todos: the pill or plan label (e.g. "Thought for 12s"); falls back to durationS. */
  label?: string
  /** reasoning: seconds spent thinking, used to build the default label. */
  durationS?: number
  /** code: language tag shown in the header and used for the copy affordance. */
  lang?: string
  /** code: optional filename shown in the header. */
  name?: string
  /** todos/action_card/confirmation: the headline (plan name, the ask, the action). */
  title?: string
  /** todos: the plan's steps. */
  items?: TodoItem[]
  /** sources: the citations, shown as pills that expand into a list. */
  sources?: SourceItem[]
  /** action_card: the secondary target line under the title (e.g. "omilo-os · feat/x → main"). */
  target?: string
  /** action_card: bullet detail rows shown in the soft box. */
  details?: string[]
  /** action_card/confirmation: label for the primary (approve) button; defaults per type. */
  actionLabel?: string
  /** action_card/confirmation: links the decision to a backend proposal, when wired. */
  proposalId?: string
  /** action_card/confirmation: links the decision to a backend access/action request, when wired. */
  requestId?: string
  /** confirmation: risk level — anything but "low" styles the confirm button as destructive. */
  risk?: 'low' | 'medium' | 'high'
  /** confirmation: who raised the ask and when, shown in the footer ("Dev asked · 2m ago"). */
  who?: string
  when?: string
  /** confirmation: minutes the action can be undone after approval (default 5). */
  undoMin?: number
  /** confirmation: pre-decided state for an already-answered ask. */
  done?: boolean
  /** confirmation: short recap shown in the answered row ("You approved: …"). */
  doneLabel?: string

  // ── task ──────────────────────────────────────────────────────────────────
  /** task/image: lifecycle state ("pending" | "running" | "done" | "failed"). */
  status?: 'pending' | 'running' | 'done' | 'failed' | (string & {})
  /** task: steps completed / total, drawn as a progress track. */
  stepsDone?: number
  stepsTotal?: number
  /** task: the helper the work was handed to. */
  staff?: string
  /** task: links "Open job" to the job page. */
  taskId?: string
  /** task: optional meta chips. */
  due?: string
  branch?: string
  goal?: string

  // ── usage_meter ─────────────────────────────────────────────────────────── (durationS reused)
  /** usage_meter: tokens spent on this turn. */
  tokensIn?: number
  tokensOut?: number
  /** usage_meter: share of today's budget used (0–100), drawn as a track. */
  budgetPct?: number
  /** usage_meter: the AI account and its tier ("Claude Code pool", "Max"). */
  account?: string
  tier?: string

  // ── document ──────────────────────────────────────────────────────────────
  /** document: where it lives ("Docs", "PDF", …), shown as a chip. */
  source?: string
  /** document: who wrote it and its length. */
  writtenBy?: string
  words?: number
  /** document/image: a link to open the file. */
  url?: string
  /** document: an in-app Docs path ("/docs/?path=…"); preferred over url when set. */
  docPath?: string

  // ── image ───────────────────────────────────────────────────────────────── (url/name reused)
  /** image: true while generating (shimmer tiles + progress + Stop). */
  generating?: boolean
  /** image: generation progress (0–100). */
  progress?: number
  /** image: the prompt, shown italic under the tiles. */
  prompt?: string
  /** image: candidate images to choose from (done state). */
  imageOptions?: { url: string }[]
  /** image: the currently selected option index. */
  selectedOption?: number

  // ── streaming ─────────────────────────────────────────────────────────────── (text reused)
  /** streaming: running token count, shown as "Writing… · N tokens". */
  tokens?: number

  // ── pr_card ───────────────────────────────────────────────────────────────── (branch reused)
  /** pr_card: the repository and the branches ("feat/x" → "main"). */
  repo?: string
  base?: string
  /** pr_card: diff stats. */
  filesChanged?: number
  additions?: number
  deletions?: number
  /** pr_card: a one-line test summary and the reviewer. */
  tests?: string
  reviewer?: string
  /** pr_card: the PR URL opened by the primary button. */
  prUrl?: string
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
  /**
   * Typed reply blocks (reasoning, markdown, code, …). When present, the bubble
   * renders these instead of `content`; `content` stays as the plain-text
   * fallback and for search/notifications.
   */
  blocks?: MessageBlock[]
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
  // ── sweep/chat ──
  /** Pinned to the sidebar by the current user (pins are per user). */
  pinned?: boolean
  /** ISO time the chat was archived (only on archived listings). */
  archivedAt?: string
  /** Linked goal id (the `goal` label is its title). */
  goalId?: Id
  /** Model picked in the composer, e.g. 'opus-5-5'. */
  model?: string
  /** 'chief_private' for private Chief DM threads; absent for normal chats. */
  kind?: 'chief_private'
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
  /** sweep/control — seat/helper limits + marketing bullets (null = unlimited). */
  maxSeats?: number | null
  maxHelpers?: number | null
  /** Rp per extra seat per month; null = no extra seats on this plan. */
  seatPriceIdr?: number | null
  /** Cloud storage for docs, files & artifacts and knowledge (GB); null = unlimited. */
  storageGb?: number | null
  features?: string[]
  badge?: string | null
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
  /** sweep/control — display name of the plan (e.g. "Team"). */
  planName?: string
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

/** Result of probing this machine for a local AI-harness CLI. */
export interface HarnessDetection {
  /** Harness id, e.g. 'claude-code', 'opencode', 'cursor'. */
  id: string
  name: string
  /** CLI is on PATH or a known install dir exists. */
  installed: boolean
  /** A credential/auth file is present (an authenticated session). */
  signedIn: boolean
  /** Binary path or install dir, for display. */
  detail: string
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
  /** sweep/control — how to (re)authenticate: credentials form fields. */
  auth?: { type: string; provider: string | null; fields: string[] }
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
  /** Free-form flow settings (budget, approvals, quiet hours, notifications…), deep-merged server-side. */
  settings?: Record<string, unknown>
}

export interface FlowRun {
  id: Id
  flowId: string
  status: string
  triggerSummary: string | null
  startedBy: string | null
  /** Internal metering unit (pooled AI only). */
  costCredits: number
  /** AI tokens (input + output) the run used. */
  tokens: number
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
  // ── sweep/goals-routines (optional; set by the backend) ──
  /** ISO time a paused routine resumes automatically. */
  pausedUntil?: string | null
  /** Chief may shift it up to an hour to avoid clashes. */
  allowChiefShift?: boolean
  skipHolidays?: boolean
  askBeforeSending?: boolean
  /** List: the last 8 runs (oldest → newest). Detail: the last 20 (newest first). */
  runs?: RoutineRunSummary[]
}

// ── Knowledge Base ────────────────────────────────────────────────────────────

/** A KbSource row (from GET /v1/knowledge/sources). */
export interface KbSource {
  id: Id
  companyId: string
  kind: string
  ref: string
  title: string
  contentHash: string
  helperId: string | null
  /** Chunks (passages) indexed from this source. */
  chunks?: number
  createdAt?: string | null
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
  /** sweep/control — channel ids (null/undefined = all channels). */
  channels?: string[] | null
  channelNames?: string[] | null
  lastSeenAt?: string | null
  avatarUrl?: string | null
}

// ── Company settings (free-form JSONB) ─────────────────────────────────────────

/**
 * Free-form, tenant-scoped company settings (GET/PATCH /v1/company/settings).
 * The backend stores this as a JSONB blob and deep-merges PATCH partials, so the
 * shape is intentionally open — known top-level buckets are typed as optionals.
 */
export interface CompanySettings {
  safety?: Record<string, unknown>
  notifications?: Record<string, unknown>
  aiEngine?: Record<string, unknown>
  knowledge?: Record<string, unknown>
  about?: string
  language?: string
  hours?: Record<string, unknown>
  /** Per-helper monthly budgets, keyed by helper id (null clears an entry). */
  budgets?: Record<string, unknown>
  [key: string]: unknown
}

// ── Knowledge docs (memory) ─────────────────────────────────────────────────────

/** A created/updated memory doc (POST /v1/memory, PATCH /v1/memory/{id}). */
export interface MemoryDoc {
  id: Id
  title: string
  content: string
  kind: string
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

// ── sweep/docs ──────────────────────────────────────────────────────────────

/** A company doc / handbook file / helper memory doc (GET /v1/memory). */
export interface DocSummary {
  id: Id
  path: string
  title: string
  content: string
  /** 'doc' (or a custom kind) for company docs, 'handbook', 'memory' for helper memory. */
  kind: string
  /** Area the doc belongs to (a channel id or a free label); null → General. */
  area: string | null
  pinned: boolean
  /** Hidden from the doc graph. */
  hidden: boolean
  helperId: string | null
  version: number
  updatedAt: string | null
  /** 'operator:<userId>', 'system', 'suggestion:<author>' … */
  updatedBy: string
  createdAt: string | null
  createdBy: string
}

export interface DocLink {
  id: Id
  title: string
  kind: string
}

export interface DocGoalLink {
  id: Id
  title: string
  progress: number
  status: string
}

/** GET /v1/memory/{id} — a doc plus links parsed from its [[wikilinks]]. */
export interface DocDetail extends DocSummary {
  links: DocLink[]
  goals: DocGoalLink[]
  /** [[targets]] that match no doc or goal. */
  unresolved: string[]
  backlinks: DocLink[]
}

export interface DocVersion {
  id: Id
  version: number
  title: string | null
  updatedBy: string
  note: string | null
  createdAt: string | null
}

export interface DocGraphNodeData {
  id: Id
  title: string
  area: string | null
  /** 'goal' for goal nodes (id 'goal:<goalId>'). */
  kind: string
  by: 'team' | 'agents'
  updatedAt?: string | null
  excerpt?: string
}

/** GET /v1/memory/graph */
export interface DocGraph {
  nodes: DocGraphNodeData[]
  edges: { from: string; to: string }[]
}

/** A learned memory (GET /v1/lessons). helperId null → company fact. */
export interface Lesson {
  id: Id
  helperId: string | null
  tag: 'lesson' | 'preference' | 'fact'
  text: string
  source: string
  status: 'review' | 'active'
  createdBy: string
  createdAt: string | null
}

export interface AskCitation {
  n: number
  sourceId: string
  kind: string
  title: string
  heading: string
  text: string
  ref: string
  /** Set when the passage came from a doc / handbook file. */
  docId: string | null
}

/** POST /v1/ask */
export interface AskAnswer {
  answer: string
  citations: AskCitation[]
  /** False while Knowledge (agent memory) is off for the company. */
  memorySearched: boolean
}

export interface HandbookFile {
  id: Id
  /** e.g. 'POLICIES.md' */
  name: string
  title: string
  description: string
  visibility: 'everyone' | 'members'
  /** The company brief (BRIEF.md). */
  brief: boolean
  version: number
  updatedAt: string | null
  updatedBy: string
  openSuggestions: number
}

export interface HandbookSuggestion {
  id: Id
  docId: string
  file: string | null
  helperId: string | null
  author: string
  text: string
  proposedContent: string | null
  status: 'open' | 'accepted' | 'dismissed'
  createdAt: string | null
  resolvedAt: string | null
}

export interface HandbookVersion {
  version: number
  updatedBy: string
  note: string | null
  createdAt: string | null
}

export interface HandbookFileDetail extends HandbookFile {
  content: string
  versions: HandbookVersion[]
  suggestions: HandbookSuggestion[]
}

/** GET /v1/handbook */
export interface HandbookIndex {
  files: HandbookFile[]
  openSuggestions: number
}


// ── sweep/goals-routines ──────────────────────────────────────────────────────

export type GoalStatus = 'on_track' | 'at_risk' | 'blocked' | 'needs_you' | 'done'

/** GET /v1/goals/{id} — the goal plus the work Chief planned for it. */
export interface GoalDetail {
  goal: Goal
  jobs: Array<{
    id: string
    origin: string
    status: string
    helperId: string
    brief: string
    parentJobId: string | null
    goalId: string | null
  }>
  proposals: Array<{ id: string; jobId: string; type: string; status: string; title: string; risk?: string | null }>
}

export type RoutineRunOutcome = 'ok' | 'fail' | 'skip' | 'running'

export interface RoutineRunSummary {
  id: string
  routineId: string
  jobId: string | null
  /** ISO time the run fired. */
  at: string | null
  outcome: RoutineRunOutcome
  /** Seconds. */
  duration: number | null
  /** Internal metering unit (pooled AI only). */
  costCredits: number
  /** AI tokens (input + output) the run used. */
  tokens: number
  trigger: 'schedule' | 'manual' | 'resend' | null
  error: string | null
  feedback: 'up' | 'down' | null
}

/** GET /v1/routines/{id}/runs/{run_id}. */
export interface RoutineRunDetail {
  run: RoutineRunSummary
  routine: { id: string; name: string; helperId: string; helperName: string; sendsTo: unknown[] }
  job: {
    id: string
    status: string
    error: string | null
    attempts: number
    costCredits: number
    tokensIn: number
    tokensOut: number
    startedAt: string | null
    endedAt: string | null
  } | null
  /** True while the job is queued/running — poll. */
  running: boolean
  steps: Array<{ at: string | null; text: string; error: boolean }>
  logs: Array<{ at: string | null; level: 'info' | 'warn' | 'error'; text: string }>
  output: { headline: string; bodyMd: string; lines: string[] } | null
  sources: unknown[]
  delivery: { sendsTo: unknown[]; delivered: boolean; note: string | null }
}

/** One expanded slot of GET /v1/routines/schedule. */
export interface RoutineScheduleItem {
  routineId: string
  helperId: string
  name: string
  /** ISO fire time. */
  at: string
  status: 'scheduled' | 'paused' | 'missed' | 'ok' | 'fail' | 'skip' | 'running'
  runId: string | null
  trigger: string
}

export interface RoutineSchedule {
  from: string
  to: string
  items: RoutineScheduleItem[]
}

export interface RoutineClash {
  routineId: string
  name: string
  helperId: string
  at: string
  cadence: string
  when: string
}

export interface RoutineSlot {
  freq: string
  at: string
  days: number[]
  monthly: string | null
  label: string
  nextAt: string | null
  recommended: boolean
  reason: string
}

/** POST /v1/routines/preview. */
export interface RoutinePreview {
  nextAt: string | null
  nextDates: string[]
  label: string
  clashes: RoutineClash[]
  suggestedSlots: RoutineSlot[]
}

export interface RoutineSuggestionMove {
  routineId: string
  name: string
  helperId: string
  helperName: string
  from: string
  to: string
  fromAt: string
  toAt: string | null
}

/** GET /v1/routines/suggestions — deterministic Chief suggestions. */
export interface RoutineSuggestion {
  id: string
  kind: 'clash' | 'failing'
  title: string
  desc: string
  moves: RoutineSuggestionMove[]
  note: string
}

// ── sweep/inbox-flows ──
// Interface merging: extends the declarations above without reordering them.

export interface InboxProposal {
  /** Linked Proposal (approve / reject / request changes / undo). */
  proposalId?: string
  /** Proposal type, e.g. flow_publish, send, skill_publish. */
  type?: string
  risk?: string
  /** Proposal status (pending | done | rejected | …), when linked. */
  status?: string
  /** Flow-run approvals: the run parked at an approval step. */
  flowId?: string
  flowRunId?: string
  nodeId?: string
}

export interface InboxItem {
  /** ISO time the operator read the item; absent = unread. */
  readAt?: string
  /** ISO time of the last status change (drives "Done today"). */
  updatedAt?: string
}

/** One step of a flow run's log (GET /v1/flows/{id}/runs/{run_id}). */
export interface FlowRunStep {
  nodeId: string
  /** Engine kind: trigger | ai_step | condition | approval | connector */
  kind: string
  label: string
  /** done | waiting | failed | skipped | declined | cancelled */
  status: string
  durationMs: number
  output?: Record<string, unknown>
  note?: string
}

export interface FlowRun {
  /** Per-step log (present on run detail, and on list rows from the API). */
  steps?: FlowRunStep[]
}

export interface Flow {
  triggerKind?: string | null
  /** App ids of the trigger / connector / approval steps, in order. */
  apps?: string[]
  aiSteps?: number
  /** Runs per day for the last 7 days (oldest → today). */
  runs7d?: number[]
  lastRun?: FlowRun | null
  /** Detail only: AI tokens this flow's runs used this month. */
  tokensThisMonth?: number
  publishState?: 'draft' | 'pending' | 'live'
  pendingProposalId?: string | null
  publishedVersion?: number | null
}

/** GET /v1/flows/{id}/versions row. */
export interface FlowVersionInfo {
  id: Id
  flowId: string
  version: number
  title: string
  note: string
  /** pending | live | superseded */
  status: string
  createdBy: string
  nodeCount: number
  createdAt: string | null
}

/** GET /v1/flows/suggestions row. */
export interface FlowSuggestion {
  id: Id
  title: string
  sub: string
  hint: string
  area: string
  runsAs: string
  helperArea: HelperArea
  from: string
  to: string
  count: number
  source: 'connector' | 'routine'
  draft: { title: string; trigger: { kind: string; spec: Record<string, unknown> }; nodes: unknown[]; edges: unknown[] }
}

/** GET /v1/proposals/{id}. */
export interface ProposalDetail {
  id: Id
  type: string
  risk: string
  title: string
  bodyMd: string
  status: string
  helperId: string
  assignee: string | null
  due: string | null
  params: Record<string, unknown> | null
  createdAt: string | null
  revisions: { n: number; author: string; summary: string; bodyMd: string; at: string | null }[]
}

// ── sweep/team-analytics ──────────────────────────────────────────────────────
// Interface merging adds the fields the Team + Analytics endpoints now return.
// AI usage and budgets below are in tokens (input + output).

export interface HelperJobRef {
  id: Id
  brief: string
  status: string
  startedAt?: string | null
}

export interface HelperNextRoutine {
  id: Id
  name: string
  nextAt: string
}

/** Mascot look saved on the helper (Profile tab). picture = data URL. */
export interface HelperLook {
  color?: string
  shape?: string
  prop?: string
  picture?: string | null
}

/** Behavior tab settings (helper.behavior). */
export interface HelperBehavior {
  /** Per-task AI limit in tokens (input + output). */
  tokens_per_task?: number
  messages_per_hour?: number
  never_discuss?: string[]
  work_hours_override?: boolean
  /** 'owner' | 'helper:<id>' | 'member:<id>' */
  handoff_to?: string
  language?: string
}

export interface Helper {
  /** Engine model label, e.g. "Opus 5.5"; null = company default. */
  model?: string | null
  title?: string | null
  /** 'owner' | helper id */
  reportsTo?: string | null
  look?: HelperLook | null
  behavior?: HelperBehavior
  jobsMonth?: number
  /** AI tokens this month. */
  tokensMonth?: number
  currentJob?: HelperJobRef | null
  nextRoutine?: HelperNextRoutine | null
  /** Enabled routines owned by this helper. */
  loops?: number
  lastActive?: string | null
  /** Monthly AI budget in tokens; null = no limit. */
  budgetTokensMonth?: number | null
  budgetAllowJobs?: number
  channelCount?: number
}

export interface HelperRoutineRow {
  id: Id
  name: string
  freq: string
  at: string
  days: number[]
  paused: boolean
  enabled: boolean
  nextAt: string | null
  managedByChief?: boolean
}

export interface HelperSkillRow {
  id: Id
  name: string
  version: number
  status: string
  own: boolean
  createdBy?: string
  description: string
  enabled: boolean
  permission: 'always' | 'ask'
}

/** GET /v1/helpers/{id} — helper plus its routines, skills and tab counts. */
export interface HelperDetail {
  helper: Helper
  routines: HelperRoutineRow[]
  skills: HelperSkillRow[]
  counts: { channels: number; tools: number; skills: number; routines: number }
}

export type HelperChannelKind = 'telegram' | 'whatsapp' | 'email'

export interface HelperChannelBinding {
  id: Id
  helperId: Id
  kind: HelperChannelKind
  config: Record<string, unknown>
  /** Names of secret fields that are set (values are never returned). */
  secretsSet: string[]
  /** 'pending_setup' until a delivery integration confirms the binding. */
  status: string
}

export interface HelperConnectorTool {
  id: Id
  label: string
  kind?: string | null
  status?: string | null
  on: boolean
  /** 'read' | 'write' | 'ask' */
  access: string
}

export interface HelperBuiltinTool {
  id: string
  label: string
  desc: string
  on: boolean
}

export interface HelperTools {
  connectors: HelperConnectorTool[]
  builtins: HelperBuiltinTool[]
}

export interface HelperFile {
  name: 'PERSONA.md' | 'STYLE.md' | 'PLAYBOOK.md' | 'MEMORY.md'
  description: string
  docId: Id | null
  content: string
  updatedAt: string | null
  updatedBy: string | null
}

export interface AnalyticsStat {
  /** Same stat for the previous period (for the delta chip). */
  prev?: number
  failed?: number
  perJob?: number
  of?: number
  p95?: number
}

export interface AnalyticsOverview {
  buckets?: { start: string; end: string }[]
}

export interface HelperStat {
  area?: HelperArea
  role?: string
  isChief?: boolean
  /** 'working' | 'idle' | 'needs' | 'paused' */
  status?: string
  doing?: string
  nextAt?: string | null
  lastActive?: string | null
  budget?: { spent: number; limit: number } | null
  budgetReached?: boolean
}

/** Stacked bar chart data: one value per bucket per series. */
export interface AnalyticsStackedSeries {
  buckets: { start: string; end: string }[]
  series: { key: string; label: string; area: string; values: number[] }[]
  total: number
}

export interface AnalyticsLoop {
  id: Id
  kind: 'routine' | 'flow'
  name: string
  helperId: Id | null
  helperName: string | null
  area: string
  schedule: string
  nextAt: string | null
  lastResult: string | null
  runs: number
  /** Average AI tokens per run. */
  avgTokens: number
  on: boolean
}

export interface AnalyticsReliability {
  stats: AnalyticsStat[]
  causes: { label: string; count: number }[]
  causesTip: string
}

export interface AnalyticsFailure {
  jobId: Id
  helperId: Id
  helperName: string | null
  area: string
  title: string
  error: string
  cause: string
  attempts: number
  at: string | null
  /** 'failed' | 'recovered' | 'needs_you' */
  status: string
  /** 'retry' | 'connect' | 'budget' | 'view' */
  action: string
  sessionId?: string | null
}

export type ActivityKind = 'done' | 'needs_you' | 'failed' | 'started'

export interface ActivityEntry {
  id: string
  at: string
  kind: ActivityKind
  helperId: Id
  who: string
  area: string
  what: string
  meta: string
  jobId?: Id
  proposalId?: Id
}

export interface ActivityPage {
  items: ActivityEntry[]
  nextCursor: string | null
  counts: Record<ActivityKind, number>
}

// ── sweep/chat ────────────────────────────────────────────────────────────────

/** A file attached to a folder as shared context (GET /v1/folders/{id}/files). */
export interface FolderFile {
  id: Id
  folderId: Id
  name: string
  size: number
  mime?: string | null
  /** True when the file's text was extracted for helpers to read. */
  hasText: boolean
  createdAt?: string | null
}

export type SharePermission = 'owner' | 'can_talk' | 'can_view'

export interface ShareMember {
  userId: Id
  name: string
  email: string
  permission: SharePermission
}

/** People a chat or folder is shared with. */
export interface Shares {
  members: ShareMember[]
  /** Chats only: 'restricted' (people added) | 'company' (anyone in the company). */
  generalAccess?: 'restricted' | 'company'
}

export interface SessionStep {
  id: Id
  label: string
  status: 'done' | 'running' | 'pending' | 'waiting' | 'failed' | string
  helper: string
  helperArea?: HelperArea | null
  startedAt?: string | null
  endedAt?: string | null
  durationS?: number | null
  /** Tokens the turn sent / produced; the latest step's tokensIn ≈ current context fill. */
  tokensIn?: number | null
  tokensOut?: number | null
}

export interface SessionOutput {
  id: Id
  jobId: Id
  title: string
  bodyMd: string
  helper: string
  createdAt?: string | null
}

/** A tool / browser action a helper took in the chat (Browser panel). */
export interface SessionActivity {
  id: Id
  jobId: Id
  kind: string
  helper: string
  action: string
  url?: string | null
  title?: string | null
  at?: string | null
}

/** GET /v1/sessions/{id}/results — derived from the chat's jobs. */
export interface SessionResults {
  steps: SessionStep[]
  outputs: SessionOutput[]
  activity: SessionActivity[]
  usage: { tokensIn: number; tokensOut: number; costCredits: number }
}

/** GET /v1/chief/nudges — a proactive prompt from Chief (derived from the inbox). */
export interface ChiefNudge {
  id: Id
  body: string
  /** Prefilled question when the person accepts. */
  prompt: string
  primary: string
  secondary: string
  inboxItemId?: Id
  sessionId?: Id
  createdAt?: string | null
}
