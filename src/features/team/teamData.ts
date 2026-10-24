/**
 * Static team data for the Team feature area.
 * All data is local — no adapter / query needed.
 */

import type { HelperArea } from '../../core/domain/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type HelperStatus = 'Working' | 'Needs you' | 'Caught up' | 'Idle' | 'Always on' | 'Planning next week'

export interface Routine {
  time: string
  label: string
  schedule: string
  nextRun: string
  paused?: boolean
}

export interface WorkingFile {
  name: string
  description: string
}

export interface ConnectedChannel {
  id: string
  name: string
  meta: string
  builtIn?: boolean
  connected?: boolean
  status?: string
  comingSoon?: boolean
}

export interface Tool {
  name: string
  description: string
  permission: 'Can act' | 'Read only' | 'Ask first'
  enabled: boolean
  builtIn?: boolean
  mcp?: boolean
}

export interface Skill {
  name: string
  version: string
  source: 'Saga' | 'You'
  description: string
  permission: 'Always allowed' | 'Ask each time'
  enabled: boolean
}

export type HelperTab = 'Job' | 'Channels' | 'Behavior' | 'Tools' | 'Skills' | 'Profile'

export interface HelperRecord {
  id: string
  name: string
  area: HelperArea
  roleLabel: string
  roleArea: string
  status: HelperStatus
  model: string
  reportsTo: string
  statsLine: string
  now: string
  description: string
  routines: Routine[]
  workingFiles: WorkingFile[]
  channels: ConnectedChannel[]
  channelCount: number
  tools: Tool[]
  skills: Skill[]
  behaviorMode: 'Ask first' | 'Act, then report' | 'Fully on its own'
  spendLimit: string
  messagesPerHour: number
  neverDiscuss: string[]
  workHours: string
  handOffTo: string
  language: string
  loopCount: number
  loopTags: string
  earnings: string
}

// ── Chief ─────────────────────────────────────────────────────────────────────

const CHIEF: HelperRecord = {
  id: 'chief',
  name: 'Chief',
  area: 'brand',
  roleLabel: 'Chief of Staff',
  roleArea: 'Chief of Staff',
  status: 'Planning next week',
  model: 'Opus 5.5',
  reportsTo: 'you',
  statsLine: 'Reports to you · routed 42 jobs this month · 2 waiting on you',
  now: 'Planning next week',
  description:
    'You are Chief of Staff for Sahabat Warga. Turn the owner\'s goals into jobs, route each job to the right helper, and keep the owner in the loop without flooding them. Ask before spending, hiring or messaging residents in bulk…',
  routines: [
    { time: '07:30', label: 'Morning brief', schedule: 'Weekdays', nextRun: 'Next Mon 07:30', paused: false },
    { time: '09:00', label: 'Goal check-ins', schedule: 'Mon & Thu', nextRun: 'Next Mon 09:00', paused: false },
    { time: '16:00', label: 'Weekly retro', schedule: 'Fridays', nextRun: 'Next Fri 16:00', paused: false },
  ],
  workingFiles: [
    { name: 'PERSONA.md', description: 'Who Chief is and how it sees the company' },
    { name: 'STYLE.md', description: 'Tone, language and formatting' },
    { name: 'PLAYBOOK.md', description: 'Step-by-step answers for common cases' },
    { name: 'MEMORY.md', description: 'What it remembers between chats' },
  ],
  channels: [
    { id: 'omilo', name: 'Omilo chat', meta: '#support, #general and direct messages', builtIn: true },
  ],
  channelCount: 4,
  tools: [
    { name: 'Browser', description: 'Open pages and fill simple forms', permission: 'Can act', enabled: true, builtIn: true },
    { name: 'Web search', description: 'Look things up when the handbook has no answer', permission: 'Read only', enabled: true, builtIn: true },
    { name: 'Code runner', description: 'Run small scripts on files', permission: 'Ask first', enabled: false, builtIn: true },
  ],
  skills: [
    { name: 'Dues reminder', version: 'v2.3', source: 'Saga', description: 'Writes a kind reminder with the resident\'s balance', permission: 'Always allowed', enabled: true },
    { name: 'Letter request', version: 'v1.4', source: 'Saga', description: 'Fills the RT letter form and sends it for signing', permission: 'Ask each time', enabled: true },
    { name: 'Complaint triage', version: 'v1.8', source: 'You', description: 'Sorts complaints and tags the right RT head', permission: 'Always allowed', enabled: true },
  ],
  behaviorMode: 'Act, then report',
  spendLimit: 'Rp 50,000',
  messagesPerHour: 60,
  neverDiscuss: ['Money disputes', 'Legal', 'Politics'],
  workHours: '08:00–21:00',
  handOffTo: 'You (Dede)',
  language: 'Bahasa Indonesia',
  loopCount: 3,
  loopTags: '#engineering',
  earnings: '$31 this month',
}

