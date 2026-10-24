/**
 * Static fixture data for the Chief DM drawer — copy from pen
 * ozMOv (closed) · pHj0k (nudge) · nkqAN (open) · N30qNb (full screen) · hM9k9 (threads).
 */

export interface ChiefMessage {
  id: string
  kind: 'user' | 'chief'
  text: string
  time: string
}

export interface ChiefThread {
  id: string
  title: string
  preview: string
  time: string
  group: 'TODAY' | 'EARLIER'
  pinned?: boolean
  unread?: boolean
}

export const CHIEF_DAY_LABEL = 'Today 14:02'

export const CHIEF_MESSAGES: ChiefMessage[] = [
  {
    id: 'm1',
    kind: 'user',
    text: 'Honestly — are we spreading too thin this quarter? Everything feels half done.',
    time: '14:02',
  },
  {
    id: 'm2',
    kind: 'chief',
    text: 'A bit, yes. 7 goals are open but only 3 moved this month. The other 4 share one blocker: they wait on your approval, usually 2+ days.\n\nTwo ways out: pause 2 of them until December, or let Builder approve its own small deploys.',
    time: '14:02',
  },
  {
    id: 'm3',
    kind: 'user',
    text: 'Second one. Don’t change anything yet, just draft it.',
    time: '14:03',
  },
  {
    id: 'm4',
    kind: 'chief',
    text: 'Drafted, not applied. I’ll bring it to you Monday with the Q4 review — nothing changes until you say so.',
    time: '14:03',
  },
]

export const CHIEF_THREADS: ChiefThread[] = [
  {
    id: 't1',
    title: 'Are we spreading too thin?',
    preview: 'Drafted, not applied. I’ll bring it Monday.',
    time: '14:03',
    group: 'TODAY',
    pinned: true,
  },
  {
    id: 't2',
    title: 'Prep · 3pm with Pak RT',
    preview: 'Clean-up budget and late pickups — 2 notes.',
    time: '11:20',
    group: 'TODAY',
    unread: true,
  },
  {
    id: 't3',
    title: 'Kopi Kenangan renewal',
    preview: 'They’ll ask for 10% off. Your floor is 6%.',
    time: '09:12',
    group: 'TODAY',
    unread: true,
  },
  {
    id: 't4',
    title: 'Brain-dump · field coordinator',
    preview: '6 must-haves; 2 overlap with Support.',
    time: 'Yest.',
    group: 'EARLIER',
  },
  {
    id: 't5',
    title: 'What am I forgetting this week?',
    preview: 'Invoice, domain renewal, Bayu’s 1:1.',
    time: 'Mon',
    group: 'EARLIER',
  },
  {
    id: 't6',
    title: 'Should we raise prices?',
    preview: 'Not yet. Wait for the December cohort.',
    time: 'Oct 14',
    group: 'EARLIER',
  },
]

export const NUDGE = {
  name: 'Chief',
  scope: 'Just you',
  body: 'Got two minutes? Before your 3pm with Pak RT, there are two things he’ll likely ask about — the clean-up budget and the late pickups.',
  primary: 'Walk me through',
  secondary: 'After lunch',
} as const

export const QUICK_PROMPTS = ['Prep my 3pm', 'What am I forgetting?', 'Brain-dump'] as const

export const THREADS_NOTE =
  'Chief never posts these to a channel or acts on them unless you ask. Delete any chat any time.'
