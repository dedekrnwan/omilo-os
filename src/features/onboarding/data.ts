/** Static data for the onboarding wizard — no queries, no store. */
import type { HelperArea } from '../../core/domain/types'

export interface KnowledgeNote {
  icon: string
  label: string
  meta: string
}

export interface TeamHelper {
  id: string
  name: string
  area: HelperArea
  role: string
  description: string
  badge?: string
  alwaysIncluded?: boolean
  reason?: string
  on: boolean
}

export interface CheckNote {
  id: string
  label: string
  content: string
  extra?: string
  suggested?: boolean
}

export const COMPANY_NAME = 'Sahabat Warga'

export const KNOWLEDGE_NOTES: KnowledgeNote[] = [
  { icon: 'building-2', label: 'Company', meta: 'who you are and what you do' },
  { icon: 'users', label: 'Customers', meta: 'who you serve' },
  { icon: 'target', label: 'Goals', meta: 'what you want this quarter' },
  { icon: 'tag', label: 'Offer', meta: 'what you sell, for how much' },
  { icon: 'shield', label: 'Rules', meta: 'what helpers must never do' },
  { icon: 'layout-grid', label: 'Systems', meta: 'tools and where things live' },
  { icon: 'mic', label: 'Voice', meta: 'how you sound' },
]

export const TEAM_HELPERS: TeamHelper[] = [
  {
    id: 'chief',
    name: 'Chief of Staff',
    area: 'brand',
    role: 'runs the team',
    description: 'Writes your morning brief, routes every request, and runs the weekly retro.',
    reason: 'Every team needs one',
    alwaysIncluded: true,
    on: true,
  },
  {
    id: 'builder',
    name: 'Builder',
    area: 'dev',
    role: 'engineering',
    description: 'Builds and checks the sahabat-warga backend, one task at a time.',
    reason: 'You have a code folder and 3 developers',
    on: true,
  },
  {
    id: 'grower',
    name: 'Grower',
    area: 'marketing',
    role: 'growth',
    description: 'Weekly growth review and campaigns to win new neighbourhoods.',
    reason: 'Goal: 100 paying neighbourhoods by December',
    on: true,
  },
  {
    id: 'support',
    name: 'Support',
    area: 'support',
    role: 'customer support',
    description: 'Answers residents on WhatsApp in your voice; anything unusual comes to you.',
    reason: 'Goal: cut support chats in half',
    badge: 'Suggested',
    on: true,
  },
  {
    id: 'finance',
    name: 'Finance',
    area: 'finance',
    role: 'money',
    description: 'Matches dues to payments each week and flags late neighbourhoods.',
    reason: 'You track dues in Google Sheets',
    on: false,
  },
]

export const CHECK_NOTES: CheckNote[] = [
  {
    id: 'company',
    label: 'Company',
    content:
      'Community app that connects RT/RW neighbourhoods in Jabodetabek, 2 founders, 3 developers.',
  },
  {
    id: 'customers',
    label: 'Customers',
    content:
      'RT heads who run the neighbourhood, and residents who pay dues and request services.',
  },
  {
    id: 'goals',
    label: 'Goals',
    content:
      '100 paying neighbourhoods by December\n• Cut manual support chats in half',
    extra: '• 100 paying neighbourhoods; 0 → 100',
  },
  {
    id: 'offer',
    label: 'Offer',
    content: 'Rp 150,000 per neighbourhood a month. First month free.',
  },
  {
    id: 'rules',
    label: 'Rules',
    content: 'Never message residents without the RT\'s OK. Never promise refunds.',
    suggested: true,
  },
  {
    id: 'systems',
    label: 'Systems',
    content: 'WhatsApp Business, Google Sheets for dues, the sahabat-warga code folder.',
  },
  {
    id: 'voice',
    label: 'Voice',
    content: 'Warm, simple Bahasa. Calls people "Bapak/Ibu". No jargon.',
  },
]

export const INBOX_JOBS = [
  {
    id: 'chief-job',
    helper: 'Chief of Staff',
    area: 'brand' as HelperArea,
    cost: '~40 credits / day',
    title: 'Send you a morning brief',
    desc: 'Weekdays 07:30 · decisions, what changed, what\'s next',
  },
  {
    id: 'builder-job',
    helper: 'Builder',
    area: 'dev' as HelperArea,
    cost: '~120 credits / run',
    title: 'Check sahabat-warga for failing tests',
    desc: 'Every push to main · opens a PR when it can fix it',
  },
  {
    id: 'grower-job',
    helper: 'Grower',
    area: 'marketing' as HelperArea,
    cost: '~300 credits / week',
    title: 'Weekly growth review',
    desc: 'Mondays 08:00 · sign-ups, paying neighbourhoods, one idea',
  },
  {
    id: 'support-job',
    helper: 'Support',
    area: 'support' as HelperArea,
    cost: '~10 credits / reply',
    title: 'Draft replies to residents on WhatsApp',
    desc: 'As messages arrive · you approve anything about money',
  },
]

export const GETTING_STARTED_ITEMS = [
  { id: 'ai', label: 'Connect your AI', done: true },
  { id: 'team', label: 'Meet your team', done: true },
  { id: 'jobs', label: 'Approve first jobs', done: false },
  { id: 'wa', label: 'Connect WhatsApp for Support', done: false },
  { id: 'invite', label: 'Invite a teammate', done: false },
  { id: 'mobile', label: 'Get Omilo on your phone', done: false },
]