const BUILDER: HelperRecord = {
  id: 'builder',
  name: 'Builder',
  area: 'dev',
  roleLabel: 'Dev',
  roleArea: 'Dev · Engineering',
  status: 'Working',
  model: 'Opus 5.5',
  reportsTo: 'Chief',
  statsLine: 'Reports to Chief · 3 loops in #engineering · $31 this month',
  now: 'Opening the PR for the Nov 20 passkey cut-off',
  description:
    'You are Builder, the developer for Sahabat Warga. Ship small, reviewed changes to go-core and the web app. Always open a pull request, never push to main, and ask before touching production data or anything with residents\' payments…',
  routines: [
    { time: '01:00', label: 'Nightly build check', schedule: 'Weekdays', nextRun: 'Next Tue 01:00', paused: false },
    { time: '10:00', label: 'Dependency updates', schedule: 'Tuesdays', nextRun: 'Next Tue 10:00', paused: false },
  ],
  workingFiles: [
    { name: 'PERSONA.md', description: 'How Builder works and what it cares about' },
    { name: 'STYLE.md', description: 'Code style, commit and PR conventions' },
  ],
  channels: [
    { id: 'omilo', name: 'Omilo chat', meta: '#support, #general and direct messages', builtIn: true },
  ],
  channelCount: 1,
  tools: [
    { name: 'Browser', description: 'Open pages and fill simple forms', permission: 'Can act', enabled: true, builtIn: true },
    { name: 'Web search', description: 'Look things up when the handbook has no answer', permission: 'Read only', enabled: true, builtIn: true },
    { name: 'Code runner', description: 'Run small scripts on files', permission: 'Ask first', enabled: false, builtIn: true },
  ],
  skills: [],
  behaviorMode: 'Act, then report',
  spendLimit: 'Rp 50,000',
  messagesPerHour: 60,
  neverDiscuss: [],
  workHours: '08:00–21:00',
  handOffTo: 'You (Dede)',
  language: 'Bahasa Indonesia',
  loopCount: 3,
  loopTags: '#engineering',
  earnings: '$31 this month',
}

const GROWER: HelperRecord = {
  id: 'grower',
  name: 'Grower',
  area: 'marketing',
  roleLabel: 'Growth',
  roleArea: 'Growth · Marketing',
  status: 'Needs you',
  model: 'Sonnet 5.5',
  reportsTo: 'Chief',
  statsLine: 'Reports to Chief · 2 loops in #marketing · $19 this month',
  now: 'Waiting on your pick between two Instagram drafts',
  description:
    'You are Grower, in charge of marketing for Sahabat Warga. Write posts, broadcasts and ads in a warm, neighbourly voice. Always show the owner two drafts before anything goes public, and never spend more than the approved budget…',
  routines: [
    { time: '11:00', label: 'Instagram report', schedule: 'Mondays', nextRun: 'Next Mon 11:00', paused: false },
    { time: '09:30', label: 'Social calendar', schedule: 'Mondays', nextRun: 'Next Mon 09:30', paused: false },
    { time: '14:00', label: 'Ad spend review', schedule: 'Wednesdays', nextRun: 'Next Mon', paused: true },
  ],
  workingFiles: [
    { name: 'PERSONA.md', description: 'How Grower sounds and what it cares about' },
    { name: 'STYLE.md', description: 'Tone, language and formatting' },
  ],
  channels: [
    { id: 'omilo', name: 'Omilo chat', meta: '#support, #general and direct messages', builtIn: true },
  ],
  channelCount: 2,
  tools: [
    { name: 'Browser', description: 'Open pages and fill simple forms', permission: 'Can act', enabled: true, builtIn: true },
    { name: 'Web search', description: 'Look things up when the handbook has no answer', permission: 'Read only', enabled: true, builtIn: true },
    { name: 'Code runner', description: 'Run small scripts on files', permission: 'Ask first', enabled: false, builtIn: true },
  ],
  skills: [],
  behaviorMode: 'Ask first',
  spendLimit: 'Rp 50,000',
  messagesPerHour: 60,
  neverDiscuss: [],
  workHours: '08:00–21:00',
  handOffTo: 'You (Dede)',
  language: 'Bahasa Indonesia',
  loopCount: 2,
  loopTags: '#marketing',
  earnings: '$19 this month',
}

