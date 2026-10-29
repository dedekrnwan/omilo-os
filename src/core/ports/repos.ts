import type {
  AiAccount,
  HarnessDetection,
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
  GoalDetail,
  Helper,
  HelperStat,
  Id,
  KbItem,
  KbSource,
  McpToken,
  Message,
  Piece,
  Routine,
  RoutineRunDetail,
  RoutineSchedule,
  RoutineSuggestion,
  Session,
  Skill,
  InboxItem,
  UsageSummary,
  WalletSettings,
  // ── sweep/inbox-flows ──
  FlowSuggestion,
  FlowVersionInfo,
  ProposalDetail,
} from '../domain/types'
import type { ChiefNudge, FolderFile, SessionResults, Shares } from '../domain/types' // sweep/chat

export interface ChannelRepo {
  list(): Promise<Channel[]>
  get(id: Id): Promise<Channel | null>
}

export interface FolderRepo {
  listByChannel(channelId: Id): Promise<Folder[]>
  /** Every folder across all areas (for the "All areas" view). */
  listAll(): Promise<Folder[]>
}

export interface GoalRepo {
  listByChannel(channelId: Id): Promise<Goal[]>
  /** Every goal across all areas (for the "All areas" view). */
  listAll(): Promise<Goal[]>
  // ── sweep/goals-routines ── (optional so hand-rolled test stubs stay valid)
  /** GET /v1/goals/{id} → goal + planned jobs + proposals. */
  get?(id: Id): Promise<GoalDetail | null>
}

export interface SessionRepo {
  get(id: Id): Promise<Session | null>
  listByChannel(channelId: Id): Promise<Session[]>
  /** Every session across all areas (for the "All areas" view). */
  listAll(): Promise<Session[]>
}

export interface MessageRepo {
  listBySession(sessionId: Id): Promise<Message[]>
}

export interface InboxRepo {
  list(): Promise<InboxItem[]>
  get(id: Id): Promise<InboxItem | null>
}

export interface BillingPlanRepo {
  list(): Promise<BillingPlan[]>
}

export interface BillingSubscriptionRepo {
  get(): Promise<BillingSubscription | null>
}

export interface UsageRepo {
  get(): Promise<UsageSummary>
}

export interface WalletRepo {
  get(): Promise<WalletSettings>
}

export interface AiAccountRepo {
  list(): Promise<AiAccount[]>
  /** Probe this machine for installed/signed-in local harness CLIs.
   * Optional so lightweight test repos need not implement it; both the HTTP
   * and mock adapters do. */
  detect?(): Promise<HarnessDetection[]>
}

export interface MarketplaceRepo {
  list(params?: { category?: string; q?: string }): Promise<Piece[]>
}

export interface ConnectorRepo {
  list(): Promise<Connector[]>
}

export interface McpTokenRepo {
  list(): Promise<McpToken[]>
}

export interface FlowRepo {
  list(): Promise<Flow[]>
  get(id: Id): Promise<Flow | null>
  runs(id: Id): Promise<FlowRun[]>
  // ── sweep/inbox-flows ──
  // Optional so hand-rolled test repos elsewhere keep type-checking; both real
  // adapters (http + mock) implement them and hooks fall back when absent.
  /** GET /v1/flows/{id}/runs/{runId} — one run with its per-step log. */
  run?(id: Id, runId: Id): Promise<FlowRun | null>
  /** GET /v1/flows/{id}/versions — version history (newest first). */
  versions?(id: Id): Promise<FlowVersionInfo[]>
  /** GET /v1/flows/suggestions — deterministic suggestions. */
  suggestions?(): Promise<FlowSuggestion[]>
}

export interface RoutineRepo {
  list(): Promise<Routine[]>
  get(id: Id): Promise<Routine | null>
  // ── sweep/goals-routines ── (optional so hand-rolled test stubs stay valid)
  /** GET /v1/routines/schedule?from&to — cron expanded server-side + past runs. */
  schedule?(from: string, to: string): Promise<RoutineSchedule>
  /** GET /v1/routines/{id}/runs/{runId} — steps, logs, output, delivery. */
  run?(routineId: Id, runId: Id): Promise<RoutineRunDetail | null>
  /** GET /v1/routines/suggestions — Chief's deterministic suggestions. */
  suggestions?(): Promise<RoutineSuggestion[]>
}

