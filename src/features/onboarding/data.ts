/** Static mock data for the onboarding wizard (pen VYHu4 … FZ9LR). */
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  Building2,
  Cloud,
  Coins,
  KeyRound,
  Laptop,
  Lock,
  MessageCircle,
  Server,
  Shield,
  Tag,
  Target,
  Users,
} from 'lucide-react'
import type { HelperArea } from '../../core/domain/types'

export const COMPANY_NAME = 'Sahabat Warga'

export interface KnowledgeNote {
  id: string
  icon: LucideIcon
  label: string
  meta: string
}

/** The 7 notes ("What your team will know", "What I've learned", Check). */
export const KNOWLEDGE_NOTES: KnowledgeNote[] = [
  { id: 'company', icon: Building2, label: 'Company', meta: 'who you are and what you do' },
  { id: 'customers', icon: Users, label: 'Customers', meta: 'who you serve' },
  { id: 'goals', icon: Target, label: 'Goals', meta: 'what you want this quarter' },
  { id: 'offer', icon: Tag, label: 'Offer', meta: 'what you sell, for how much' },
  { id: 'rules', icon: Shield, label: 'Rules', meta: 'what helpers must never do' },
  { id: 'systems', icon: Server, label: 'Systems', meta: 'tools and where things live' },
  { id: 'voice', icon: MessageCircle, label: 'Voice', meta: 'how you sound' },
]

export const WELCOME_STEPS = [
  { n: 1, label: 'Connect the AI you already have', time: '1 min' },
  { n: 2, label: 'Talk about your business', time: '~10 min' },
  { n: 3, label: 'Meet your team and approve their jobs', time: '2 min' },
]

// ── Step 2 · Your AI ─────────────────────────────────────────────────────────

export type AIMode = 'self-host' | 'cloud'

export interface AIOption {
  id: string
  icon: LucideIcon
  title: string
  desc: string
  /** Detail line shown under the selected option: mono value + muted note + link.
   *  `action` says what the link does: open pricing, or pick a different account. */
  found?: { value: string; note: string; link: string; action?: 'pricing' | 'use-another' }
  chips?: string[]
}

export interface AIModeCopy {
  title: string
  lead: string
  hint: string
  options: AIOption[]
  footQ?: string
  footA?: string
  cta: string
  good: { icon: LucideIcon; title: string; desc: string }[]
}

export const AI_MODES: Record<AIMode, AIModeCopy> = {
  'self-host': {
    title: 'Which AI should your team think with?',
    lead: 'Your helpers, and our chat next, run on it. Pick what you already have; you can change it anytime in AI accounts.',
    hint: 'Runs on this computer with the AI you already have.',
    options: [
      {
        id: 'existing',
        icon: Laptop,
        title: 'Use an account already connected',
        desc: 'Pick from the AI accounts your company already has in the pool.',
      },
      {
        id: 'api-key',
        icon: KeyRound,
        title: 'Connect an API key',
        desc: 'Pay as you go with your own key — Anthropic, OpenAI, Google and more.',
        chips: ['Anthropic', 'OpenAI', 'Google', 'More…'],
      },
    ],
    cta: 'Connect and continue',
    good: [
      { icon: Users, title: 'It runs your whole team', desc: 'Every helper and every job uses the AI you connect here.' },
      {
        icon: Coins,
        title: 'Costs stay with you',
        desc: 'A sign-in or subscription costs nothing extra. With a key, you pay your provider directly.',
      },
      { icon: ArrowLeftRight, title: 'Change it anytime', desc: 'Add more accounts later and Omilo spreads jobs across them.' },
      { icon: Lock, title: 'Your data stays yours', desc: 'Omilo runs on this computer. We never see your chats or files.' },
    ],
  },
  cloud: {
    title: 'Run your team on Omilo Cloud',
    lead: 'Helpers keep working 24/7, even when your computer is off. One fixed monthly price for your company, sized by storage — with your own AI key.',
    hint: 'Always on. Fixed price per company. Your own AI key.',
    options: [],
    footQ: 'Rather run it on this computer?',
    footA: 'Switch to Self-host',
    cta: 'Start free and continue',
    good: [
      { icon: Cloud, title: 'Always on', desc: 'Helpers run in the cloud, so jobs finish while you sleep or travel.' },
      { icon: Coins, title: 'A price you can plan for', desc: 'One monthly price for the whole company. No credits, no per-seat fees.' },
      { icon: Users, title: 'Everyone included', desc: 'Invite your whole team and add as many helpers as you need.' },
      { icon: KeyRound, title: 'Your AI, your bill', desc: 'Helpers use your own Claude or OpenAI key, so AI costs go straight to your provider.' },
      { icon: Lock, title: 'Encrypted and yours', desc: 'Your notes and files are encrypted in Omilo Cloud. Export or delete anytime.' },
    ],
  },
}

// ── Step 3 · Get to know you ─────────────────────────────────────────────────

// ── Step 4 · Check ───────────────────────────────────────────────────────────

// ── Step 5 · Your team ───────────────────────────────────────────────────────

export interface TeamHelper {
  id: string
  name: string
  area: HelperArea
  role: string
  description: string
  reason: string
  badge?: 'always' | 'suggested'
  on: boolean
}


// ── Step 6 · Team ready (first Inbox) ────────────────────────────────────────

export interface InboxJob {
  id: string
  helper: string
  area: HelperArea
  cost: string
  title: string
  desc: string
}

export const INBOX_JOBS: InboxJob[] = [
  {
    id: 'chief-job',
    helper: 'Chief of Staff',
    area: 'brand',
    cost: 'Weekdays',
    title: 'Send you a morning brief',
    desc: 'Weekdays 07:30 · decisions, what changed, what’s next',
  },
  {
    id: 'builder-job',
    helper: 'Builder',
    area: 'dev',
    cost: 'On every push',
    title: 'Check sahabat-warga for failing tests',
    desc: 'Every push to main · opens a PR when it can fix it',
  },
  {
    id: 'grower-job',
    helper: 'Grower',
    area: 'ops',
    cost: 'Weekly',
    title: 'Weekly growth review',
    desc: 'Mondays 08:00 · sign-ups, paying neighbourhoods, one idea',
  },
  {
    id: 'support-job',
    helper: 'Support',
    area: 'support',
    cost: 'As messages arrive',
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

export const INBOX_AREAS = [
  { label: 'General', count: 2, color: '#A8A29E' },
  { label: 'Engineering', count: 5, color: 'var(--color-helper-dev)' },
  { label: 'Marketing', count: 4, color: 'var(--color-helper-marketing)' },
  { label: 'Business', count: 3, color: 'var(--color-helper-sales)' },
]
