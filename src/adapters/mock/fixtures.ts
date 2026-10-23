import type { Channel, Session, Message, InboxItem } from '../../core/domain/types'
// InboxSubtask and InboxAction are inlined via the InboxItem type — no direct import needed

// ── Channels ─────────────────────────────────────────────────────────────────

export const channels: Channel[] = [
  { id: 'ch-general',     name: 'General',     area: 'ops' },
  { id: 'ch-engineering', name: 'Engineering', area: 'dev' },
  { id: 'ch-marketing',   name: 'Marketing',   area: 'marketing' },
]

// ── Sessions ─────────────────────────────────────────────────────────────────

export const sessions: Session[] = [
  // General
  { id: 'sess-gen-1',  title: 'Q4 planning kickoff',        channelId: 'ch-general' },
  { id: 'sess-gen-2',  title: 'Team onboarding checklist',  channelId: 'ch-general' },
  // Engineering
  { id: 'sess-eng-1',  title: 'API rate-limit investigation', channelId: 'ch-engineering' },
  { id: 'sess-eng-2',  title: 'Database migration plan',      channelId: 'ch-engineering' },
  // Marketing
  { id: 'sess-mkt-1',  title: 'Campaign launch debrief',      channelId: 'ch-marketing' },
  { id: 'sess-mkt-2',  title: 'Content calendar review',      channelId: 'ch-marketing' },
]

// ── Messages ──────────────────────────────────────────────────────────────────

