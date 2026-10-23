export type Id = string

export type HelperArea = 'brand' | 'ops' | 'dev' | 'support' | 'finance' | 'marketing' | 'sales' | 'retro'

export interface Company {
  id: Id
  name: string
  color: string
}

export interface Helper {
  id: Id
  name: string
  area: HelperArea
}

export interface Channel {
  id: Id
  name: string
  area: HelperArea
}

export interface Model {
  id: Id
  label: string
}

export interface MessageAuthor {
  kind: 'you' | 'helper'
  name: string
  area?: HelperArea
}

export interface Message {
  id: Id
  sessionId: Id
  author: MessageAuthor
  content: string
  createdAt: string
}

export interface Session {
  id: Id
  title: string
  channelId?: Id
}

export interface InboxItem {
  id: Id
  title: string
  summary: string
  sessionId: Id
  kind: 'decision' | 'update' | 'mention'
  status: 'pending' | 'done'
  createdAt: string
}
