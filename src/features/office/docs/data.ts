/**
 * Static data for the Office Docs page (company-wide docs, not channel-scoped).
 * Matches the pen.dev design refs: pxBeD, Czmj0, ZDuRA, eU7Fc, WZycb, TBJls,
 * cUtde, o3rK0g, igY8b, n8N6dT, j5pVM, Jrggy, N4uuSY.
 */

// ── Areas & doc list (Notes / Handbook sidebar) ───────────────────────────────

export interface DocFile {
  id: string
  title: string
  icon: 'doc' | 'folder' | 'check' | 'markdown'
  edited: string
  editor: string
  pinned?: boolean
  unread?: boolean
  status?: 'v1' | 'draft'
  /** Badge shown in the "What's new" right panel */
  badge?: 'Updated' | 'New'
}

export interface DocArea {
  id: string
  label: string
  docs: DocFile[]
}

export const DOC_AREAS: DocArea[] = [
  {
    id: 'engineering',
    label: 'Engineering',
    docs: [
      { id: 'd-q4',        title: 'Q4 Launch',             icon: 'folder',   edited: 'now',  editor: 'Dev', pinned: true },
      { id: 'd-passkey',   title: 'Passkey rollout — v1',  icon: 'doc',      edited: '2h',   editor: 'Dev', status: 'v1', unread: true },
      { id: 'd-freeze',    title: 'Freeze exceptions',      icon: 'doc',      edited: '2h',   editor: 'Dev', unread: true },
      { id: 'd-launch-cl', title: 'Launch checklist',       icon: 'check',    edited: '2h',   editor: 'Chief' },
      { id: 'd-runbooks',  title: 'Runbooks',               icon: 'folder',   edited: '3d',   editor: 'Dev' },
      { id: 'd-pg16',      title: 'Postgres 16 runbook',    icon: 'doc',      edited: '3d',   editor: 'Dev' },
      { id: 'd-post482',   title: 'Postmortem #482',        icon: 'doc',      edited: '1w',   editor: 'Chief' },
      { id: 'd-arch',      title: 'Architecture overview',  icon: 'doc',      edited: '2w',   editor: 'Chief' },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    docs: [
      { id: 'd-brand',     title: 'Brand voice guide',      icon: 'doc',      edited: '4d',   editor: 'Marketing' },
      { id: 'd-referral',  title: 'Referral program brief',  icon: 'doc',      edited: '1w',   editor: 'Marketing' },
      { id: 'd-launch-c',  title: 'Launch comms copy',       icon: 'doc',      edited: '2w',   editor: 'Marketing' },
    ],
  },
  {
    id: 'business',
    label: 'Business',
    docs: [
      { id: 'd-pricing',   title: 'Pricing 2026',            icon: 'doc',      edited: '2d',   editor: 'Chief' },
      { id: 'd-close',     title: 'October close summary',   icon: 'doc',      edited: '3d',   editor: 'Finance' },
      { id: 'd-offsite',   title: 'Offsite venues',          icon: 'doc',      edited: '1w',   editor: 'Ops' },
      { id: 'd-holiday',   title: 'Holiday schedule',        icon: 'doc',      edited: '2w',   editor: 'Ops' },
    ],
  },
  {
    id: 'general',
    label: 'General',
    docs: [
      { id: 'd-handbook',  title: 'Company handbook',        icon: 'folder',   edited: '1d',   editor: 'Dede' },
      { id: 'd-arunika',   title: 'Arunika pilot redlines',  icon: 'doc',      edited: '5d',   editor: 'Ops' },
    ],
  },
]

// ── Active doc (Notes view) ───────────────────────────────────────────────────

export interface ActiveDoc {
  id: string
  title: string
  area: string
  editorName: string
  editedAgo: string
  linkedTo: string
  body: string
}

export const ACTIVE_DOC: ActiveDoc = {
  id: 'd-passkey',
  title: 'Passkey rollout — v1',
  area: 'Engineering / Q4 Launch',
  editorName: 'Dev',
  editedAgo: '2h ago',
  linkedTo: 'Passwordless login by Q4',
  body: `Ship passkeys to every user before the Nov 28 code freeze, in two waves. Owner: Dev. Approved by Dede on Nov 3.

**Wave 1 — web + iOS**

- Ship in staging Nov 10, to 10% of users Nov 12, to 100% Nov 14.
- Fallback stays on; password login remains for anyone without a passkey.
- Release notes reuse [[Launch checklist]].

**Wave 2 — Android**

The legacy WebView blocks WebAuthn, so Android gets a password fallback flow first. Two extra days, now due Nov 23.

- Risk tracked in [[Freeze exceptions policy]]

**Rollback**

Feature flag passkeys_enabled. Ops can flip it in under a minute; drill done Oct 18 (11 minutes end-to-end).`,
}

export const LINKED_DOCS = [
  { id: 'ln-1', title: 'Launch checklist',        meta: 'Q4 Launch · 12 items · 7 done' },
  { id: 'ln-2', title: 'Freeze exceptions policy', meta: 'Only P0 fixes after Nov 28, with Chief sign-off.' },
]

export const LINKED_GOALS = [
  { id: 'lg-1', title: 'Passwordless login by Q4', meta: 'Goal · 40% · Chief cites this doc in 3 check-ins' },
]

// ── Graph view ────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  label: string
  x: number
  y: number
  /** Determines dot colour */
  area: 'engineering' | 'marketing' | 'business' | 'general' | 'goal'
  size?: 'lg' | 'sm'
}

