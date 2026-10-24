/**
 * Static fixture data for the Chief DM widget.
 * Mirrors the design refs: nkqAN.png (open panel), N30qNb.png (full screen),
 * hM9k9.png (threads list), pHj0k.png (nudge bubble).
 */

export interface ChiefMessage {
  id: string
  kind: 'user' | 'chief'
  text: string
  time: string
}

export interface ChiefThread {
  id: string
  preview: string
  time: string
  unread?: boolean
}

// ── Active chat (open panel / full screen) ────────────────────────────────────

export const CHIEF_MESSAGES: ChiefMessage[] = [
  {
    id: 'm1',
    kind: 'chief',
    text: 'Honestly — are we spreading too thin this quarter? Everything feels half done.',
    time: '14:40',
  },
  {
    id: 'm2',
    kind: 'chief',
    text: 'A bit, yes. 7 goals are open but only 3 moved this month. The other 4 share one blocker: they wait on your approval, usually 2+ days.',
    time: '14:41',
  },
  {
    id: 'm3',
    kind: 'chief',
    text: 'Two ways out: pause 2 of them until December, or let Builder approve its own small deploys.',
    time: '14:41',
  },
  {
    id: 'm4',
    kind: 'user',
    text: 'Second one. Don\'t change anything yet, just draft it.',
    time: '14:42',
  },
  {
    id: 'm5',
    kind: 'chief',
    text: 'Drafted, not applied. I\'ll bring it to you Monday with the Q4 review — nothing changes until you say so.',
    time: '14:42',
  },
]

// ── Threads list (hM9k9.png) ──────────────────────────────────────────────────

export const CHIEF_THREADS: ChiefThread[] = [
  {
    id: 't1',
    preview: 'Are we spreading too thin? 7 goals open, bring it Monday.',
    time: '14:42',
    unread: false,
  },
  {
    id: 't2',
    preview: 'Prep · 3pm with Pak RT — clean-up budget and late pickups — 2 notes.',
    time: '11:36',
    unread: true,
  },
  {
    id: 't3',
    preview: 'Kopi Kenangan renewal — they offer 96% VK. Your floor is 6%',
    time: 'Tue',
    unread: false,
  },
  {
    id: 't4',
    preview: 'Brain-dump · field coordinator — 4 most-heard, 2 overlap with Support',
    time: 'Tue',
    unread: false,
  },
  {
    id: 't5',
    preview: 'What am I forgetting this week? — 3 items surfaced.',
    time: 'Mon',
    unread: false,
  },
  {
    id: 't6',
    preview: 'Should we raise prices? — Not yet. Wait for the December cohort.',
    time: 'Oct 12',
    unread: false,
  },
]

// ── Nudge bubble (pHj0k.png) ─────────────────────────────────────────────────

export const NUDGE = {
  title: 'Chief',
  subtitle: 'Just you',
  body: 'Got two minutes? Before your 3pm with Pak RT, there are two things he\'ll likely ask about — the clean-up budget and the late pickups.',
  actions: ['Walk me through', 'After lunch'],
} as const

// ── Quick prompts (shown in composer area) ────────────────────────────────────

export const QUICK_PROMPTS = [
  'Prep my 3pm',
  'What am I forgetting?',
  'Brain-dump',
] as const
