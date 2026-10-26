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
  | { kind: 'chief' }
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

const FLOWS_PREVIEW: Preview = {
  icon: 'workflow',
  title: 'Flows',
  sub: 'Office · company-wide',
  stats: [
    { value: '12', label: 'flows' },
    { value: '4', label: 'running' },
    { value: '3', label: 'suggested' },
  ],
  listLabel: 'LAST RUNS',
  list: [
    { status: 'done', name: 'Deploy freeze guard', time: '08:00' },
    { status: 'running', name: 'RT follow-ups', time: 'now' },
    { status: 'failed', name: 'Invoice reminders', time: 'Yest.' },
  ],
  askLabel: 'Ask Chief about flows',
}

// ── Empty query (RGVME) ──────────────────────────────────────────────────────

export const RECENT: Item[] = [
  { id: 'r-prep', group: 'CHATS', icon: 'lock', label: 'Prep · 3pm with Pak RT', meta: 'Private chat with Chief', run: { kind: 'chief' } },
  { id: 'r-passkey', group: 'CHATS', icon: 'message-circle', label: 'Passkey rollout plan', meta: '#engineering', run: { kind: 'go', to: '/chat' } },
  { id: 'r-goals', group: 'PAGES', icon: 'target', label: 'Goals', meta: 'Office', run: { kind: 'go', to: '/goals' } },
]

export const JUMP_TO: Item[] = [
  { id: 'j-inbox', group: 'PAGES', icon: 'inbox', label: 'Inbox', meta: '3 need you', hint: 'G  I', run: { kind: 'go', to: '/inbox' } },
  { id: 'j-flows', group: 'PAGES', icon: 'workflow', label: 'Flows', meta: 'Office', hint: 'G  F', run: { kind: 'go', to: '/flows' } },
  { id: 'j-team', group: 'PAGES', icon: 'users', label: 'Team', meta: '6 helpers', hint: 'G  T', run: { kind: 'go', to: '/team' } },
  { id: 'j-cp', group: 'SETTINGS', icon: 'settings', label: 'Control panel', meta: 'Settings', hint: 'G  ,', run: { kind: 'go', to: '/control-panel' } },
]

export const DEFAULT_ACTIONS: Item[] = [
  { id: 'a-chat', group: 'ACTIONS', icon: 'square-pen', label: 'New chat', meta: 'in #general', hint: 'C', run: { kind: 'go', to: '/chat' } },
  { id: 'a-goal', group: 'ACTIONS', icon: 'crosshair', label: 'New goal', hint: 'N  G', run: { kind: 'go', to: '/goals' } },
  { id: 'a-chief', group: 'ACTIONS', icon: 'lock', label: 'Talk to Chief privately', hint: '⌘  J', run: { kind: 'chief' } },
  { id: 'a-mode', group: 'ACTIONS', icon: 'building-2', label: 'Switch to Chat mode', hint: '⌘  .', run: { kind: 'mode', to: '/chat' } },
]

// ── Everything searchable (JdRi5) ────────────────────────────────────────────