const SALES: HelperRecord = {
  id: 'sales',
  name: 'Sales',
  area: 'sales',
  roleLabel: 'Sales',
  roleArea: 'Sales · Partnerships',
  status: 'Working',
  model: 'Sonnet 5.5',
  reportsTo: 'Chief',
  statsLine: 'Reports to Chief · 2 loops in #sales · $14 this month',
  now: 'Following up 12 RT heads who opened the deck',
  description:
    'You are Sales for Sahabat Warga. Follow up RT and RW heads who showed interest, answer pricing questions honestly, and book demos. Never promise discounts above 10% without asking the owner…',
  routines: [],
  workingFiles: [
    { name: 'PERSONA.md', description: 'How Sales sounds on the first message' },
    { name: 'STYLE.md', description: 'Short, friendly, no hard selling' },
    { name: 'PLAYBOOK.md', description: 'Follow-up cadence and pricing answers' },
    { name: 'MEMORY.md', description: 'Leads, objections heard, deals in progress' },
  ],
  channels: [
    { id: 'omilo', name: 'Omilo chat', meta: '#support, #general and direct messages', builtIn: true },
  ],
  channelCount: 3,
  tools: [
    { name: 'Browser', description: 'Open pages and fill simple forms', permission: 'Can act', enabled: true, builtIn: true },
    { name: 'Web search', description: 'Look things up when the handbook has no answer', permission: 'Read only', enabled: true, builtIn: true },
  ],
  skills: [],
  behaviorMode: 'Act, then report',
  spendLimit: 'Rp 50,000',
  messagesPerHour: 60,
  neverDiscuss: [],
  workHours: '08:00–21:00',
  handOffTo: 'You (Dede)',
  language: 'Bahasa Indonesia',
  loopCount: 2,
  loopTags: '#sales',
  earnings: '$14 this month',
}

const FINANCE: HelperRecord = {
  id: 'finance',
  name: 'Finance',
  area: 'finance',
  roleLabel: 'Finance',
  roleArea: 'Finance · Books',
  status: 'Idle',
  model: 'Opus 5.5',
  reportsTo: 'Chief',
  statsLine: 'Reports to Chief · next: weekly cash summary, Mon 08:00 · $6 this month',
  now: 'Next up: weekly cash summary, Mon 08:00',
  description:
    'You are Finance for Sahabat Warga. Keep the books, chase unpaid dues kindly, and send the owner a weekly cash summary. You can read Midtrans and the bank feed, but never move money — always prepare it for the owner to approve…',
  routines: [
    { time: '10:00', label: 'Invoice chaser', schedule: 'Weekdays', nextRun: 'Next Mon 10:00', paused: false },
    { time: '15:00', label: 'Payout reconcile', schedule: 'Fridays', nextRun: 'Next Fri 15:00', paused: false },
  ],
  workingFiles: [
    { name: 'PERSONA.md', description: 'How Finance reasons about money' },
    { name: 'STYLE.md', description: 'Numbers format, report layout' },
  ],
  channels: [
    { id: 'omilo', name: 'Omilo chat', meta: '#support, #general and direct messages', builtIn: true },
  ],
  channelCount: 1,
  tools: [
    { name: 'Browser', description: 'Open pages and fill simple forms', permission: 'Can act', enabled: true, builtIn: true },
    { name: 'Web search', description: 'Look things up when the handbook has no answer', permission: 'Read only', enabled: true, builtIn: true },
  ],
  skills: [],
  behaviorMode: 'Ask first',
  spendLimit: 'Rp 50,000',
  messagesPerHour: 60,
  neverDiscuss: [],
  workHours: '08:00–21:00',
  handOffTo: 'You (Dede)',
  language: 'Bahasa Indonesia',
  loopCount: 1,
  loopTags: '#finance',
  earnings: '$6 this month',
}