export interface KnowledgeRepo {
  /** GET /v1/knowledge/sources — list indexed sources. */
  sources(): Promise<KbSource[]>
  /** GET /v1/knowledge?q= — recall knowledge items. */
  list(params?: { q?: string }): Promise<KbItem[]>
}

export interface AnalyticsRepo {
  overview(range?: string): Promise<AnalyticsOverview>
  helpers(range?: string): Promise<HelperStat[]>
}

export interface SkillRepo {
  list(): Promise<Skill[]>
  get(id: Id): Promise<Skill | null>
}

export interface HelperRepo {
  list(): Promise<Helper[]>
  get(id: Id): Promise<Helper | null>
}

export interface MemberRepo {
  /** GET /v1/members — list all members of the authed company. */
  list(): Promise<CompanyMember[]>
}

export interface Repos {
  channels: ChannelRepo
  folders: FolderRepo
  goals: GoalRepo
  sessions: SessionRepo
  messages: MessageRepo
  inbox: InboxRepo
  billingPlans: BillingPlanRepo
  billingSubscription: BillingSubscriptionRepo
  usage: UsageRepo
  wallet: WalletRepo
  aiAccounts: AiAccountRepo
  marketplace: MarketplaceRepo
  connectors: ConnectorRepo
  mcpTokens: McpTokenRepo
  flows: FlowRepo
  routines: RoutineRepo
  knowledge: KnowledgeRepo
  analytics: AnalyticsRepo
  skills: SkillRepo
  helpers: HelperRepo
  members: MemberRepo
  // ── sweep/docs ──
  // Optional so hand-written Repos stubs in unrelated tests stay valid; the
  // query hooks fall back to empty repos (see EMPTY_DOCS_REPOS in queries.ts).
  docs?: DocsRepo
  lessons?: LessonRepo
  handbook?: HandbookRepo
}

// ── sweep/docs ──────────────────────────────────────────────────────────────

import type {
  DocDetail,
  DocGraph,
  DocSummary,
  DocVersion,
  HandbookFileDetail,
  HandbookIndex,
  HandbookSuggestion,
  Lesson,
} from '../domain/types'

export interface DocsRepo {
  /** GET /v1/memory?helper_id=&kind= — every doc in the company. */
  list(params?: { helperId?: string; kind?: string }): Promise<DocSummary[]>
  /** GET /v1/memory/{id} — the doc with its links/backlinks; null on 404. */
  get(id: Id): Promise<DocDetail | null>
  /** GET /v1/memory/{id}/versions */
  versions(id: Id): Promise<DocVersion[]>
  /** GET /v1/memory/graph */
  graph(): Promise<DocGraph>
}

export interface LessonRepo {
  /** GET /v1/lessons?status= */
  list(params?: { status?: 'review' | 'active' }): Promise<Lesson[]>
}

export interface HandbookRepo {
  /** GET /v1/handbook (seeds a starter handbook on first read). */
  index(): Promise<HandbookIndex>
  /** GET /v1/handbook/{file}; null on 404. */
  file(name: string): Promise<HandbookFileDetail | null>
  /** GET /v1/handbook/suggestions?file=&status= */
  suggestions(params?: { file?: string; status?: string }): Promise<HandbookSuggestion[]>
  // ── sweep/inbox-flows ── (optional: see FlowRepo note)
  proposals?: ProposalRepo

// ── sweep/inbox-flows ──

export interface ProposalRepo {
  /** GET /v1/proposals/{id} → proposal + revisions (null on 404). */
  get(id: Id): Promise<ProposalDetail | null>
}

// ── sweep/team-analytics ──
// Optional so lightweight test repos need not implement them; the HTTP and
// mock adapters both do. Hooks fall back to empty data when absent.

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
} from '../domain/types'

export interface ActivityQuery {
  kinds?: string[]
  helperIds?: string[]
  cursor?: string
  limit?: number
  channelId?: string
}

