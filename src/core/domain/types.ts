export type Id = string

export type HelperArea = 'brand' | 'ops' | 'dev' | 'support' | 'finance' | 'marketing' | 'sales' | 'retro'

/** Accent a channel (= company area) is drawn with. `general` is the neutral default channel. */
export type ChannelAccent = 'general' | 'dev' | 'marketing' | 'sales'

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
  accent: ChannelAccent
  /** The default channel is shown as "Default channel · Chief". */
  isDefault?: boolean
  /** Agents besides Chief that work in this channel. */
  agentCount: number
  chatCount: number
  /** Open Office items in this area (Office › Areas counts). */
  openItems: number
}

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