const SUPPORT: HelperRecord = {
  id: 'support',
  name: 'Support',
  area: 'support',
  roleLabel: 'Support',
  roleArea: 'Support · WhatsApp',
  status: 'Caught up',
  model: 'Opus 5.5',
  reportsTo: 'Chief of Staff',
  statsLine: 'Reports to Chief of Staff · answered 1,204 questions this month',
  now: 'Answered 38 questions today, handed 2 to you',
  description:
    'You are Support for Sahabat Warga. Answer residents\' questions about dues, letters and facilities in Bahasa Indonesia — warm, short, and never guess. Anything about money disputes or complaints about RT heads goes to the owner…',
  routines: [
    { time: '2h', label: 'Ticket triage', schedule: 'Every 2h · 08-20', nextRun: 'Next Mon 08:00', paused: false },
  ],
  workingFiles: [
    { name: 'PERSONA.md', description: 'Who Support is and how it sees residents' },
    { name: 'STYLE.md', description: 'Tone, language and formatting' },
    { name: 'PLAYBOOK.md', description: 'Step-by-step answers for common cases' },
    { name: 'MEMORY.md', description: 'What it remembers between chats' },
  ],
  channels: [
    { id: 'omilo', name: 'Omilo chat', meta: '#support, #general and direct messages', builtIn: true },
    { id: 'whatsapp', name: 'WhatsApp Business', meta: '+62 812 •••• 4410 · Sahabat Warga · 214 chats this month', connected: true },
    { id: 'telegram', name: 'Telegram', meta: 'Connect a bot from @BotFather — paste its token, done.' },
    { id: 'email', name: 'Email', meta: 'Support answers from support@sahabatwarga.id' },
    { id: 'slack', name: 'Slack', meta: 'For teams that live in Slack', comingSoon: true },
  ],
  channelCount: 2,
  tools: [
    { name: 'WhatsApp Business', description: 'Read and reply to resident chats', permission: 'Can act', enabled: true },
    { name: 'Notion', description: 'Look up the resident handbook and FAQ', permission: 'Read only', enabled: true },
    { name: 'Google Drive', description: 'Find letters and forms to send', permission: 'Read only', enabled: true },
    { name: 'Midtrans', description: 'Check if a resident\'s dues are paid', permission: 'Ask first', enabled: true },
    { name: 'sahabat-db', description: 'Resident & unit records, read-only queries', permission: 'Read only', enabled: true, mcp: true },
    { name: 'GitHub', description: 'Not needed for Support\'s job', permission: 'Read only', enabled: false },
    { name: 'Browser', description: 'Open pages and fill simple forms', permission: 'Can act', enabled: true, builtIn: true },
    { name: 'Web search', description: 'Look things up when the handbook has no answer', permission: 'Read only', enabled: true, builtIn: true },
    { name: 'Code runner', description: 'Run small scripts on files', permission: 'Ask first', enabled: false, builtIn: true },
  ],
  skills: [
    { name: 'Dues reminder', version: 'v2.3', source: 'Saga', description: 'Writes a kind reminder with the resident\'s balance', permission: 'Always allowed', enabled: true },
    { name: 'Letter request', version: 'v1.4', source: 'Saga', description: 'Fills the RT letter form and sends it for signing', permission: 'Ask each time', enabled: true },
    { name: 'Complaint triage', version: 'v1.8', source: 'You', description: 'Sorts complaints and tags the right RT head', permission: 'Always allowed', enabled: true },
    { name: 'Event announcement', version: 'v1.2', source: 'Saga', description: 'Drafts a broadcast for the whole block', permission: 'Ask each time', enabled: false },
  ],
  behaviorMode: 'Act, then report',
  spendLimit: 'Rp 50,000',
  messagesPerHour: 60,
  neverDiscuss: ['Money disputes', 'Legal', 'Politics'],
  workHours: '08:00–21:00',
  handOffTo: 'You (Dede)',
  language: 'Bahasa Indonesia',
  loopCount: 0,
  loopTags: '#support',
  earnings: '$6 this month',
}

