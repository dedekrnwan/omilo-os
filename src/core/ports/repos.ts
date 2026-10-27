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
}
