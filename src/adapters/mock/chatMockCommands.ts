/**
 * sweep/chat — mock implementations of the chat-workspace commands.
 * Mutates the shared fixture arrays / chatMock state (replacing objects, never
 * mutating them in place) so the next mock repo read reflects the change.
 */
import type { Channel, Folder, FolderFile, Message, Session, Shares } from '../../core/domain/types'
import type {
  AddFolderFileInput,
  Commands,
  CreateFolderInput,
  CreateSessionInput,
  SendMessageOptions,
  SetSharesInput,
  UpdateAreaInput,
  UpdateFolderInput,
  UpdateSessionInput,
} from '../http/commands'
import { channels, folders, goals, members, messages, sessions } from './fixtures'
import {
  archivedSessions,
  chatMockId,
  chiefThreads,
  dismissedNudges,
  folderDetail,
  folderFiles,
  folderInstructions,
  folderShares,
  mockChiefReply,
  sessionShares,
} from './chatMock'

type ChatCommands = Pick<
  Commands,
  | 'updateSession'
  | 'deleteSession'
  | 'deleteArchivedSessions'
  | 'setSessionShares'
  | 'createFolder'
  | 'updateFolder'
  | 'deleteFolder'
  | 'addFolderFile'
  | 'removeFolderFile'
  | 'setFolderShares'
  | 'updateArea'
  | 'dismissChiefNudge'
>

function replaceIn<T extends { id: string }>(arr: T[], id: string, next: T) {
  const i = arr.findIndex((x) => x.id === id)
  if (i >= 0) arr[i] = next
}

function removeFrom<T extends { id: string }>(arr: T[], id: string): T | undefined {
  const i = arr.findIndex((x) => x.id === id)
  if (i < 0) return undefined
  return arr.splice(i, 1)[0]
}

/** Find a session wherever it lives (active, archived, private Chief). */
function locate(id: string): { list: Session[]; session: Session } | null {
  for (const list of [sessions, archivedSessions, chiefThreads]) {
    const session = list.find((s) => s.id === id)
    if (session) return { list, session }
  }
  return null
}

export function chatMockCreateSession(id: string, input: CreateSessionInput): Session {
  const folder = input.folderId ? folders.find((f) => f.id === input.folderId) : undefined
  const goal = input.goalId ? goals.find((g) => g.id === input.goalId) : undefined
  if (input.kind === 'chief_private') {
    const s: Session = { id, kind: 'chief_private', title: input.title ?? 'New chat', updated: 'now', ...(input.model ? { model: input.model } : {}) }
    chiefThreads.unshift(s)
    return s
  }
  const s: Session = {
    id,
    title: input.title ?? 'New chat',
    channelId: input.channelId ?? folder?.channelId,
    updated: 'now',
    ...(folder ? { folderId: folder.id } : {}),
    ...(goal ? { goalId: goal.id, goal: goal.title } : {}),
    ...(input.model ? { model: input.model } : {}),
  }
  sessions.unshift(s)
  return s
}

export function chatMockRecordSend(message: Message, opts?: SendMessageOptions) {
  messages.push(message)
  const found = locate(message.sessionId)
  if (found && opts?.model) replaceIn(found.list, found.session.id, { ...found.session, model: opts.model })
  if (found?.session.kind === 'chief_private') {
    messages.push(mockChiefReply(message.sessionId, message.content))
    replaceIn(found.list, found.session.id, { ...found.session, updated: 'now' })
  }
}

function sharesFrom(input: SetSharesInput, owner?: Shares['members'][number]): Shares {
  const list = input.members
    .map((m) => {
      const mem = members.find((x) => x.userId === m.userId)
      return mem ? { userId: mem.userId, name: mem.name, email: mem.email, permission: m.permission } : null
    })
    .filter(Boolean) as Shares['members']
  return { members: owner ? [owner, ...list.filter((m) => m.userId !== owner.userId)] : list }
}