export interface AnalyticsRepo {
  /** GET /v1/analytics/overview?range=&channel_id= */
  overviewFor?(range: string, channelId?: string): Promise<AnalyticsOverview>
  /** GET /v1/analytics/helpers?range=&channel_id= */
  helpersFor?(range: string, channelId?: string): Promise<HelperStat[]>
  spendByChannel?(range: string, channelId?: string): Promise<AnalyticsStackedSeries>
  tokensByHelper?(range: string, channelId?: string): Promise<AnalyticsStackedSeries>
  loops?(range: string): Promise<AnalyticsLoop[]>
  reliability?(range: string, channelId?: string): Promise<AnalyticsReliability>
  failures?(range: string, channelId?: string): Promise<AnalyticsFailure[]>
  activity?(q: ActivityQuery): Promise<ActivityPage>
}

export interface HelperRepo {
  /** GET /v1/helpers/{id} — full detail (routines, skills, counts). */
  detail?(id: Id): Promise<HelperDetail | null>
  channels?(id: Id): Promise<HelperChannelBinding[]>
  tools?(id: Id): Promise<HelperTools>
  skillRows?(id: Id): Promise<HelperSkillRow[]>
  files?(id: Id): Promise<HelperFile[]>
  // ── sweep/chat ──
  /** Optional so lightweight test repos need not implement it; both adapters do. */
  chat?: ChatRepo

// ── sweep/chat ────────────────────────────────────────────────────────────────

/** Persisted chat workspace reads: archive, Chief DM, folder pages, results. */
export interface ChatRepo {
  /** GET /v1/sessions?archived=1[&channel_id=] — newest archived first. */
  archived(areaId: Id | null): Promise<Session[]>
  /** GET /v1/sessions?kind=chief_private — the caller's private Chief threads. */
  chiefThreads(): Promise<Session[]>
  /** GET /v1/chief/nudges */
  chiefNudges(): Promise<ChiefNudge[]>
  /** GET /v1/folders/{id} — with instructions + look. */
  folder(id: Id): Promise<Folder | null>
  /** GET /v1/folders/{id}/files */
  folderFiles(id: Id): Promise<FolderFile[]>
  /** GET /v1/folders/{id}/shares */
  folderShares(id: Id): Promise<Shares>
  /** GET /v1/sessions/{id}/shares */
  sessionShares(id: Id): Promise<Shares>
  /** GET /v1/sessions/{id}/results */
  sessionResults(id: Id): Promise<SessionResults>
}

// ── sweep/control ──
import type {
  AccountInfo,
  AuditPage,
  AuditQuery,
  CompanyDetail,
  CreditPack,
  DataExport,
  Invite,
  Invoice,
  LedgerEntry,
  ManagedChannel,
  McpServer,
  Payment,
  SeatSummary,
  SignInSession,
  StorageSummary,
  UserPreferences,
} from '../domain/controlPanel'

/** Control-panel reads (company detail, seats, invites, audit, data, account…). */
export interface ControlPanelRepo {
  /** GET /v1/company — profile incl. timezone + logo. */
  company(): Promise<CompanyDetail>
  /** GET /v1/billing/seats */
  seats(): Promise<SeatSummary>
  /** GET /v1/billing/packs */
  packs(): Promise<CreditPack[]>
  /** GET /v1/billing/invoices */
  invoices(): Promise<Invoice[]>
  /** GET /v1/billing/ledger */
  ledger(): Promise<LedgerEntry[]>
  /** GET /v1/wallet/payments/{id} */
  payment(id: string): Promise<Payment | null>
  /** GET /v1/auth/invites — open invites. */
  invites(): Promise<Invite[]>
  /** GET /v1/channels/manage — incl. archived, with counts. */
  channels(): Promise<ManagedChannel[]>
  /** GET /v1/audit */
  audit(query?: AuditQuery): Promise<AuditPage>
  /** GET /v1/data/storage */
  storage(): Promise<StorageSummary>
  /** GET /v1/data/exports */
  exports(): Promise<DataExport[]>
  /** GET /v1/me/account */
  account(): Promise<AccountInfo>
  /** GET /v1/me/preferences */
  preferences(): Promise<UserPreferences>
  /** GET /v1/me/sessions */
  sessions(): Promise<SignInSession[]>
  /** GET /v1/mcp-servers */
  mcpServers(): Promise<McpServer[]>
  /** GET /v1/telemetry-config → opted_out */
  telemetryOptedOut(): Promise<boolean>
}

// Optional so hand-built test Repos objects (which list every field) keep compiling.
export interface Repos {
  controlPanel?: ControlPanelRepo
}
