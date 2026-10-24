import type { Id } from '../../core/domain/types'
import type { Repos } from '../../core/ports/repos'
import { channels, folders, goals, sessions, messages, inboxItems } from './fixtures'

export function createMockRepos(): Repos {
  return {
    channels: {
      list: () => Promise.resolve([...channels]),
      get: (id: Id) => Promise.resolve(channels.find(c => c.id === id) ?? null),
    },

    folders: {
      listByChannel: (channelId: Id) =>
        Promise.resolve(folders.filter(f => f.channelId === channelId)),
    },

    goals: {
      listByChannel: (channelId: Id) =>
        Promise.resolve(goals.filter(g => g.channelId === channelId)),
    },

    sessions: {
      get: (id: Id) => Promise.resolve(sessions.find(s => s.id === id) ?? null),
      listByChannel: (channelId: Id) =>
        Promise.resolve(sessions.filter(s => s.channelId === channelId)),
    },

    messages: {
      listBySession: (sessionId: Id) =>
        Promise.resolve(messages.filter(m => m.sessionId === sessionId)),
    },

    inbox: {
      list: () => Promise.resolve([...inboxItems]),
      get: (id: Id) => Promise.resolve(inboxItems.find(i => i.id === id) ?? null),
    },
  }
}
