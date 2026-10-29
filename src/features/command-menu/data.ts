/**
 * Command menu (⌘K) corpus — copy from pen RGVME · JdRi5 · aNecq · dcWIN.
 * Real integration would replace these with live queries.
 */
import type { HelperArea } from '../../core/domain/types'

export type TabId = 'all' | 'pages' | 'actions' | 'chats' | 'docs' | 'helpers' | 'settings'

export const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pages', label: 'Pages' },
  { id: 'actions', label: 'Actions' },
  { id: 'chats', label: 'Chats' },
  { id: 'docs', label: 'Docs' },
  { id: 'helpers', label: 'Helpers' },
  { id: 'settings', label: 'Settings' },
]

/** Section a result is listed under while searching. */
export type Group = 'PAGES' | 'FLOWS' | 'GOALS' | 'ACTIONS' | 'DOCS' | 'CHATS' | 'HELPERS' | 'SETTINGS'

export const GROUP_ORDER: Group[] = ['PAGES', 'FLOWS', 'GOALS', 'ACTIONS', 'DOCS', 'CHATS', 'HELPERS', 'SETTINGS']

const TAB_OF: Record<Group, TabId> = {
  PAGES: 'pages',
  FLOWS: 'pages',
  GOALS: 'pages',
  ACTIONS: 'actions',
  DOCS: 'docs',
  CHATS: 'chats',
  HELPERS: 'helpers',
  SETTINGS: 'settings',
}
export const tabOf = (g: Group) => TAB_OF[g]

/** What running an item does. */
export type Run =
  | { kind: 'go'; to: string }
  | { kind: 'chief'; threadId?: string }
  | { kind: 'hire' }
  | { kind: 'mode'; to: string }

export interface Preview {
  icon: string
  title: string
  sub: string
  stats: { value: string; label: string }[]
  listLabel: string
  list: { status: 'done' | 'running' | 'failed'; name: string; time: string }[]
  askLabel: string
}

export interface Item {
  id: string
  group: Group
  label: string
  meta?: string
  /** lucide icon name (kebab, as in pen) for the 26px lead tile */
  icon?: string
  /** Mini helper mascot as the lead instead of an icon tile */
  helper?: HelperArea
  /** Right-hand hint: a shortcut ("G  I") or a status ("Running") */
  hint?: string
  keywords?: string
  run: Run
  preview?: Preview
}

// ── Static navigation (routes and product actions — live records come from
// `useCommandCorpus`, which merges these with sessions, goals, flows, docs,
// helpers and private Chief chats) ─────────────────────────────────────────────

export const PAGES: Item[] = [
  { id: 'p-inbox', group: 'PAGES', icon: 'inbox', label: 'Inbox', meta: 'Office', hint: 'G  I', run: { kind: 'go', to: '/inbox' } },
  { id: 'p-goals', group: 'PAGES', icon: 'target', label: 'Goals', meta: 'Office', hint: 'G  G', run: { kind: 'go', to: '/goals' } },
  { id: 'p-flows', group: 'PAGES', icon: 'workflow', label: 'Flows', meta: 'Office', hint: 'G  F', run: { kind: 'go', to: '/flows' } },
  { id: 'p-team', group: 'PAGES', icon: 'users', label: 'Team', meta: 'Helpers', hint: 'G  T', run: { kind: 'go', to: '/team' } },
  { id: 'p-docs', group: 'PAGES', icon: 'file-text', label: 'Docs', meta: 'Office', hint: 'G  D', run: { kind: 'go', to: '/docs' } },
  { id: 'p-routines', group: 'PAGES', icon: 'calendar-sync', label: 'Routines', meta: 'Office', run: { kind: 'go', to: '/routines' } },
  { id: 'p-notif', group: 'PAGES', icon: 'bell', label: 'Notifications', meta: 'Office', run: { kind: 'go', to: '/notifications' } },
  { id: 'p-archived', group: 'PAGES', icon: 'archive', label: 'Archived chats', meta: 'Chat', run: { kind: 'go', to: '/archived' } },
]

