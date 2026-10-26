import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Mode = 'chat' | 'office'

/** How much helpers may do on their own, workspace-wide. */
export type Autonomy = 'strict' | 'ask' | 'yolo'

/**
 * Home route of each mode. Mode is NOT encoded in the URL — it's persisted
 * client state. This map is only consulted when a mode change wants to land
 * on that mode's primary surface (the Rail toggle, company switch).
 */
export const MODE_HOME: Record<Mode, string> = { chat: '/chat', office: '/inbox' }

export interface UIState {
  /** Current view mode — persisted, never derived from the URL. */
  mode: Mode
  companyId: string
  /** Selected Area filter (a channel id), or null for "All areas". Shared across both modes. */
  areaId: string | null
  /** Workspace-wide autonomy level for every helper. */
  autonomy: Autonomy
  /** User opted into desktop / browser push. The OS permission is the real gate. */
  pushEnabled: boolean
  setMode(mode: Mode): void
  setCompany(id: string): void
  setArea(id: string | null): void
  setAutonomy(level: Autonomy): void
  setPushEnabled(on: boolean): void
}

/**
 * UI store. `mode`, `companyId` and `areaId` persist to localStorage so a
 * reload keeps your view mode and filters without putting any of it in the URL
 * (every route is mode-neutral).
 */
export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      mode: 'chat',
      companyId: 'sahabat-warga',
      areaId: null,
      autonomy: 'ask',
      pushEnabled: false,

      setMode(mode: Mode) {
        if (get().mode !== mode) set({ mode })
      },
      setCompany(id: string) {
        if (get().companyId !== id) set({ companyId: id })
      },
      setArea(id: string | null) {
        if (get().areaId !== id) set({ areaId: id })
      },
      setAutonomy(level: Autonomy) {
        if (get().autonomy !== level) set({ autonomy: level })
      },
      setPushEnabled(on: boolean) {
        if (get().pushEnabled !== on) set({ pushEnabled: on })
      },
    }),
    {
      name: 'omilo-ui',
      partialize: (s) => ({ mode: s.mode, companyId: s.companyId, areaId: s.areaId, autonomy: s.autonomy, pushEnabled: s.pushEnabled }),
    },
  ),
)

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
  /** Deleted from the sidebar (mock: hidden everywhere) */
  deleted?: boolean
}

export interface FolderOverride {
  name?: string
  deleted?: boolean
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
  /** Renamed / deleted folders */
  folderOverrides: Record<string, FolderOverride>

  patchFolder(id: string, patch: Partial<FolderOverride>): void
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
  folderOverrides: {},

  patchFolder(id, patch) {
    set((state) => ({ folderOverrides: { ...state.folderOverrides, [id]: { ...state.folderOverrides[id], ...patch } } }))
  },

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
