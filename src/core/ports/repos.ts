import type { Channel, Folder, Goal, Id, Message, Session, InboxItem } from '../domain/types'

export interface ChannelRepo {
  list(): Promise<Channel[]>
  get(id: Id): Promise<Channel | null>
}

export interface FolderRepo {
  listByChannel(channelId: Id): Promise<Folder[]>
}

export interface GoalRepo {
  listByChannel(channelId: Id): Promise<Goal[]>
}

export interface SessionRepo {
  get(id: Id): Promise<Session | null>
  listByChannel(channelId: Id): Promise<Session[]>
}

export interface MessageRepo {
  listBySession(sessionId: Id): Promise<Message[]>
}

export interface InboxRepo {
  list(): Promise<InboxItem[]>
  get(id: Id): Promise<InboxItem | null>
}

export interface Repos {
  channels: ChannelRepo
  folders: FolderRepo
  goals: GoalRepo
  sessions: SessionRepo
  messages: MessageRepo
  inbox: InboxRepo
}