export const SETTINGS: Item[] = [
  { id: 'st-cp', group: 'SETTINGS', icon: 'settings', label: 'Control panel', meta: 'Settings', hint: 'G  ,', run: { kind: 'go', to: '/control-panel' } },
  { id: 'st-models', group: 'SETTINGS', icon: 'cpu', label: 'Models & keys', meta: 'Settings', run: { kind: 'go', to: '/control-panel/ai-accounts' } },
  { id: 'st-members', group: 'SETTINGS', icon: 'users', label: 'Members', meta: 'Settings', run: { kind: 'go', to: '/control-panel/members' } },
]

export const ACTIONS: Item[] = [
  { id: 'a-chat', group: 'ACTIONS', icon: 'square-pen', label: 'New chat', hint: 'C', run: { kind: 'go', to: '/chat' } },
  { id: 'a-goal', group: 'ACTIONS', icon: 'crosshair', label: 'New goal', hint: 'N  G', run: { kind: 'go', to: '/goals' } },
  { id: 'a-chief', group: 'ACTIONS', icon: 'lock', label: 'Talk to Chief privately', hint: '⌘  J', run: { kind: 'chief' } },
  { id: 'a-mode', group: 'ACTIONS', icon: 'building-2', label: 'Switch mode', hint: '⌘  .', run: { kind: 'mode', to: '/chat' } },
  { id: 'a-newflow', group: 'ACTIONS', icon: 'plus', label: 'New flow', hint: 'N  F', run: { kind: 'go', to: '/flows' } },
  { id: 'a-hire', group: 'ACTIONS', icon: 'user-plus', label: 'Hire helper', meta: 'Add someone to the team', hint: 'N  H', keywords: 'hire agent new helper', run: { kind: 'hire' } },
]

/** What the menu searches: built live by `useCommandCorpus`. */
export interface Corpus {
  /** Empty-query RECENT section (recent chats + private Chief chats). */
  recent: Item[]
  /** Empty-query JUMP TO section (pages with live counts). */
  jumpTo: Item[]
  /** Empty-query ACTIONS section. */
  actions: Item[]
  /** Everything searchable. */
  all: Item[]
}

// ── Hire helper step (dcWIN) — role templates; hiring calls POST /v1/helpers ─

export interface HireOption {
  id: string
  label: string
  meta: string
  helper?: HelperArea
  icon?: string
  hired?: boolean
  /** createHelper payload for a template */
  template?: { name: string; area: HelperArea; role: string; jobDescription: string }
}

export const HIRE_TEMPLATES: HireOption[] = [
  { id: 'ho-retro', label: 'Retro', meta: 'Reviews what went wrong each week, writes lessons', helper: 'retro', template: { name: 'Retro', area: 'retro', role: 'Retrospectives', jobDescription: 'Reviews what went wrong each week and writes the lessons down.' } },
  { id: 'ho-content', label: 'Content', meta: 'Writes posts, newsletters and captions', helper: 'marketing', template: { name: 'Content', area: 'marketing', role: 'Content writer', jobDescription: 'Writes posts, newsletters and captions.' } },
  { id: 'ho-support', label: 'Support', meta: 'Answers customers and keeps tickets moving', helper: 'support', template: { name: 'Support', area: 'support', role: 'Customer support', jobDescription: 'Answers customers and keeps tickets moving.' } },
  { id: 'ho-finance', label: 'Finance', meta: 'Tracks spend, invoices and the books', helper: 'finance', template: { name: 'Finance', area: 'finance', role: 'Finance', jobDescription: 'Tracks spend, invoices and the books.' } },
  { id: 'ho-custom', label: 'Custom helper', meta: 'Describe the job in one sentence — Chief drafts it', icon: 'sparkles' },
]
