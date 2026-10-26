import type { GEdge, GNode } from './NetworkGraph'

// Coordinates are measured from the pen frames (canvas top-left = 0,0).

// ── Docs · Graph (Czmj0) — canvas 911 × 843 ───────────────────────────────────

export const DOC_FRAME = { w: 911, h: 843 }

export type DocArea = 'engineering' | 'marketing' | 'business' | 'general'

export const AREA_COLOR: Record<DocArea | 'goal', string> = {
  engineering: '#14B8A6',
  marketing: '#F97316',
  business: '#8B5CF6',
  general: '#A8A29E',
  goal: '#15803D',
}

export interface DocGraphNode extends GNode {
  area: DocArea | 'goal'
  /** Notes view doc id it opens */
  docId?: string
  meta?: string
  excerpt?: string
  by?: 'team' | 'agents'
}

const doc = (
  id: string,
  label: string,
  x: number,
  y: number,
  area: DocArea | 'goal',
  extra: Partial<DocGraphNode> = {},
): DocGraphNode => ({ id, kind: area === 'goal' ? 'goal' : 'doc', label, x, y, area, color: AREA_COLOR[area], by: 'agents', ...extra })

export const DOC_NODES: DocGraphNode[] = [
  doc('passkey', 'Passkey rollout — v1', 360, 329, 'engineering', {
    big: true,
    docId: 'd-passkey',
    meta: 'Engineering / Q4 Launch · 6 links · edited 2h ago',
    excerpt: 'Ship passkeys to every user before the Nov 28 code freeze, in two waves…',
  }),
  doc('launch', 'Launch checklist', 230, 219, 'engineering', { docId: 'd-launch-cl', by: 'team' }),
  doc('freeze', 'Freeze exceptions', 480, 214, 'engineering', { docId: 'd-freeze' }),
  doc('goal', 'Goal · Passwordless login', 360, 149, 'goal'),
  doc('arch', 'Architecture overview', 150, 349, 'engineering', { docId: 'd-arch' }),
  doc('pg16', 'Postgres 16 runbook', 250, 469, 'engineering', { docId: 'd-pg16', by: 'team' }),
  doc('pm482', 'Postmortem #482', 440, 469, 'engineering', { docId: 'd-post482' }),
  doc('brand', 'Brand voice guide', 740, 109, 'marketing', { docId: 'd-brand', by: 'team' }),
  doc('referral', 'Referral program brief', 660, 189, 'marketing', { big: true, docId: 'd-referral' }),
  doc('comms', 'Launch comms copy', 600, 299, 'marketing', { docId: 'd-launch-c' }),
  doc('handbook', 'Company handbook', 380, 639, 'general', { big: true, docId: 'd-handbook', by: 'team' }),
  doc('holiday', 'Holiday schedule', 140, 639, 'general', { docId: 'd-holiday', by: 'team' }),
  doc('offsite', 'Offsite venues', 260, 719, 'general', { docId: 'd-offsite' }),
  doc('pricing', 'Pricing 2026', 540, 649, 'business', { docId: 'd-pricing', by: 'team' }),
  doc('arunika', 'Arunika pilot redlines', 660, 559, 'business', { docId: 'd-arunika' }),
  doc('close', 'October close summary', 720, 659, 'business', { docId: 'd-close' }),
  doc('rollback', 'Rollback drill notes', 60, 520, 'engineering', { docId: 'd-runbooks', by: 'team' }),
]

export const DOC_EDGES: GEdge[] = [
  { from: 'passkey', to: 'launch' },
  { from: 'passkey', to: 'freeze' },
  { from: 'passkey', to: 'goal' },
  { from: 'goal', to: 'freeze' },
  { from: 'launch', to: 'freeze' },
  { from: 'passkey', to: 'arch' },
  { from: 'passkey', to: 'pm482' },
  { from: 'passkey', to: 'comms' },
  { from: 'arch', to: 'pg16' },
  { from: 'pg16', to: 'pm482' },
  { from: 'pg16', to: 'handbook' },
  { from: 'comms', to: 'referral' },
  { from: 'referral', to: 'brand' },
  { from: 'comms', to: 'brand' },
  { from: 'handbook', to: 'holiday' },
  { from: 'handbook', to: 'offsite' },
  { from: 'handbook', to: 'pricing' },
  { from: 'pricing', to: 'arunika' },
  { from: 'pricing', to: 'close' },
  { from: 'pricing', to: 'referral' },
]

// ── Docs · Knowledge (eU7Fc) — canvas 1145 × 843 ─────────────────────────────

export const KNOW_FRAME = { w: 1145, h: 843 }

export type MemTag = 'lesson' | 'preference' | 'fact'
export const TAG_COLOR: Record<MemTag, string> = {
  lesson: '#F59E0B',
  preference: '#EC4899',
  fact: '#A8A29E',
}

export interface KnowNode extends GNode {
  tag?: MemTag
  owner?: string
  /** Where it was learned */
  source?: string
  review?: boolean
}