export const messages: Message[] = [
  // sess-gen-1 thread
  {
    id: 'msg-gen-1-1', sessionId: 'sess-gen-1',
    author: { kind: 'you', name: 'You' },
    content: 'Let\'s outline our Q4 priorities. What should we tackle first?',
    createdAt: '2026-10-20T09:00:00Z',
  },
  {
    id: 'msg-gen-1-2', sessionId: 'sess-gen-1',
    author: { kind: 'helper', name: 'Aria', area: 'ops' },
    content: 'Based on last quarter\'s metrics, I\'d suggest focusing on customer retention and infrastructure stability before new feature work.',
    createdAt: '2026-10-20T09:01:30Z',
  },
  {
    id: 'msg-gen-1-3', sessionId: 'sess-gen-1',
    author: { kind: 'you', name: 'You' },
    content: 'Agreed. Can you draft a proposed timeline with milestones?',
    createdAt: '2026-10-20T09:03:00Z',
  },
  {
    id: 'msg-gen-1-4', sessionId: 'sess-gen-1',
    author: { kind: 'helper', name: 'Aria', area: 'ops' },
    content: 'Sure — I\'ll have a draft timeline ready within the hour, broken into four two-week sprints.',
    createdAt: '2026-10-20T09:03:45Z',
  },

  // sess-gen-2 thread
  {
    id: 'msg-gen-2-1', sessionId: 'sess-gen-2',
    author: { kind: 'you', name: 'You' },
    content: 'We have two new engineers starting Monday. What\'s in the onboarding checklist?',
    createdAt: '2026-10-21T10:00:00Z',
  },
  {
    id: 'msg-gen-2-2', sessionId: 'sess-gen-2',
    author: { kind: 'helper', name: 'Aria', area: 'ops' },
    content: 'The checklist covers: account provisioning, local dev setup guide, codebase walkthrough, and a 30-60-90 day goal-setting session.',
    createdAt: '2026-10-21T10:01:00Z',
  },

  // sess-eng-1 thread
  {
    id: 'msg-eng-1-1', sessionId: 'sess-eng-1',
    author: { kind: 'you', name: 'You' },
    content: 'We\'re seeing 429s from the payment gateway starting last night. Any ideas?',
    createdAt: '2026-10-22T08:15:00Z',
  },
  {
    id: 'msg-eng-1-2', sessionId: 'sess-eng-1',
    author: { kind: 'helper', name: 'Byte', area: 'dev' },
    content: 'Looking at the request logs — it appears a retry loop in the checkout service is flooding the endpoint. I\'ll pinpoint the exact commit.',
    createdAt: '2026-10-22T08:16:30Z',
  },
  {
    id: 'msg-eng-1-3', sessionId: 'sess-eng-1',
    author: { kind: 'you', name: 'You' },
    content: 'How bad is the blast radius? Are other services affected?',
    createdAt: '2026-10-22T08:18:00Z',
  },
  {
    id: 'msg-eng-1-4', sessionId: 'sess-eng-1',
    author: { kind: 'helper', name: 'Byte', area: 'dev' },
    content: 'Contained to checkout. Order service and fulfillment are clean. I recommend rolling back to v2.4.1 while we patch.',
    createdAt: '2026-10-22T08:19:15Z',
  },
  {
    id: 'msg-eng-1-5', sessionId: 'sess-eng-1',
    author: { kind: 'you', name: 'You' },
    content: 'Can we ship passkeys to everyone before the Q4 code freeze on Nov 28?',
    createdAt: '2026-10-22T10:41:00Z',
  },
  {
    id: 'msg-eng-1-6', sessionId: 'sess-eng-1',
    author: { kind: 'helper', name: 'Chief', area: 'brand' },
    content: 'Yes — if we split it in two. Your Engineering goal "Passwordless login by Q4" is at 40%, and the blocker is WebAuthn on the legacy Android app. I\'m pulling Dev in to size it.',
    createdAt: '2026-10-22T10:41:30Z',
  },
  // System event line — Chief added Dev
  {
    id: 'msg-eng-1-sys-1', sessionId: 'sess-eng-1',
    author: { kind: 'helper', name: 'Chief', area: 'brand' },
    content: 'Chief added Dev to this chat',
    createdAt: '2026-10-22T10:43:00Z',
    system: true,
  },
  {
    id: 'msg-eng-1-7', sessionId: 'sess-eng-1',
    author: { kind: 'helper', name: 'Dev', area: 'dev' },
    content: 'Sized it. Web + iOS can ship Nov 14 (=3 days). Legacy Android needs a password fallback flow, ≈5 days. Rollout doc is drafted in this channel\'s Docs.',
    createdAt: '2026-10-22T10:43:30Z',
    attachment: {
      title: 'Passkey rollout — v1',
      meta: 'Doc · Engineering · edited just now',
    },
  },
  {
    id: 'msg-eng-1-8', sessionId: 'sess-eng-1',
    author: { kind: 'helper', name: 'Chief', area: 'brand' },
    content: 'Want me to turn this into 3 tasks under the goal? They\'ll show up in Office mode for tracking and approvals.',
    createdAt: '2026-10-22T10:44:00Z',
    actions: [
      { label: 'Create 3 tasks in Goal', primary: true },
      { label: 'Not yet' },
    ],
  },

  // sess-eng-2 thread
  {
    id: 'msg-eng-2-1', sessionId: 'sess-eng-2',
    author: { kind: 'you', name: 'You' },
    content: 'We need to migrate the users table to the new schema by end of sprint. What\'s the safest approach?',
    createdAt: '2026-10-23T14:00:00Z',
  },
  {
    id: 'msg-eng-2-2', sessionId: 'sess-eng-2',
    author: { kind: 'helper', name: 'Byte', area: 'dev' },
    content: 'I recommend a dual-write pattern: write to both old and new schema simultaneously, verify consistency, then cut over reads. Zero-downtime and fully reversible.',
    createdAt: '2026-10-23T14:01:30Z',
  },

  // sess-mkt-1 thread
  {
    id: 'msg-mkt-1-1', sessionId: 'sess-mkt-1',
    author: { kind: 'you', name: 'You' },
    content: 'The campaign wrapped up yesterday. What were the key numbers?',
    createdAt: '2026-10-24T09:00:00Z',
  },
  {
    id: 'msg-mkt-1-2', sessionId: 'sess-mkt-1',
    author: { kind: 'helper', name: 'Mila', area: 'marketing' },
    content: 'Total reach: 240k impressions, 3.8% CTR, 12% conversion on landing page — above our 9% target. Cost per acquisition came in at $18, 25% under budget.',
    createdAt: '2026-10-24T09:01:20Z',
  },
  {
    id: 'msg-mkt-1-3', sessionId: 'sess-mkt-1',
    author: { kind: 'you', name: 'You' },
    content: 'Excellent. What drove the higher conversion — the new copy or the video creative?',
    createdAt: '2026-10-24T09:02:30Z',
  },
  {
    id: 'msg-mkt-1-4', sessionId: 'sess-mkt-1',
    author: { kind: 'helper', name: 'Mila', area: 'marketing' },
    content: 'A/B data shows the video variant outperformed static by 40% on conversion. Copy contributed too, but video was the primary lift.',
    createdAt: '2026-10-24T09:03:45Z',
  },

  // sess-mkt-2 thread
  {
    id: 'msg-mkt-2-1', sessionId: 'sess-mkt-2',
    author: { kind: 'you', name: 'You' },
    content: 'Let\'s review the November content calendar. Are we on track for all planned posts?',
    createdAt: '2026-10-24T11:00:00Z',
  },
  {
    id: 'msg-mkt-2-2', sessionId: 'sess-mkt-2',
    author: { kind: 'helper', name: 'Mila', area: 'marketing' },
    content: 'We have 18 of 22 posts drafted. The four gaps are the partner spotlight series — waiting on brand assets from the partners.',
    createdAt: '2026-10-24T11:01:10Z',
  },
]

