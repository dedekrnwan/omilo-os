import type { Channel, Id, Message, Session, InboxItem } from '../domain/types'

export interface ChannelRepo {
  list(): Promise<Channel[]>
  get(id: Id): Promise<Channel | null>
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
  sessions: SessionRepo
  messages: MessageRepo
  inbox: InboxRepo
}