const agent = (id: string, label: string, x: number, y: number, helper: KnowNode['helper']): KnowNode => ({
  id,
  kind: 'agent',
  label,
  x,
  y,
  helper,
})

const mem = (id: string, label: string, x: number, y: number, tag: MemTag, owner: string, extra: Partial<KnowNode> = {}): KnowNode => ({
  id,
  kind: 'memory',
  label,
  x,
  y,
  tag,
  owner,
  color: TAG_COLOR[tag],
  source: tag === 'fact' ? 'Company facts' : 'Learned in chat',
  ...extra,
})

export const KNOW_NODES: KnowNode[] = [
  { id: 'hub', kind: 'hub', label: 'Company facts', x: 572, y: 300 },
  agent('chief', 'Chief', 359, 252, 'brand'),
  agent('dev', 'Dev', 799, 212, 'dev'),
  agent('ops', 'Ops', 899, 401, 'ops'),
  agent('growth', 'Growth', 299, 451, 'marketing'),
  agent('finance', 'Finance', 599, 471, 'finance'),
  mem('m-deploys', 'Deploys not after 21:00', 329, 139, 'lesson', 'chief', { review: true, source: 'Your Inbox decision · Nov 4' }),
  mem('m-urgent', 'Urgent → WhatsApp', 429, 164, 'preference', 'chief'),
  mem('m-brief', 'Brief: max 5 bullets', 209, 264, 'lesson', 'chief', { labelSide: 'left', review: true, source: 'Your edit to a brief · Nov 2' }),
  mem('m-mas', 'Call him “Mas Dede”', 239, 329, 'preference', 'chief', { labelSide: 'left' }),
  mem('m-refunds', 'Refunds > Rp 2jt → Dede', 399, 354, 'lesson', 'chief'),
  mem('m-serves', 'Serves RT/RW admins', 531, 214, 'fact', 'hub'),
  mem('m-q4', 'Q4 freeze: Nov 28', 649, 254, 'fact', 'hub'),
  mem('m-staging', 'Staging before prod', 769, 114, 'preference', 'dev'),
  mem('m-migr', 'Run migrations once', 909, 149, 'lesson', 'dev', { source: 'Postmortem #482' }),
  mem('m-push', 'Never force-push main', 919, 244, 'lesson', 'dev'),
  mem('m-oncall', 'On-call: Bayu, Rina', 939, 319, 'fact', 'ops'),
  mem('m-drill', 'Rollback drill ≈ 11 min', 984, 459, 'lesson', 'ops', { source: 'Postmortem #482' }),
  mem('m-voice', 'Voice: warm, no slang', 179, 494, 'preference', 'growth', { labelSide: 'left' }),
  mem('m-ads', 'Ads stop at the cap', 354, 524, 'lesson', 'growth'),
  mem('m-books', 'Books close day 5', 719, 454, 'fact', 'finance'),
  mem('m-cloud', 'Flag cloud spend > 15%', 689, 534, 'lesson', 'finance'),
]

export const KNOW_EDGES: GEdge[] = [
  { from: 'hub', to: 'chief' },
  { from: 'hub', to: 'dev' },
  { from: 'hub', to: 'ops' },
  { from: 'hub', to: 'growth' },
  { from: 'hub', to: 'finance' },
  { from: 'hub', to: 'm-serves' },
  { from: 'hub', to: 'm-q4' },
  { from: 'm-q4', to: 'dev' },
  { from: 'chief', to: 'm-deploys' },
  { from: 'chief', to: 'm-urgent' },
  { from: 'chief', to: 'm-brief' },
  { from: 'chief', to: 'm-mas' },
  { from: 'chief', to: 'm-refunds' },
  { from: 'm-refunds', to: 'finance' },
  { from: 'dev', to: 'm-staging' },
  { from: 'dev', to: 'm-migr' },
  { from: 'dev', to: 'm-push' },
  { from: 'ops', to: 'm-oncall' },
  { from: 'ops', to: 'm-drill' },
  { from: 'growth', to: 'm-voice' },
  { from: 'growth', to: 'm-ads' },
  { from: 'finance', to: 'm-books' },
  { from: 'finance', to: 'm-cloud' },
]

/** Where dropped sources land around Company facts (cUtde) */
export const SOURCE_SLOTS = [
  { x: 711, y: 286 },
  { x: 673, y: 344 },
  { x: 639, y: 404 },
  { x: 760, y: 400 },
  { x: 700, y: 230 },
]

/** The memories an answer about deploys cites (WZycb), in order */
export const DEPLOY_ANSWER = ['m-deploys', 'm-staging', 'm-migr', 'm-push', 'm-drill', 'm-q4']

export const AGENT_NAME: Record<string, string> = {
  chief: 'Chief',
  dev: 'Dev',
  ops: 'Ops',
  growth: 'Growth',
  finance: 'Finance',
  hub: 'Company fact',
}
