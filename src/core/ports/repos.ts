import type {
  AiAccount,
  AnalyticsOverview,
  Channel,
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

export interface UsageRepo {
  get(): Promise<UsageSummary>
}

export interface WalletRepo {
  get(): Promise<WalletSettings>
}

export interface AiAccountRepo {
  list(): Promise<AiAccount[]>
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

export interface Repos {
  channels: ChannelRepo
  folders: FolderRepo
  goals: GoalRepo
  sessions: SessionRepo
  messages: MessageRepo
  inbox: InboxRepo
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
}
