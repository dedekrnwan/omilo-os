// Chat-feature mock content that mirrors omilo-v2.pen exactly where the shared
// fixtures don't carry it (sidebar defaults, folder page, archived drawer…).

import type { HelperArea } from '../../core/domain/types'

/** Folders shown expanded in the sidebar by default (pen `Chat Sidebar` XKoGs: Q4 Launch is open). */
export const DEFAULT_OPEN_FOLDERS = new Set(['f-q4'])

/** Sidebar "Goals" count per channel (pen instances: General 2, Engineering 4). */
export const SIDEBAR_GOAL_COUNT: Record<string, number> = {
  'ch-general': 2,
  'ch-engineering': 4,
}

/** Sidebar "Archived" count (pen: 12). */
export const ARCHIVED_COUNT = 12

// ── Folder page (pen `Chat · Folder` A8lWSN) ────────────────────────────────

export interface FolderChat {
  id: string
  title: string
  snippet: string
  /** Helpers in the chat (Mascot avatars, 18px) */
  agents: HelperArea[]
  time: string
}

export interface FolderPage {
  sharedWith?: string
  instructions: string
  files: string[]
  chats: FolderChat[]
}

export const FOLDER_PAGES: Record<string, FolderPage> = {
  'f-q4': {
    sharedWith: 'Rina, Bayu',
    instructions:
      'Everything here is about the Nov 28 launch. Keep answers short, cite the rollout doc, and flag anything that risks the code freeze.',
    files: ['Passkey rollout — v1', 'Launch checklist.xlsx', 'Freeze calendar.pdf'],
    chats: [
      { id: 'sess-passkey',      title: 'Passkey rollout plan',        snippet: 'Chief: Want me to turn this into 3 tasks under the goal?', agents: ['brand', 'dev'],       time: 'now' },
      { id: 'sess-launch-comms', title: 'Launch day comms timeline',   snippet: 'Marketing shared the press window — 9am WIB works.',      agents: ['brand', 'marketing'], time: '2h' },
      { id: 'sess-freeze',       title: 'Freeze exceptions policy',    snippet: 'Dev: Only P0 fixes after Nov 28, with Chief sign-off.',   agents: ['brand', 'dev'],       time: 'Yesterday' },
      { id: 'sess-q4-4',         title: 'Load test results — round 2', snippet: 'p95 held at 230ms under 3× traffic.',                     agents: ['dev'],                time: 'Oct 20' },
      { id: 'sess-q4-5',         title: 'Rollback drill notes',        snippet: 'Ops: drill took 11 minutes end to end.',                  agents: ['ops'],                time: 'Oct 18' },
      { id: 'sess-q4-6',         title: 'Who approves the go/no-go?',  snippet: 'Chief: You and Rina, per the launch doc.',                agents: ['brand'],              time: 'Oct 15' },
    ],
  },
}
