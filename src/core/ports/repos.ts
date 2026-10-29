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
} from '../domain/types'

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
}

export interface RoutineRepo {
  list(): Promise<Routine[]>
  get(id: Id): Promise<Routine | null>
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
}