export const CORPUS: Item[] = [
  { id: 's-flows', group: 'PAGES', icon: 'workflow', label: 'Flows', meta: 'Office · all areas', run: { kind: 'go', to: '/flows' }, preview: FLOWS_PREVIEW },
  { id: 's-flows-eng', group: 'PAGES', icon: 'workflow', label: 'Flows', meta: '#engineering', run: { kind: 'go', to: '/chat' }, preview: { ...FLOWS_PREVIEW, sub: '#engineering', stats: [{ value: '5', label: 'flows' }, { value: '2', label: 'running' }, { value: '1', label: 'suggested' }] } },
  ...JUMP_TO.filter((i) => i.id !== 'j-flows' && i.id !== 'j-cp'),
  { id: 's-goals', group: 'PAGES', icon: 'target', label: 'Goals', meta: 'Office', hint: 'G  G', run: { kind: 'go', to: '/goals' } },
  { id: 's-docs', group: 'PAGES', icon: 'file-text', label: 'Docs', meta: 'Office', hint: 'G  D', run: { kind: 'go', to: '/docs' } },
  { id: 's-notif', group: 'PAGES', icon: 'bell', label: 'Notifications', meta: '4 new', run: { kind: 'go', to: '/notifications' } },
  { id: 'f-freeze', group: 'FLOWS', helper: 'dev', label: 'Deploy freeze guard', meta: 'Builder · daily', hint: 'Running', keywords: 'flow', run: { kind: 'go', to: '/flows' } },
  { id: 'f-rt', group: 'FLOWS', helper: 'sales', label: 'RT follow-ups', meta: 'Sales · weekdays 09:00', keywords: 'flow', run: { kind: 'go', to: '/flows' } },
  { id: 'f-cash', group: 'FLOWS', helper: 'finance', label: 'Weekly cash summary', meta: 'Finance · Mon 08:00', keywords: 'flow', run: { kind: 'go', to: '/flows' } },
  { id: 'a-newflow', group: 'ACTIONS', icon: 'plus', label: 'New flow', hint: 'N  F', run: { kind: 'go', to: '/flows' } },
  { id: 'a-draftflow', group: 'ACTIONS', icon: 'sparkles', label: 'Draft a flow from a suggestion', meta: '3 suggested', run: { kind: 'go', to: '/flows' } },
  { id: 'a-hire', group: 'ACTIONS', icon: 'user-plus', label: 'Hire helper', meta: 'Add someone to the team', hint: 'N  H', keywords: 'hire agent new helper', run: { kind: 'hire' } },
  ...DEFAULT_ACTIONS,
  { id: 'd-flows', group: 'DOCS', icon: 'file-text', label: 'How we write flows', meta: 'Docs › Engineering', run: { kind: 'go', to: '/docs' } },
  { id: 'd-handbook', group: 'DOCS', icon: 'file-text', label: 'Company handbook', meta: 'Docs › General', run: { kind: 'go', to: '/docs' } },
  { id: 'd-signup', group: 'DOCS', icon: 'file-text', label: 'Sign-up funnel notes', meta: 'Docs › Marketing', keywords: 'sign-ups signups signup drop', run: { kind: 'go', to: '/docs' } },
  { id: 'c-flowsq', group: 'CHATS', icon: 'message-circle', label: 'Which flows should Ops own?', meta: '#general · 1w ago', keywords: 'flow', run: { kind: 'go', to: '/chat' } },
  { id: 'c-otp', group: 'CHATS', icon: 'message-circle', label: 'Why is the OTP step slow?', meta: '#engineering · 3d ago', keywords: 'sign-ups signups signup drop week', run: { kind: 'go', to: '/chat' } },
  ...RECENT.filter((r) => r.id !== 'r-goals'),
  { id: 'g-100', group: 'GOALS', icon: 'target', label: '100 neighbourhoods', meta: 'Goal · 64% · sign-ups is a key result', keywords: 'sign-ups signups signup', run: { kind: 'go', to: '/goals' } },
  { id: 'h-chief', group: 'HELPERS', helper: 'brand', label: 'Chief', meta: 'Chief of Staff', run: { kind: 'chief' } },
  { id: 'h-builder', group: 'HELPERS', helper: 'dev', label: 'Builder', meta: 'Dev · Engineering', run: { kind: 'go', to: '/team' } },
  { id: 'h-grower', group: 'HELPERS', helper: 'ops', label: 'Grower', meta: 'Marketing · #marketing', run: { kind: 'go', to: '/team' } },
  { id: 'h-finance', group: 'HELPERS', helper: 'finance', label: 'Finance', meta: 'Finance · Books', run: { kind: 'go', to: '/team' } },
  { id: 'st-cp', group: 'SETTINGS', icon: 'settings', label: 'Control panel', meta: 'Settings', hint: 'G  ,', run: { kind: 'go', to: '/control-panel' } },
  { id: 'st-models', group: 'SETTINGS', icon: 'cpu', label: 'Models & keys', meta: 'Settings', run: { kind: 'go', to: '/control-panel' } },
]

// ── Ask Chief fallback (aNecq) ───────────────────────────────────────────────

export const ASK_CHANNEL_HELPER = {
  helper: 'ops' as HelperArea,
  label: 'Ask Grower in #marketing instead',
  meta: 'Shared with the channel',
}

// ── Hire helper step (dcWIN) ─────────────────────────────────────────────────

export interface HireOption {
  id: string
  label: string
  meta: string
  helper?: HelperArea
  icon?: string
  price?: string
  hired?: boolean
}

export const HIRE_READY: HireOption[] = [
  { id: 'ho-retro', label: 'Retro', meta: 'Reviews what went wrong each week, writes lessons', helper: 'retro', price: '~$4 / mo' },
  { id: 'ho-content', label: 'Content', meta: 'Writes posts, newsletters and captions', helper: 'marketing', price: '~$9 / mo' },
  { id: 'ho-support', label: 'Support · night shift', meta: 'Covers WhatsApp 22:00–07:00', helper: 'support', price: '~$8 / mo' },
  { id: 'ho-custom', label: 'Custom helper', meta: 'Describe the job in one sentence — Chief drafts it', icon: 'sparkles' },
]

export const HIRE_HIRED: HireOption[] = [
  { id: 'hh-builder', label: 'Builder', meta: 'Dev · Engineering', helper: 'dev', hired: true },
  { id: 'hh-finance', label: 'Finance', meta: 'Finance · Books', helper: 'finance', hired: true },
]

export const COMPANY = { name: 'Sahabat Warga', initial: 'S', color: '#F97316' }
