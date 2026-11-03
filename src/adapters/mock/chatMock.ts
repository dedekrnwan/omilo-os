/**
 * sweep/chat — in-memory mock state for the persisted chat workspace
 * (archive, private Chief threads, folder pages, sharing, results, nudges).
 *
 * Shares the module-level fixture arrays with mockRepos / mockCommands, so a
 * mutation from a command is visible on the next repo read. Objects are always
 * REPLACED (never mutated in place) so react-query's structural sharing sees
 * the change.
 */
import type {
  ChiefNudge,
  Folder,
  FolderFile,
  Message,
  Session,
  SessionResults,
  ShareMember,
  Shares,
} from '../../core/domain/types'
import { folders, inboxItems, members, messages, sessions } from './fixtures'

let seq = 0
export function chatMockId(prefix: string): string {
  seq += 1
  return `${prefix}-chat-mock-${seq}`
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

// ── Archived chats (were STATIC_ARCHIVED_CHATS in the archived drawer) ─────────

export const archivedSessions: Session[] = [
  { id: 'a-1', channelId: 'ch-general', title: 'Sprint 41 planning', updated: 'Sep 30', archivedAt: daysAgo(29) },
  { id: 'a-2', channelId: 'ch-engineering', title: 'Old CI runner migration', updated: 'Sep 22', archivedAt: daysAgo(37), participants: [{ name: 'Dev', area: 'dev' }] },
  { id: 'a-3', channelId: 'ch-marketing', title: 'Logo refresh feedback', updated: 'Sep 18', archivedAt: daysAgo(41), participants: [{ name: 'Grower', area: 'ops' }] },
  { id: 'a-4', channelId: 'ch-general', title: 'Q3 hiring plan', updated: 'Sep 10', archivedAt: daysAgo(49) },
  { id: 'a-5', channelId: 'ch-engineering', title: 'Status page outage notes', updated: 'Aug 29', archivedAt: daysAgo(61), participants: [{ name: 'Dev', area: 'dev' }] },
  { id: 'a-6', channelId: 'ch-business', title: 'Vendor invoice dispute', updated: 'Aug 21', archivedAt: daysAgo(69), participants: [{ name: 'Finance', area: 'finance' }] },
]

// ── Private Chief threads (were CHIEF_THREADS / CHIEF_MESSAGES) ────────────────

export const chiefThreads: Session[] = [
  { id: 'chief-t1', kind: 'chief_private', title: 'Are we spreading too thin?', updated: '14:03', pinned: true },
  { id: 'chief-t2', kind: 'chief_private', title: 'Prep · 3pm with Pak RT', updated: '11:20', unread: true },
  { id: 'chief-t3', kind: 'chief_private', title: 'Kopi Kenangan renewal', updated: '09:12', unread: true },
  { id: 'chief-t4', kind: 'chief_private', title: 'Brain-dump · field coordinator', updated: 'Yest.' },
  { id: 'chief-t5', kind: 'chief_private', title: 'What am I forgetting this week?', updated: 'Mon' },
]

const chiefAuthor = { kind: 'helper' as const, name: 'Chief', role: 'Chief of Staff', area: 'brand' as const }
const you = { kind: 'you' as const, name: 'You' }

function seedChiefMessages() {
  const t = (h: number, m: number) => {
    const d = new Date()
    d.setHours(h, m, 0, 0)
    return d.toISOString()
  }
  const seed: Message[] = [
    { id: 'chief-m1', sessionId: 'chief-t1', author: you, content: 'Honestly — are we spreading too thin this quarter? Everything feels half done.', createdAt: t(14, 2) },
    { id: 'chief-m2', sessionId: 'chief-t1', author: chiefAuthor, content: 'A bit, yes. 7 goals are open but only 3 moved this month. The other 4 share one blocker: they wait on your approval, usually 2+ days.\n\nTwo ways out: pause 2 of them until December, or let Builder approve its own small deploys.', createdAt: t(14, 2) },
    { id: 'chief-m3', sessionId: 'chief-t1', author: you, content: 'Second one. Don’t change anything yet, just draft it.', createdAt: t(14, 3) },
    { id: 'chief-m4', sessionId: 'chief-t1', author: chiefAuthor, content: 'Drafted, not applied. I’ll bring it to you Monday with the Q4 review — nothing changes until you say so.', createdAt: t(14, 3) },
    {
      id: 'chief-m4b',
      sessionId: 'chief-t1',
      author: chiefAuthor,
      createdAt: t(14, 4),
      // Plain-text fallback (search / notifications); the blocks drive the bubble.
      content: 'Here’s the draft and a short pause note.',
      blocks: [
        {
          type: 'reasoning',
          durationS: 8,
          text: 'Looked at the 7 open goals and when each last moved.\n\n- **4** share one blocker: they wait on your approval\n- Pausing the 2 slowest frees ~2 days/week and lets the other 2 breathe\n- Nothing here changes a live goal — this is a draft only',
        },
        {
          type: 'markdown',
          text: '**Draft — pause 2 goals until December**\n\nTwo goals have waited on you and haven’t moved in 3 weeks:\n\n1. Loyalty program\n2. Second kitchen\n\nI’ll keep them visible, just off the active board. Reply `resume loyalty` anytime to bring one back.',
        },
        {
          type: 'code',
          lang: 'markdown',
          name: 'pause-note.md',
          text: 'Paused until Dec 1\nReason: waiting on owner approval\nUnblock: reply "resume <goal>"',
        },
      ],
    },
    { id: 'chief-m5', sessionId: 'chief-t2', author: chiefAuthor, content: 'Clean-up budget and late pickups — 2 notes ready for your 3pm.', createdAt: t(11, 20) },
    { id: 'chief-m6', sessionId: 'chief-t3', author: chiefAuthor, content: 'They’ll ask for 10% off. Your floor is 6%.', createdAt: t(9, 12) },
  ]
  for (const m of seed) if (!messages.some((x) => x.id === m.id)) messages.push(m)
}
seedChiefMessages()

/** Canned Chief reply for mock mode (no engine offline). */
export function mockChiefReply(sessionId: string, prompt: string): Message {
  return {
    id: chatMockId('msg'),
    sessionId,
    author: chiefAuthor,
    content: `Noted — “${prompt.slice(0, 80)}”. (Offline demo: connect the API for a real answer.)`,
    createdAt: new Date().toISOString(),
  }
}

// ── Folder pages (were FOLDER_PAGES) ──────────────────────────────────────────

export const folderInstructions: Record<string, string> = {
  'f-q4': 'Everything here is about the Nov 28 launch. Keep answers short, cite the rollout doc, and flag anything that risks the code freeze.',
}

export const folderFiles: Record<string, FolderFile[]> = {
  'f-q4': [
    { id: 'ff-1', folderId: 'f-q4', name: 'Passkey rollout — v1', size: 18_400, mime: 'text/markdown', hasText: true },
    { id: 'ff-2', folderId: 'f-q4', name: 'Launch checklist.xlsx', size: 42_100, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', hasText: false },
    { id: 'ff-3', folderId: 'f-q4', name: 'Freeze calendar.pdf', size: 120_000, mime: 'application/pdf', hasText: false },
  ],
}

function memberShare(userId: string, permission: ShareMember['permission']): ShareMember | null {
  const m = members.find((x) => x.userId === userId)
  return m ? { userId: m.userId, name: m.name, email: m.email, permission } : null
}

export const folderShares: Record<string, ShareMember[]> = {
  'f-q4': [memberShare('usr-ra', 'can_talk'), memberShare('usr-by', 'can_view')].filter(Boolean) as ShareMember[],
}

export const sessionShares: Record<string, Shares> = {}

export function getSessionShares(id: string): Shares {
  return (
    sessionShares[id] ?? {
      members: [memberShare(members[0]?.userId ?? '', 'owner')].filter(Boolean) as ShareMember[],
      generalAccess: 'restricted',
    }
  )
}

export function folderDetail(id: string): Folder | null {
  const f = folders.find((x) => x.id === id)
  if (!f) return null
  const count = sessions.filter((s) => s.folderId === id).length
  return { ...f, count: Math.max(count, 0), ...(folderInstructions[id] ? { instructions: folderInstructions[id] } : {}) }
}

// ── Results (were the ResultsPanel STEPS / OUTPUTS) ─────────────────────────────

export const sessionResults: Record<string, SessionResults> = {
  'sess-passkey': {
    steps: [
      { id: 'job-1', label: 'Audit current login flow', status: 'done', helper: 'Dev', helperArea: 'dev', durationS: 120 },
      { id: 'job-2', label: 'Draft rollout plan', status: 'done', helper: 'Chief', helperArea: 'brand', durationS: 240 },
      { id: 'job-3', label: 'Write migration doc for Support', status: 'running', helper: 'Dev', helperArea: 'dev' },
      { id: 'job-4', label: 'Schedule staged rollout', status: 'pending', helper: 'Chief', helperArea: 'brand' },
    ],
    outputs: [
      {
        id: 'rep-1',
        jobId: 'job-2',
        title: 'Passkey rollout plan',
        helper: 'Dev',
        bodyMd:
          'Goal: passwordless login for 80% of active users by Q4 code freeze (Nov 28).\n\n## Timeline\n\n| Phase | Who | When |\n|---|---|---|\n| Web + iOS WebAuthn | Dev | Nov 14 |\n| Android fallback | Dev | Nov 20 |\n| Resident comms | Grower | Nov 18 |\n| 10% → 100% rollout | Chief | Nov 21–28 |\n\n## Risks\n\nLegacy Android (< v9) can’t do WebAuthn — keep password + OTP for those 6% of users until they update.',
      },
    ],
    activity: [
      { id: 'evt-1', jobId: 'job-3', kind: 'browser', helper: 'Dev', action: 'navigate', url: 'https://console.saga.id/auth/passkeys', title: 'Auth console · Passkeys' },
      { id: 'evt-2', jobId: 'job-3', kind: 'browser', helper: 'Dev', action: 'toggle', url: 'https://console.saga.id/auth/passkeys', title: 'Enable passkeys' },
    ],
    usage: { tokensIn: 61_000, tokensOut: 23_000, costCredits: 42 },
  },
}

export function getSessionResults(id: string): SessionResults {
  return sessionResults[id] ?? { steps: [], outputs: [], activity: [], usage: { tokensIn: 0, tokensOut: 0, costCredits: 0 } }
}

// ── Chief nudges (derived from inbox "needs you", like the API) ────────────────

export const dismissedNudges = new Map<string, number | null>()

export function listChiefNudges(): ChiefNudge[] {
  const now = Date.now()
  return inboxItems
    .filter((i) => i.needsYou && i.status === 'pending')
    .map((i): ChiefNudge => ({
      id: `inbox:${i.id}`,
      body: `Got two minutes? ${i.asker} ${i.kind === 'decision' ? 'needs your decision on' : 'is waiting on you for'} “${i.title}”.`,
      prompt: `Walk me through “${i.title}” — what does ${i.asker} need from me?`,
      primary: 'Walk me through',
      secondary: 'Later',
      inboxItemId: i.id,
      sessionId: i.sessionId,
    }))
    .filter((n) => {
      if (!dismissedNudges.has(n.id)) return true
      const until = dismissedNudges.get(n.id)
      return until != null && until <= now
    })
    .slice(0, 3)
}

/** Archived or private Chief session by id (active ones live in `sessions`). */
export function findSession(id: string): Session | undefined {
  return archivedSessions.find((s) => s.id === id) ?? chiefThreads.find((s) => s.id === id)
}
