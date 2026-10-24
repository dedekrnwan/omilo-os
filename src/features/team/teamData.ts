/**
 * Static team data for the Team feature area — copy and numbers exactly as in
 * omilo-v2.pen (Team XaOds, helper Job screens ZOLDU/mM9lI/TVKhl/koZok/w6dUO3/
 * XB1kX and the Support tabs wwL68/e4QAdg/C5M5HG/dXeCS/JVnGn).
 * All data is local — no adapter / query needed.
 */
import {
  BookOpen,
  Brain,
  Code,
  Crown,
  FileSignature,
  Handshake,
  Headset,
  ListFilter,
  Megaphone,
  Receipt,
  Type,
  UserRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { HelperArea } from '../../core/domain/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type HelperStatus = 'Working' | 'Needs you' | 'Caught up' | 'Idle' | 'Always on' | 'Planning next week'

export interface Routine {
  time: string
  label: string
  schedule: string
  /** "Next Mon 07:30" — or null when paused (shows "Paused" in warn). */
  nextRun: string | null
}

export interface WorkingFile {
  name: 'PERSONA.md' | 'STYLE.md' | 'PLAYBOOK.md' | 'MEMORY.md'
  description: string
}

export const FILE_ICON: Record<WorkingFile['name'], LucideIcon> = {
  'PERSONA.md': UserRound,
  'STYLE.md': Type,
  'PLAYBOOK.md': BookOpen,
  'MEMORY.md': Brain,
}

export interface Skill {
  name: string
  version: string
  icon: LucideIcon
  description: string
  permission: 'Always allowed' | 'Ask each time'
  enabled: boolean
}

export type HelperTab = 'job' | 'channels' | 'behavior' | 'tools' | 'skills' | 'profile'

export interface HelperRecord {
  id: string
  name: string
  /** Colour + look of the helper (pen `Helper/*`). */
  area: HelperArea
  /** Look used on the roster card / minis when pen draws it differently. */
  rosterArea?: HelperArea
  roleIcon: LucideIcon
  role: string
  /** Roster card second line, e.g. "Dev · Engineering". */
  roleArea: string
  /** Status on the helper's own page. */
  status: HelperStatus
  /** Status on the roster card. */
  rosterStatus: HelperStatus
  model: string
  statsLine: string
  /** Roster "NOW"/"NEXT" box. */
  nowLabel: 'NOW' | 'NEXT'
  now: string
  rosterMeta: string
  cost: string
  description: string
  routinesNote: string
  routines: Routine[]
  emptyRoutines?: string
  files: WorkingFile[]
  counts: { channels: string; tools: string; skills: string }
}

const RESIDENT_SKILLS: Skill[] = [
  { name: 'Dues reminder', version: 'v2.1 · Saga', icon: Receipt, description: "Writes a kind reminder with the resident's balance", permission: 'Always allowed', enabled: true },
  { name: 'Letter request', version: 'v1.4 · Saga', icon: FileSignature, description: 'Fills the RT letter form and sends it for signing', permission: 'Ask each time', enabled: true },
  { name: 'Complaint triage', version: 'v1.0 · you', icon: ListFilter, description: 'Sorts complaints and tags the right RT head', permission: 'Always allowed', enabled: true },
  { name: 'Event announcement', version: 'v1.2 · Saga', icon: Megaphone, description: 'Drafts a broadcast for the whole block', permission: 'Ask each time', enabled: false },
]
export const SKILLS = RESIDENT_SKILLS

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHIEF: HelperRecord = {
  id: 'chief',
  name: 'Chief',
  area: 'brand',
  roleIcon: Crown,
  role: 'Chief of Staff',
  roleArea: 'Chief of Staff',
  status: 'Always on',
  rosterStatus: 'Planning next week',
  model: 'Opus 5.5',
  statsLine: 'Reports to you · routed 42 jobs this month · 2 waiting on you',
  nowLabel: 'NOW',
  now: 'Planning next week',
  rosterMeta: 'Reports to you · 3 loops · all channels',
  cost: '$88',
  description:
    "You are Chief of Staff for Sahabat Warga. Turn the owner's goals into jobs, route each job to the right helper, and keep the owner in the loop without flooding them. Ask before spending, hiring or messaging residents in bulk…",
  routinesNote: 'Chief also manages 15 routines for the whole team.',
  routines: [
    { time: '07:30', label: 'Morning brief', schedule: 'Weekdays', nextRun: 'Next Mon 07:30' },
    { time: '09:00', label: 'Goal check-ins', schedule: 'Mon & Thu', nextRun: 'Next Mon 09:00' },
    { time: '16:00', label: 'Weekly retro', schedule: 'Fridays', nextRun: 'Next Fri 16:00' },
  ],
  files: [
    { name: 'PERSONA.md', description: 'How Chief thinks about priorities' },
    { name: 'STYLE.md', description: 'Tone for briefs and check-ins' },
    { name: 'PLAYBOOK.md', description: 'How to split goals into tasks and pick helpers' },
    { name: 'MEMORY.md', description: "Open goals, owner preferences, who's good at what" },
  ],
  counts: { channels: '4/5', tools: '9', skills: '5' },
}

const BUILDER: HelperRecord = {
  id: 'builder',
  name: 'Builder',
  area: 'dev',
  roleIcon: Code,
  role: 'Dev',
  roleArea: 'Dev · Engineering',
  status: 'Working',
  rosterStatus: 'Working',
  model: 'Opus 5.5',
  statsLine: 'Reports to Chief · 3 loops in #engineering · $31 this month',
  nowLabel: 'NOW',
  now: 'Opening the PR for the Nov 20 passkey cut-off',
  rosterMeta: '3 loops · #engineering',
  cost: '$31 this month',
  description:
    "You are Builder, the developer for Sahabat Warga. Ship small, reviewed changes to go-core and the web app. Always open a pull request, never push to main, and ask before touching production data or anything with residents' payments…",
  routinesNote: 'Recurring work Chief scheduled for Builder.',
  routines: [
    { time: '01:00', label: 'Nightly build check', schedule: 'Weekdays', nextRun: 'Next Tue 01:00' },
    { time: '10:00', label: 'Dependency updates', schedule: 'Tuesdays', nextRun: 'Next Tue 10:00' },
  ],
  files: [
    { name: 'PERSONA.md', description: 'How Builder works and what it cares about' },
    { name: 'STYLE.md', description: 'Code style, commit and PR conventions' },
    { name: 'PLAYBOOK.md', description: 'Runbooks: deploy, rollback, incident' },
    { name: 'MEMORY.md', description: 'Repos, environments and past incidents' },
  ],
  counts: { channels: '1/5', tools: '8', skills: '4' },
}

const GROWER: HelperRecord = {
  id: 'grower',
  name: 'Grower',
  area: 'marketing',
  // pen draws Grower with the Ops look (sky box + gear) on the roster and in minis.
  rosterArea: 'ops',
  roleIcon: Megaphone,
  role: 'Growth',
  roleArea: 'Growth · Marketing',
  status: 'Needs you',
  rosterStatus: 'Needs you',
  model: 'Sonnet 5.5',
  statsLine: 'Reports to Chief · 2 loops in #marketing · $19 this month',
  nowLabel: 'NOW',
  now: 'Waiting on your pick between two Instagram drafts',
  rosterMeta: '2 loops · #marketing',
  cost: '$19 this month',
  description:
    'You are Grower, in charge of marketing for Sahabat Warga. Write posts, broadcasts and ads in a warm, neighbourly voice. Always show the owner two drafts before anything goes public, and never spend more than the approved budget…',
  routinesNote: 'Recurring work Chief scheduled for Grower.',
  routines: [
    { time: '11:00', label: 'Instagram report', schedule: 'Mondays', nextRun: 'Next Mon 11:00' },
    { time: '09:30', label: 'Social calendar', schedule: 'Mondays', nextRun: 'Next Mon 09:30' },
    { time: '14:00', label: 'Ad spend review', schedule: 'Wednesdays', nextRun: null },
  ],
  files: [
    { name: 'PERSONA.md', description: 'Who Grower talks to and why' },
    { name: 'STYLE.md', description: 'Brand voice, words to avoid, emoji rules' },
    { name: 'PLAYBOOK.md', description: 'Launch, referral and broadcast playbooks' },
    { name: 'MEMORY.md', description: 'Past campaigns and what worked' },
  ],
  counts: { channels: '2/5', tools: '6', skills: '4' },
}

const SALES: HelperRecord = {
  id: 'sales',
  name: 'Sales',
  area: 'sales',
  roleIcon: Handshake,
  role: 'Sales',
  roleArea: 'Sales · Partnerships',
  status: 'Working',
  rosterStatus: 'Working',
  model: 'Sonnet 5.5',
  statsLine: 'Reports to Chief · 2 loops in #sales · $14 this month',
  nowLabel: 'NOW',
  now: 'Following up 12 RT heads who opened the deck',
  rosterMeta: '2 loops · #sales',
  cost: '$14 this month',
  description:
    'You are Sales for Sahabat Warga. Follow up RT and RW heads who showed interest, answer pricing questions honestly, and book demos. Never promise discounts above 10% without asking the owner…',
  routinesNote: 'Recurring work Chief scheduled for Sales.',
  routines: [],
  emptyRoutines: 'No routines yet. Ask Chief to set a weekly pipeline review for Sales.',
  files: [
    { name: 'PERSONA.md', description: 'How Sales sounds on the first message' },
    { name: 'STYLE.md', description: 'Short, friendly, no hard selling' },
    { name: 'PLAYBOOK.md', description: 'Follow-up cadence and pricing answers' },
    { name: 'MEMORY.md', description: 'Leads, objections heard, deals in progress' },
  ],
  counts: { channels: '3/5', tools: '5', skills: '3' },
}

const FINANCE: HelperRecord = {
  id: 'finance',
  name: 'Finance',
  area: 'finance',
  roleIcon: Receipt,
  role: 'Finance',
  roleArea: 'Finance · Books',
  status: 'Idle',
  rosterStatus: 'Idle',
  model: 'Opus 5.5',
  statsLine: 'Reports to Chief · next: weekly cash summary, Mon 08:00 · $6 this month',
  nowLabel: 'NEXT',
  now: 'Next up: weekly cash summary, Mon 08:00',
  rosterMeta: '1 loop · #finance',
  cost: '$6 this month',
  description:
    'You are Finance for Sahabat Warga. Keep the books, chase unpaid dues kindly, and send the owner a weekly cash summary. You can read Midtrans and the bank feed, but never move money — always prepare it for the owner to approve…',
  routinesNote: 'Recurring work Chief scheduled for Finance.',
  routines: [
    { time: '10:00', label: 'Invoice chaser', schedule: 'Weekdays', nextRun: 'Next Mon 10:00' },
    { time: '15:00', label: 'Payout reconcile', schedule: 'Fridays', nextRun: 'Next Fri 15:00' },
  ],
  files: [
    { name: 'PERSONA.md', description: 'How Finance reasons about money' },
    { name: 'STYLE.md', description: 'Numbers format, report layout' },
    { name: 'PLAYBOOK.md', description: 'Month-end close, dues reminders, variance checks' },
    { name: 'MEMORY.md', description: 'Vendors, recurring costs, past variances' },
  ],
  counts: { channels: '1/5', tools: '5', skills: '3' },
}

const SUPPORT: HelperRecord = {
  id: 'support',
  name: 'Support',
  area: 'support',
  roleIcon: Headset,
  role: 'Support',
  roleArea: 'Support · WhatsApp',
  status: 'Always on',
  rosterStatus: 'Caught up',
  model: 'Opus 5.5',
  statsLine: 'Reports to Chief of Staff · answered 1.204 questions this month',
  nowLabel: 'NOW',
  now: 'Answered 38 questions today, handed 2 to you',
  rosterMeta: 'Always on · #support',
  cost: '$6 this month',
  description:
    "You are Support for Sahabat Warga. Answer residents' questions about dues, letters and facilities in Bahasa Indonesia — warm, short, and never guess. Anything about money disputes or complaints about RT heads goes to the owner…",
  routinesNote: 'Recurring work Chief scheduled for Support.',
  routines: [{ time: '2h', label: 'Ticket triage', schedule: 'Every 2h · 08–20', nextRun: 'Next Mon 08:00' }],
  files: [
    { name: 'PERSONA.md', description: 'Who Support is and how it sees residents' },
    { name: 'STYLE.md', description: 'Tone, language and formatting' },
    { name: 'PLAYBOOK.md', description: 'Step-by-step answers for common cases' },
    { name: 'MEMORY.md', description: 'What it remembers between chats' },
  ],
  counts: { channels: '2/5', tools: '7', skills: '3' },
}

export const HELPERS: HelperRecord[] = [CHIEF, BUILDER, GROWER, SALES, FINANCE, SUPPORT]

export function getHelper(id: string): HelperRecord | undefined {
  return HELPERS.find((h) => h.id === id)
}

// ── Hire helpers catalog (pen jEooC) ───────────────────────────────────────────

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
  { id: 'retro', name: 'Retro', tagline: 'Runs weekly retros and spots patterns', area: 'retro', category: 'Operations' },
  { id: 'marketing', name: 'Marketing', tagline: 'Writes posts and broadcasts for residents', area: 'marketing', category: 'Growth' },
  { id: 'sales', name: 'Sales', tagline: 'Follows up leads from WhatsApp and forms', area: 'sales', category: 'Growth' },
  { id: 'finance', name: 'Finance', tagline: 'Hired · already on your team', area: 'finance', category: 'Money', alreadyOnTeam: true },
  { id: 'dev', name: 'Dev', tagline: 'Hired · already on your team', area: 'dev', category: 'Tech', alreadyOnTeam: true },
]

export const HIRE_CATEGORIES = ['All', 'Operations', 'Growth', 'Money', 'Tech'] as const
export type HireCategory = (typeof HIRE_CATEGORIES)[number]

// ── Roles & models (pen JYwEe) ─────────────────────────────────────────────────

export interface HelperModelRow {
  helperId: string
  name: string
  area: HelperArea
  description: string
  model: string
}

export const HELPER_MODEL_ROWS: HelperModelRow[] = [
  { helperId: 'chief', name: 'Chief of Staff', area: 'brand', description: 'Plans and routes work', model: 'Opus 5.5' },
  { helperId: 'builder', name: 'Builder', area: 'dev', description: 'Code and pull requests', model: 'Opus 5.5' },
  { helperId: 'grower', name: 'Grower', area: 'ops', description: 'Posts and campaigns', model: 'Sonnet 5.5' },
  { helperId: 'sales', name: 'Sales', area: 'sales', description: 'Leads and follow-ups', model: 'Sonnet 5.5' },
  { helperId: 'finance', name: 'Finance', area: 'finance', description: 'Invoices and dues', model: 'Opus 5.5' },
  { helperId: 'support', name: 'Support', area: 'support', description: 'Resident questions', model: 'Opus 5.5' },
]
