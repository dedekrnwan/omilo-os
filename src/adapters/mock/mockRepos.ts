import type { Id } from '../../core/domain/types'
import type { Repos } from '../../core/ports/repos'
import { channels, sessions, messages, inboxItems } from './fixtures'

export function createMockRepos(): Repos {
  return {
    channels: {
      list: () => Promise.resolve([...channels]),
      get: (id: Id) => Promise.resolve(channels.find(c => c.id === id) ?? null),
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