export function createChatMockCommands(): ChatCommands {
  return {
    updateSession(id: string, input: UpdateSessionInput): Promise<Session> {
      const found = locate(id)
      if (!found) return Promise.reject(new Error('Not found'))
      let next: Session = { ...found.session }
      if (input.title !== undefined) next.title = input.title
      if (input.folderId !== undefined) {
        if (input.folderId === null) delete next.folderId
        else next.folderId = input.folderId
      }
      if (input.pinned !== undefined) {
        if (input.pinned) next.pinned = true
        else delete next.pinned
      }
      if (input.goalId !== undefined) {
        const goal = input.goalId ? goals.find((g) => g.id === input.goalId) : undefined
        if (goal) next = { ...next, goalId: goal.id, goal: goal.title }
        else {
          delete next.goalId
          delete next.goal
        }
      }
      if (input.model !== undefined) next.model = input.model
      if (input.archived === true && found.list === sessions) {
        removeFrom(sessions, id)
        next.archivedAt = new Date().toISOString()
        archivedSessions.unshift(next)
      } else if (input.archived === false && found.list === archivedSessions) {
        removeFrom(archivedSessions, id)
        delete next.archivedAt
        sessions.unshift(next)
      } else {
        replaceIn(found.list, id, next)
      }
      return Promise.resolve(next)
    },

    deleteSession(id: string): Promise<void> {
      const found = locate(id)
      if (found) removeFrom(found.list, id)
      return Promise.resolve()
    },

    deleteArchivedSessions(channelId?: string): Promise<{ deleted: number }> {
      const doomed = archivedSessions.filter((s) => !channelId || s.channelId === channelId)
      for (const s of doomed) removeFrom(archivedSessions, s.id)
      return Promise.resolve({ deleted: doomed.length })
    },

    setSessionShares(id: string, input: SetSharesInput): Promise<Shares> {
      const owner = members[0] ? { userId: members[0].userId, name: members[0].name, email: members[0].email, permission: 'owner' as const } : undefined
      const shares = { ...sharesFrom(input, owner), generalAccess: input.generalAccess ?? sessionShares[id]?.generalAccess ?? 'restricted' }
      sessionShares[id] = shares
      return Promise.resolve(shares)
    },

    createFolder(input: CreateFolderInput): Promise<Folder> {
      const folder: Folder = {
        id: chatMockId('f'),
        channelId: input.channelId,
        name: input.name,
        count: 0,
        ...(input.icon ? { icon: input.icon } : {}),
        ...(input.color ? { color: input.color } : {}),
      }
      folders.push(folder)
      return Promise.resolve(folder)
    },

    updateFolder(id: string, input: UpdateFolderInput): Promise<Folder> {
      const f = folders.find((x) => x.id === id)
      if (!f) return Promise.reject(new Error('Not found'))
      const next: Folder = { ...f }
      if (input.name !== undefined) next.name = input.name
      if (input.icon !== undefined) {
        if (input.icon) next.icon = input.icon
        else delete next.icon
      }
      if (input.color !== undefined) {
        if (input.color) next.color = input.color
        else delete next.color
      }
      if (input.instructions !== undefined) folderInstructions[id] = input.instructions
      replaceIn(folders, id, next)
      return Promise.resolve(folderDetail(id) ?? next)
    },

    deleteFolder(id: string): Promise<void> {
      removeFrom(folders, id)
      for (const s of [...sessions]) {
        if (s.folderId === id) {
          const next = { ...s }
          delete next.folderId
          replaceIn(sessions, s.id, next)
        }
      }
      return Promise.resolve()
    },

    addFolderFile(folderId: string, input: AddFolderFileInput): Promise<FolderFile> {
      const file: FolderFile = {
        id: chatMockId('ff'),
        folderId,
        name: input.name,
        size: input.size ?? 0,
        mime: input.mime ?? null,
        hasText: Boolean(input.text),
        createdAt: new Date().toISOString(),
      }
      folderFiles[folderId] = [...(folderFiles[folderId] ?? []), file]
      return Promise.resolve(file)
    },

    removeFolderFile(folderId: string, fileId: string): Promise<void> {
      folderFiles[folderId] = (folderFiles[folderId] ?? []).filter((f) => f.id !== fileId)
      return Promise.resolve()
    },

    setFolderShares(id: string, input: SetSharesInput): Promise<Shares> {
      const shares = sharesFrom(input)
      folderShares[id] = shares.members
      return Promise.resolve(shares)
    },

    updateArea(id: string, input: UpdateAreaInput): Promise<Channel> {
      const c = channels.find((x) => x.id === id)
      if (!c) return Promise.reject(new Error('Not found'))
      const next: Channel = { ...c }
      if (input.name !== undefined) next.name = input.name
      if (input.purpose !== undefined) next.purpose = input.purpose
      if (input.icon !== undefined) {
        if (input.icon) next.icon = input.icon
        else delete next.icon
      }
      if (input.color !== undefined) {
        if (input.color) next.color = input.color
        else delete next.color
      }
      replaceIn(channels, id, next)
      return Promise.resolve(next)
    },

    dismissChiefNudge(id: string, snoozeUntil?: string): Promise<void> {
      dismissedNudges.set(id, snoozeUntil ? Date.parse(snoozeUntil) : null)
      return Promise.resolve()
    },
  }
}
