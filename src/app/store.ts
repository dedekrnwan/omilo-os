import { create } from 'zustand'

export type Mode = 'chat' | 'office'

export interface UIState {
  mode: Mode
  lastPath: Record<Mode, string>
  defaultPath: Record<Mode, string>
  rememberPath(mode: Mode, path: string): void
  setMode(mode: Mode): void
  toggleTarget(): { mode: Mode; path: string }
}

export const useUIStore = create<UIState>((set, get) => ({
  mode: 'chat',
  lastPath: { chat: '', office: '' },
  defaultPath: { chat: '/chat', office: '/office/inbox' },

  rememberPath(mode: Mode, path: string) {
    set(state => ({ lastPath: { ...state.lastPath, [mode]: path } }))
  },

  setMode(mode: Mode) {
    if (get().mode !== mode) set({ mode })
  },

  toggleTarget() {
    const state = get()
    const otherMode: Mode = state.mode === 'chat' ? 'office' : 'chat'
    const path = state.lastPath[otherMode] || state.defaultPath[otherMode]
    set({ mode: otherMode })
    return { mode: otherMode, path }
  },
}))

// ── Chat session mutations (mock-only overlay) ────────────────────────────────

export interface SessionOverride {
  /** Renamed title (undefined = use fixture title) */
  title?: string
  /** Whether the session is archived */
  archived?: boolean
  /** Whether pinned to sidebar */
  pinned?: boolean
  /** Folder id the session has been moved to */
  folderId?: string | null
  /** Goal title linked to this session */
  goal?: string | null
}

export interface ArchivedEntry {
  id: string
  title: string
  /** Channel name */
  channelName: string
  archivedAt: string
}

export interface ChatStoreState {
  /** Per-session overrides keyed by session id */
  overrides: Record<string, SessionOverride>
  /** Chats archived through the UI (moves from real sessions list) */
  archived: ArchivedEntry[]
  /** IDs of static archived entries that have been deleted or restored by the user */
  removedStaticIds: Set<string>
  /** Folders created through the UI (local only) */
  newFolders: Array<{ id: string; channelId: string; name: string }>

  /** Apply a partial override to a session */
  patchSession(id: string, patch: Partial<SessionOverride>): void
  /** Archive a session: adds to archived list, marks overrides.archived */
  archiveSession(id: string, title: string, channelName: string): void
  /** Restore an archived session by id */
  restoreSession(id: string): void
  /** Delete an archived entry (dynamic or static) */
  deleteArchived(id: string): void
  /** Delete all archived entries. Pass `staticIds` to also remove static fixture entries. */
  deleteAllArchived(staticIds?: string[]): void
  /** Create a new local folder */
  createFolder(channelId: string, name: string): string
}

let _folderSeq = 0

export const useChatStore = create<ChatStoreState>((set, _get) => ({
  overrides: {},
  archived: [],
  removedStaticIds: new Set(),
  newFolders: [],

  patchSession(id, patch) {
    set(state => ({
      overrides: {
        ...state.overrides,
        [id]: { ...state.overrides[id], ...patch },
      },
    }))
  },

  archiveSession(id, title, channelName) {
    const now = new Date()
    const month = now.toLocaleString('en-US', { month: 'short' })
    const day = now.getDate()
    set(state => ({
      overrides: {
        ...state.overrides,
        [id]: { ...state.overrides[id], archived: true },
      },
      archived: [
        { id, title, channelName, archivedAt: `${month} ${day}` },
        ...state.archived,
      ],
    }))
  },

  restoreSession(id) {
    set(state => ({
      overrides: {
        ...state.overrides,
        [id]: { ...state.overrides[id], archived: false },
      },
      archived: state.archived.filter(a => a.id !== id),
      removedStaticIds: new Set([...state.removedStaticIds, id]),
    }))
  },

  deleteArchived(id) {
    set(state => ({
      archived: state.archived.filter(a => a.id !== id),
      removedStaticIds: new Set([...state.removedStaticIds, id]),
    }))
  },

  deleteAllArchived(staticIds?: string[]) {
    set(state => ({
      archived: [],
      removedStaticIds: new Set([
        ...state.removedStaticIds,
        ...state.archived.map(a => a.id),
        ...(staticIds ?? []),
      ]),
    }))
  },

  createFolder(channelId, name) {
    const id = `f-new-${++_folderSeq}`
    set(state => ({
      newFolders: [...state.newFolders, { id, channelId, name }],
    }))
    return id
  },
}))
