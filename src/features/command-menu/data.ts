/**
 * Static seed data for the Command Menu.
 * Real integration would replace these with live queries/store slices.
 */

import type { HelperArea, ChannelAccent } from '../../core/domain/types'

// ── Tabs ────────────────────────────────────────────────────────────────────

export type TabId = 'all' | 'pages' | 'actions' | 'chats' | 'docs' | 'helpers' | 'settings'

export interface Tab {
  id: TabId
  label: string
}

export const TABS: Tab[] = [
  { id: 'all',      label: 'All' },
  { id: 'pages',    label: 'Pages' },
  { id: 'actions',  label: 'Actions' },
  { id: 'chats',    label: 'Chats' },
  { id: 'docs',     label: 'Docs' },
  { id: 'helpers',  label: 'Helpers' },
  { id: 'settings', label: 'Settings' },
]

// ── Recent items ─────────────────────────────────────────────────────────────

export interface RecentItem {
  id: string
  kind: 'chat' | 'page'
  label: string
  meta?: string
}

export const RECENT_ITEMS: RecentItem[] = [
  { id: 'r1', kind: 'chat',  label: 'Prep · 3pm with Pak RT', meta: 'Private chat with Chief' },
  { id: 'r2', kind: 'page',  label: 'Passkey rollout plan',   meta: '#engineering' },
  { id: 'r3', kind: 'page',  label: 'Goals',                  meta: 'Office' },
]

// ── Jump-to pages ─────────────────────────────────────────────────────────────

export interface PageItem {
  id: string
  label: string
  meta: string
  count?: number
  badge?: number
}

export const PAGES: PageItem[] = [
  { id: 'p1', label: 'Inbox',         meta: 'Office',   badge: 3 },
  { id: 'p2', label: 'Flows',         meta: 'Office',   count: 2 },
  { id: 'p3', label: 'Team',          meta: 'Office',   badge: 6 },
  { id: 'p4', label: 'Control panel', meta: 'Settings' },
]

// ── Actions ───────────────────────────────────────────────────────────────────

export interface ActionItem {
  id: string
  label: string
  meta?: string
  shortcut?: string[]
}

export const ACTIONS: ActionItem[] = [
  { id: 'a1', label: 'New chat',               meta: 'in #general',        shortcut: ['G', 'C'] },
  { id: 'a2', label: 'New goal',               shortcut: ['G', 'N'] },
  { id: 'a3', label: 'Talk to Chief privately', shortcut: ['⌘', '2'] },
  { id: 'a4', label: 'Switch to Chat mode',    shortcut: ['⌘'] },
]

// ── Helpers (@ prefix) ───────────────────────────────────────────────────────

export interface HelperItem {
  id: string
  name: string
  role: string
  area: HelperArea
}

export const HELPERS: HelperItem[] = [
  { id: 'h1', name: 'Chief',   role: 'Chief of Staff',  area: 'brand' },
  { id: 'h2', name: 'Dev',     role: 'Dev · Engineering', area: 'dev' },
  { id: 'h3', name: 'Finance', role: 'Finance · Books',  area: 'finance' },
  { id: 'h4', name: 'Content', role: 'Writes posts, newsletters', area: 'marketing' },
  { id: 'h5', name: 'Support', role: 'Covers WhatsApp 22:00–07:00', area: 'support' },
]

// ── Channels (# prefix) ──────────────────────────────────────────────────────

export interface ChannelItem {
  id: string
  name: string
  accent: ChannelAccent
  meta?: string
  badge?: number
}

export const CHANNELS: ChannelItem[] = [
  { id: 'c1', name: 'general',    accent: 'general',   meta: 'company-wide' },
  { id: 'c2', name: 'dev',        accent: 'dev',       meta: 'Engineering',  badge: 7 },
  { id: 'c3', name: 'marketing',  accent: 'marketing', meta: 'Marketing',    badge: 2 },
  { id: 'c4', name: 'sales',      accent: 'sales',     meta: 'Sales' },
]

// ── Hire-helper step (action step ref: dcWIN.png) ─────────────────────────────

export interface HireOption {
  id: string
  label: string
  description: string
  /** Price per message, if any */
  price?: string
}

export const HIRE_OPTIONS: HireOption[] = [
  { id: 'ho1', label: 'Retro',            description: 'Reviews what went wrong each week; writes lessons' },
  { id: 'ho2', label: 'Content',          description: 'Writes posts, newsletters and captions',  price: '~$1' },
  { id: 'ho3', label: 'Support · night shift', description: 'Covers WhatsApp 22:00–07:00',       price: '~$1' },
  { id: 'ho4', label: 'Custom helper',    description: 'Chief drafts it in one sentence — Chief drafts it' },
]

export const HIRED_OPTIONS: HireOption[] = [
  { id: 'hb1', label: 'Builder', description: 'Dev · Engineering' },
  { id: 'hb2', label: 'Finance', description: 'Finance · Books' },
]
