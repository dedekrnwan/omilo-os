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
  /** If true, render as a centered system/event line instead of a chat bubble */
  system?: boolean
  /** Optional doc/file attachment card displayed inside the message */
  attachment?: MessageAttachment
  /** Optional action buttons rendered below the message content */
  actions?: MessageAction[]
}

export interface Session {
  id: Id
  title: string
  channelId?: Id
}

export interface InboxSubtask {
  who: string
  area?: HelperArea
  text: string
  due: string
}

export interface InboxAction {
  label: string
  primary?: boolean
}

export interface InboxItem {
  id: Id
  title: string
  summary: string
  sessionId: Id
  kind: 'decision' | 'update' | 'mention'
  status: 'pending' | 'done'
  createdAt: string
  /** Optional: agent/helper name that sent this approval request */
  asker?: string
  /** Optional: human-readable elapsed time, e.g. "2m ago" */
  askedAgo?: string
  /** Optional: area tag shown on the card header */
  area?: HelperArea
  /** Optional: when true, shows the red "Needs you" badge */
  needsYou?: boolean
  /** Optional: sub-task rows shown inside the card */
  subtasks?: InboxSubtask[]
  /** Optional: action buttons in the card footer */
  actions?: InboxAction[]
  /** Optional: reassurance note next to the action buttons */
  reassurance?: string
  /** Optional: when true, renders as a compact single-line row instead of a full card */
  compact?: boolean
}