export const HELPERS: HelperRecord[] = [CHIEF, BUILDER, GROWER, SALES, FINANCE, SUPPORT]

export function getHelper(id: string): HelperRecord | undefined {
  return HELPERS.find((h) => h.id === id)
}

// ── Hire helpers catalog ───────────────────────────────────────────────────────

export interface HireOption {
  id: string
  name: string
  tagline: string
  area: HelperArea
  category: 'Operations' | 'Growth' | 'Money' | 'Tech'
  alreadyOnTeam?: boolean
}

export const HIRE_OPTIONS: HireOption[] = [
  { id: 'ops', name: 'Ops', tagline: 'Keeps schedules, stock and vendors on track', area: 'ops', category: 'Operations' },
  { id: 'retro', name: 'Retro', tagline: 'Runs weekly retros and spots patterns.', area: 'retro', category: 'Operations' },
  { id: 'marketing', name: 'Marketing', tagline: 'Writes posts and broadcasts for residents', area: 'marketing', category: 'Growth' },
  { id: 'sales-hire', name: 'Sales', tagline: 'Follows up leads from WhatsApp and forms.', area: 'sales', category: 'Growth', alreadyOnTeam: true },
  { id: 'finance-hire', name: 'Finance', tagline: 'Invoices and dues', area: 'finance', category: 'Money', alreadyOnTeam: true },
  { id: 'dev-hire', name: 'Dev', tagline: 'Spec to ship', area: 'dev', category: 'Tech', alreadyOnTeam: true },
]

export const HIRE_CATEGORIES = ['All', 'Operations', 'Growth', 'Money', 'Tech'] as const
export type HireCategory = typeof HIRE_CATEGORIES[number]

// ── Roles & models data ───────────────────────────────────────────────────────

export interface ModelOption {
  id: string
  label: string
  note?: string
  tag?: string
}

export const MODELS: ModelOption[] = [
  { id: 'opus-5.5', label: 'Opus 5.5' },
  { id: 'sonnet-5.5', label: 'Sonnet 5.5', note: '~3× cheaper' },
  { id: 'haiku-5.5', label: 'Haiku 5.5', tag: 'fastest' },
]

export interface HelperModelRow {
  helperId: string
  name: string
  area: HelperArea
  description: string
  model: string
}

export const HELPER_MODEL_ROWS: HelperModelRow[] = [
  { helperId: 'chief', name: 'Chief of Staff', area: 'brand', description: 'Plans and works', model: 'Opus 5.5' },
  { helperId: 'builder', name: 'Builder', area: 'dev', description: 'Code and pull requests', model: 'Opus 5.5' },
  { helperId: 'grower', name: 'Grower', area: 'marketing', description: 'Posts and campaigns', model: 'Sonnet 5.5' },
  { helperId: 'sales', name: 'Sales', area: 'sales', description: 'Leads and follow-ups', model: 'Sonnet 5.5' },
  { helperId: 'finance', name: 'Finance', area: 'finance', description: 'Invoices and dues', model: 'Opus 5.5' },
  { helperId: 'support', name: 'Support', area: 'support', description: 'Resident questions', model: 'Opus 5.5' },
]