export interface GraphEdge {
  from: string
  to: string
}

export const GRAPH_NODES: GraphNode[] = [
  { id: 'n-passkey',  label: 'Passkey rollout — v1',   x: 450, y: 205, area: 'engineering', size: 'lg' },
  { id: 'n-launch',   label: 'Launch checklist',        x: 310, y: 148, area: 'engineering' },
  { id: 'n-freeze',   label: 'Freeze exceptions',        x: 490, y: 148, area: 'engineering' },
  { id: 'n-goal-pw',  label: 'Goal - Passwordless login', x: 580, y: 112, area: 'goal' },
  { id: 'n-pg16',     label: 'Postgres 16 runbook',     x: 335, y: 273, area: 'engineering' },
  { id: 'n-post482',  label: 'Postmortem #482',         x: 492, y: 273, area: 'engineering' },
  { id: 'n-arch',     label: 'Architecture overview',   x: 257, y: 210, area: 'engineering' },
  { id: 'n-brand',    label: 'Brand voice guide',        x: 640, y: 93, area: 'marketing' },
  { id: 'n-referral', label: 'Referral program brief',   x: 625, y: 162, area: 'marketing' },
  { id: 'n-comms',    label: 'Launch comms copy',        x: 600, y: 225, area: 'marketing' },
  { id: 'n-handbook', label: 'Company handbook',         x: 415, y: 330, area: 'general' },
  { id: 'n-holiday',  label: 'Holiday schedule',         x: 310, y: 330, area: 'general' },
  { id: 'n-pricing',  label: 'Pricing 2026',             x: 520, y: 365, area: 'business' },
  { id: 'n-close',    label: 'October close summary',    x: 620, y: 365, area: 'business' },
  { id: 'n-arunika',  label: 'Arunika pilot redlines',   x: 560, y: 315, area: 'business' },
]

export const GRAPH_EDGES: GraphEdge[] = [
  { from: 'n-passkey',  to: 'n-launch' },
  { from: 'n-passkey',  to: 'n-freeze' },
  { from: 'n-passkey',  to: 'n-goal-pw' },
  { from: 'n-passkey',  to: 'n-pg16' },
  { from: 'n-passkey',  to: 'n-post482' },
  { from: 'n-passkey',  to: 'n-arch' },
  { from: 'n-passkey',  to: 'n-comms' },
  { from: 'n-passkey',  to: 'n-handbook' },
  { from: 'n-handbook', to: 'n-holiday' },
  { from: 'n-handbook', to: 'n-pricing' },
]

export const GRAPH_AREA_COLORS: Record<GraphNode['area'], string> = {
  engineering: 'var(--color-helper-dev)',
  marketing:   'var(--color-helper-marketing)',
  business:    'var(--color-helper-sales)',
  general:     '#A8A29E',
  goal:        '#6366F1',
}

// ── Knowledge view ────────────────────────────────────────────────────────────

export interface KnowledgeMemory {
  id: string
  agent: string
  agentArea: 'brand' | 'ops' | 'dev' | 'support' | 'finance' | 'marketing' | 'sales'
  tag: 'lesson' | 'preference' | 'fact'
  text: string
  needsReview?: boolean
  source?: string
}

export const KNOWLEDGE_MEMORIES: KnowledgeMemory[] = [
  { id: 'km-1', agent: 'Chief', agentArea: 'brand', tag: 'lesson',     text: "Don't propose deploys after 21:00",   needsReview: true, source: 'Inbox decision · Nov 4' },
  { id: 'km-2', agent: 'Dev',   agentArea: 'dev',   tag: 'fact',       text: 'Q4 freeze: Nov 28' },
  { id: 'km-3', agent: 'Dev',   agentArea: 'dev',   tag: 'lesson',     text: 'Serves RT/RW admins' },
  { id: 'km-4', agent: 'Dev',   agentArea: 'dev',   tag: 'lesson',     text: 'Never force-push main' },
  { id: 'km-5', agent: 'Ops',   agentArea: 'ops',   tag: 'lesson',     text: 'On-call: Bayu, Rina' },
  { id: 'km-6', agent: 'Ops',   agentArea: 'ops',   tag: 'fact',       text: 'Rollback drill = 11 min' },
]

export interface KnowledgeNode {
  id: string
  label: string
  x: number
  y: number
  area: 'brand' | 'ops' | 'dev' | 'support' | 'finance' | 'marketing' | 'sales'
  size?: 'lg'
  memories?: string[]
}

