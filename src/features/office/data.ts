// Local mock content for Office › Inbox states that the domain model does not carry yet.

import type { HelperArea } from '../../core/domain/types'

/** Detail shown for a proposal in "Review one by one" (pen PuFIB), keyed by proposal text. */
export interface ProposalDetail {
  areaName: string
  desc: string
  details: { icon: 'git-branch' | 'timer' | 'link'; text: string }[]
}

export const PROPOSAL_DETAILS: Record<string, ProposalDetail> = {
  'Ship passkeys on web + iOS': {
    areaName: 'Engineering',
    desc: 'Add passkey sign-in on web and iOS behind a 10% flag. Password login stays as a fallback until the rollout reaches 100%.',
    details: [
      { icon: 'git-branch', text: 'New branch web/passkeys' },
      { icon: 'timer', text: '~4 days of Dev time · Rp 140 rb AI spend' },
      { icon: 'link', text: 'Blocks: Launch comms to all users' },
    ],
  },
  'Android password fallback flow': {
    areaName: 'Engineering',
    desc: 'Keep password + OTP for Android < 9 (6% of users). Show a one-time banner explaining why, and log who stays on passwords so we can nudge them later.',
    details: [
      { icon: 'git-branch', text: 'New branch android/password-fallback' },
      { icon: 'timer', text: '~2 days of Dev time · Rp 90 rb AI spend' },
      { icon: 'link', text: 'Blocks: 10% → 100% rollout' },
    ],
  },
  'Launch comms to all users': {
    areaName: 'Marketing',
    desc: 'Email, in-app banner and a short help article announcing passkeys once web + iOS are at 100%.',
    details: [
      { icon: 'timer', text: '~1 day of Growth time · Rp 40 rb AI spend' },
      { icon: 'link', text: 'Waits for: Ship passkeys on web + iOS' },
    ],
  },
}

/** Toast after approving a multi-task decision (pen U6qpL8). */
export const APPROVED_TOAST = {
  title: '3 tasks approved',
  body: 'Added to “Passwordless login by Q4”. Dev starts with web + iOS.',
}

/** Chief's routine suggestion card (pen BoenW). */
export const ROUTINE_SUGGESTION = {
  id: 'suggest-monday-routines',
  asker: 'Chief',
  askedAgo: 'suggested 5m ago',
  title: 'Spread Monday morning routines',
  summary: '4 routines start between 08:00 and 10:00 on Mondays. Moving two keeps Ops free for incidents.',
  moves: [
    { area: 'marketing' as HelperArea, name: 'Instagram report', from: 'Mon 08:00', to: 'Mon 11:00' },
    { area: 'dev' as HelperArea, name: 'Dependency updates', from: 'Mon 10:00', to: 'Tue 10:00' },
  ],
}

/** Change-amount dialog content (pen mw1zT). */
export const BUDGET = {
  asked: 4800,
  options: [1500, 3000, 4800] as const,
  defaultAmount: 3000,
  runFor: '14 days',
  dailyCap: '$215',
  note: "Start smaller, we'll top up if week 1 looks good.",
}