// ── Inbox ─────────────────────────────────────────────────────────────────────

export const inboxItems: InboxItem[] = [
  // ── Full approval card #1 — task creation ──────────────────────────────────
  {
    id: 'inbox-1',
    title: 'Approve Q4 planning timeline',
    summary: 'Aria has drafted the Q4 milestone timeline and needs your sign-off before sharing with the wider team.',
    sessionId: 'sess-gen-1',
    kind: 'decision',
    status: 'pending',
    createdAt: '2026-10-20T10:00:00Z',
    // approval card enrichment
    asker: 'Chief',
    askedAgo: '2m ago',
    area: 'dev',
    needsYou: true,
    subtasks: [
      { who: 'Dev', area: 'dev',       text: 'Ship passkeys on web + iOS',         due: 'Nov 14' },
      { who: 'Dev', area: 'dev',       text: 'Android password fallback flow',      due: 'Nov 21' },
      { who: 'Growth', area: 'marketing', text: 'Launch comms to all users',        due: 'Nov 24' },
    ],
    actions: [
      { label: 'Approve all 3', primary: true },
      { label: 'Review one by one' },
      { label: 'Reply' },
    ],
    reassurance: 'Nothing runs until you approve',
  },

  // ── Full approval card #2 — budget approval ────────────────────────────────
  {
    id: 'inbox-2',
    title: 'API rate-limit rollback approved',
    summary: 'Byte confirmed rollback to v2.4.1 resolved the 429 storm. The patched version is ready for review.',
    sessionId: 'sess-eng-1',
    kind: 'update',
    status: 'pending',
    createdAt: '2026-10-22T09:00:00Z',
    // approval card enrichment
    asker: 'Growth',
    askedAgo: '25m ago',
    area: 'marketing',
    needsYou: true,
    actions: [
      { label: 'Approve $4,800', primary: true },
      { label: 'Change amount' },
      { label: 'Reply' },
    ],
    reassurance: 'Charged only when ads run',
  },

  // ── Compact row #3 ─────────────────────────────────────────────────────────
  {
    id: 'inbox-3',
    title: 'Campaign debrief highlights',
    summary: 'October campaign exceeded targets — CPA $18 vs $24 budget, 12% conversion. Mila mentioned you in the summary.',
    sessionId: 'sess-mkt-1',
    kind: 'mention',
    status: 'pending',
    createdAt: '2026-10-24T09:05:00Z',
    // compact enrichment
    askedAgo: '1h',
    area: 'sales',
    compact: true,
  },

  // ── Compact row #4 ─────────────────────────────────────────────────────────
  {
    id: 'inbox-4',
    title: 'Database migration plan ready',
    summary: 'Byte has outlined the dual-write migration strategy for the users table. Decision needed on go/no-go for this sprint.',
    sessionId: 'sess-eng-2',
    kind: 'decision',
    status: 'pending',
    createdAt: '2026-10-23T15:00:00Z',
    // compact enrichment
    askedAgo: 'Yesterday',
    area: 'ops',
    compact: true,
  },
]