export const KNOWLEDGE_NODES: KnowledgeNode[] = [
  { id: 'kn-chief',   label: 'Chief',         x: 330, y: 185, area: 'brand',     size: 'lg', memories: ['Brief: max 5 bullets', "Call him 'Mas Dede'"] },
  { id: 'kn-dev',     label: 'Dev',           x: 490, y: 148, area: 'dev',       size: 'lg', memories: ['Q4 freeze: Nov 28', 'Never force-push main'] },
  { id: 'kn-growth',  label: 'Growth',        x: 295, y: 278, area: 'marketing', size: 'lg', memories: ['Voice: warm, no slang', 'Ads stop at the cap'] },
  { id: 'kn-finance', label: 'Finance',       x: 445, y: 295, area: 'finance',   size: 'lg', memories: ['Books close day 5', 'Flag cloud spend > 15%'] },
  { id: 'kn-ops',     label: 'Ops',           x: 560, y: 270, area: 'ops',       size: 'lg', memories: ['On-call: Bayu, Rina', 'Rollback drill = 11 min'] },
  { id: 'kn-facts',   label: 'Company facts', x: 420, y: 205, area: 'support' },
]

export interface DroppedFile {
  id: string
  name: string
  type: 'xlsx' | 'pdf' | 'jpg' | 'png'
  status: 'reading' | 'added' | 'skipped'
  factsAdded?: number
  factsSkipped?: number
  page?: string
}

export const DROPPED_FILES: DroppedFile[] = [
  { id: 'f-1', name: 'Harga sewa balai.xlsx',    type: 'xlsx', status: 'added',   factsAdded: 12, factsSkipped: 1 },
  { id: 'f-2', name: 'SOP Iuran Warga 2026.pdf', type: 'pdf',  status: 'reading', page: '9 of 14' },
  { id: 'f-3', name: 'Papan RT 04.jpg',           type: 'jpg',  status: 'reading' },
]

// ── Ask Chief view ────────────────────────────────────────────────────────────

export const ASK_CHIEF_SUGGESTIONS = [
  "What's our rollback plan if passkeys break login?",
  'Who can roll back the passkey rollout?',
  'How long did the last rollback drill take?',
]

export const ASK_CHIEF_MATCHING_DOCS = [
  { id: 'md-1', title: 'Passkey rollout — v1',    area: 'Engineering', tag: '"rollback" ×3' },
  { id: 'md-2', title: 'Postmortem #482',          area: 'Engineering', tag: '"rollback drill"' },
  { id: 'md-3', title: 'Rollback drill notes',      area: 'Engineering · folder Q4 Launch', tag: '' },
]

export const ASK_CHIEF_ANSWER = {
  question: "What's our rollback plan if passkeys break login?",
  answer: `Flip the passkeys_enabled flag off — Ops can do it in under a minute and password login stays on for everyone¹. We drilled it on Oct 18: 11 minutes end to end, mostly CDN cache². After Nov 28, anything beyond the flag needs Chief sign-off³.`,
  sources: ['Passkey rollout — v1', 'Postmortem #482', 'Freeze exceptions'],
  cited: [
    { num: 1, title: 'Passkey rollout — v1',   area: 'Engineering · by Dev · Q4 Launch' },
    { num: 2, title: 'Postmortem #482',          area: 'Engineering · by Ops · Oct 19' },
    { num: 3, title: 'Freeze exceptions policy', area: 'Engineering · by Chief' },
  ],
  suggestions: ['Who can flip the flag?', 'Draft a rollback runbook', 'Continue in a chat'],
}

// ── Handbook view ─────────────────────────────────────────────────────────────

export interface HandbookFile {
  id: string
  filename: string
  description: string
  badge?: 'Updated' | 'New'
  badgeCount?: number
}

export const HANDBOOK_FILES: HandbookFile[] = [
  { id: 'hf-1', filename: 'COMPANY.md',  description: 'Who we are and the RTs we cover' },
  { id: 'hf-2', filename: 'SERVICES.md', description: 'Does, letters, bookings — what each costs' },
  { id: 'hf-3', filename: 'POLICIES.md', description: "Refunds, resident data, what needs an owner's OK", badge: 'Updated' },
  { id: 'hf-4', filename: 'VOICE.md',    description: 'How we talk to residents and RT heads' },
  { id: 'hf-5', filename: 'FAQ.md',      description: 'What residents ask every week', badge: 'New', badgeCount: 3 },
  { id: 'hf-6', filename: 'PEOPLE.md',   description: 'Who owns what — members only' },
]

export const POLICIES_MD_CONTENT = `The rules every helper and every person at Sahabat Warga follows. When something isn't covered here, ask the owner — don't guess.

**Refunds**

- Dues paid twice are refunded within 3 working days, to the same method.
- Booking deposits are refunded if cancelled 48 hours before.

**Resident data**

- A resident's name, phone and address never leave their own RT.
- Never paste resident data into a public channel or a shared doc.

**Late dues**

- A Rp 10,000 late fee applies after the 10th of the month.
- The late fee is waived for residents aged 65 and over.`
