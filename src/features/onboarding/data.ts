/** Static mock data for the onboarding wizard (pen VYHu4 … FZ9LR). */
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  Building2,
  Cloud,
  Coins,
  CreditCard,
  Gift,
  KeyRound,
  Laptop,
  Lock,
  MessageCircle,
  Package,
  Repeat,
  Server,
  Shield,
  Sparkles,
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
  /** Detail line shown under the selected option: mono value + muted note + link. */
  found?: { value: string; note: string; link: string }
  chips?: string[]
}

export interface AIModeCopy {
  title: string
  lead: string
  hint: string
  options: AIOption[]
  footQ: string
  footA: string
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
        id: 'signed-in',
        icon: Laptop,
        title: 'Already signed in on this computer',
        desc: 'No key, no extra cost. Your login never leaves this machine.',
        found: { value: 'Claude Code 2.1.169', note: '· signed in on this computer', link: 'Use another' },
      },
      {
        id: 'subscription',
        icon: CreditCard,
        title: 'A subscription you already pay for',
        desc: 'Like Claude Pro or Max. Sign in once in your browser.',
      },
      {
        id: 'api-key',
        icon: KeyRound,
        title: 'An API key',
        desc: 'Pay as you go with your own key.',
        chips: ['Anthropic', 'OpenAI', 'Google', 'More…'],
      },
    ],
    footQ: 'No AI yet?',
    footA: 'Try with fixed questions',
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
    title: 'How do you want to pay for Cloud?',
    lead: "Helpers keep working 24/7, even when your computer is off. Every job they run uses Omilo credits; you'll see the balance in Billing.",
    hint: 'Runs on Omilo Cloud. Pay with credits, no AI account needed.',
    options: [
      {
        id: 'free-credits',
        icon: Gift,
        title: 'Start with 1,000 free credits',
        desc: 'About 2 weeks for a small team. No card needed.',
        found: { value: '1 credit ≈ 1 helper step', note: '· usage shown live in Billing', link: 'See pricing' },
      },
      { id: 'pack', icon: Package, title: 'Buy a credit pack', desc: 'Top up anytime. Credits never expire.' },
      {
        id: 'monthly',
        icon: Repeat,
        title: 'Monthly plan',
        desc: 'Credits refill every month. Cancel anytime.',
        chips: ['Starter · 5k credits', 'Team · 20k credits', 'Scale · 60k credits'],
      },
    ],
    footQ: 'Have your own AI?',
    footA: 'Switch to Self-host',
    cta: 'Start free and continue',
    good: [
      { icon: Cloud, title: 'Always on', desc: 'Helpers run in the cloud, so jobs finish while you sleep or travel.' },
      { icon: Coins, title: 'Pay as you use', desc: 'Credits are only spent when a helper works. Set a monthly cap in Billing.' },
      { icon: Sparkles, title: 'Best models included', desc: 'We pick the right model for each job. No API keys to manage.' },
      { icon: Lock, title: 'Encrypted and yours', desc: 'Your notes and files are encrypted in Omilo Cloud. Export or delete anytime.' },
    ],
  },
}

// ── Step 3 · Get to know you ─────────────────────────────────────────────────

export interface LearnedNote {
  id: string
  state: 'done' | 'writing' | 'next' | 'todo'
  text?: string
}

export const LEARNED: LearnedNote[] = [
  { id: 'company', state: 'done', text: 'Community app for RT/RW neighbourhoods in Jabodetabek. 2 founders, 3 developers.' },
  { id: 'customers', state: 'done', text: 'RT heads and residents. Each neighbourhood pays monthly.' },
  { id: 'goals', state: 'writing', text: '100 paying neighbourhoods by December · fewer support chats' },
  { id: 'offer', state: 'next', text: 'Next: what you sell and for how much' },
  { id: 'rules', state: 'todo' },
  { id: 'systems', state: 'todo' },
  { id: 'voice', state: 'todo' },
]

export const INTERVIEW = {
  covered: 'Company and Customers covered · 9 answers',
  q1: 'What would make the next 3 months a win for Sahabat Warga?',
  ideas1: ['100 paying neighbourhoods', 'Launch the WhatsApp sign-up', 'Fewer support chats'],
  hint1: 'Not sure? Pick one to start, or say “give me ideas”.',
  answer:
    '100 paying neighbourhoods using the app by December. And I want fewer manual support chats, they eat my whole day.',
  q2: 'Got it, two goals. How do you count a “paying neighbourhood” today?',
  ideas2: ['An RT that paid this month', 'Any RT with an active admin', "I don't track it yet"],
  saved: 'Saved to Goals: 100 paying neighbourhoods by Dec · fewer support chats',
}

// ── Step 4 · Check ───────────────────────────────────────────────────────────

export interface CheckNote {
  id: string
  content: string
  kpi?: string
  suggested?: string
}

export const CHECK_NOTES: CheckNote[] = [
  {
    id: 'company',
    content:
      'Community app that connects RT/\u200BRW neighbourhoods in Jabodetabek with residents and local services. 2 founders, 3 developers.',
  },
  {
    id: 'customers',
    content: 'RT heads who run the neighbourhood, and residents who pay dues and request services.',
  },
  {
    id: 'goals',
    content: '• 100 paying neighbourhoods by December\n• Cut manual support chats in half',
    kpi: 'Also becomes a KPI: paying neighbourhoods, 0 → 100',
  },
  { id: 'offer', content: 'Rp 150.000 per neighbourhood a month. First month free.' },
  {
    id: 'rules',
    content: "Never message residents without the RT's OK. Never promise refunds.",
    suggested: 'I suggested these two. Check them.',
  },
  { id: 'systems', content: 'WhatsApp Business, Google Sheets for dues, the sahabat-warga code folder.' },
  { id: 'voice', content: 'Warm, simple Bahasa. Calls people “Bapak/Ibu”. No jargon.' },
]

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

export const TEAM_HELPERS: TeamHelper[] = [
  {
    id: 'chief',
    name: 'Chief of Staff',
    area: 'brand',
    role: 'runs the team',
    description: 'Writes your morning brief, routes every request, and runs the weekly retro.',
    reason: 'Every team needs one',
    badge: 'always',
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
    area: 'ops',
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
    badge: 'suggested',
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
    cost: '~40 credits / day',
    title: 'Send you a morning brief',
    desc: 'Weekdays 07:30 · decisions, what changed, what’s next',
  },
  {
    id: 'builder-job',
    helper: 'Builder',
    area: 'dev',
    cost: '~120 credits / run',
    title: 'Check sahabat-warga for failing tests',
    desc: 'Every push to main · opens a PR when it can fix it',
  },
  {
    id: 'grower-job',
    helper: 'Grower',
    area: 'ops',
    cost: '~300 credits / week',
    title: 'Weekly growth review',
    desc: 'Mondays 08:00 · sign-ups, paying neighbourhoods, one idea',
  },
  {
    id: 'support-job',
    helper: 'Support',
    area: 'support',
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

export const INBOX_AREAS = [
  { label: 'General', count: 2, color: '#A8A29E' },
  { label: 'Engineering', count: 5, color: 'var(--color-helper-dev)' },
  { label: 'Marketing', count: 4, color: 'var(--color-helper-marketing)' },
  { label: 'Business', count: 3, color: 'var(--color-helper-sales)' },
]
