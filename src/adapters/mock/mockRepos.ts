import type { Id } from '../../core/domain/types'
import type { Repos } from '../../core/ports/repos'
import {
  channels,
  folders,
  goals,
  sessions,
  messages,
  inboxItems,
  usageSummary,
  walletSettings,
  aiAccounts,
  pieces,
  connectors,
  mcpTokens,
  flows,
  flowRuns,
  routines,
  kbSources,
  kbItems,
  analyticsOverview,
  analyticsHelpers,
  skills,
  helpers,
} from './fixtures'

export function createMockRepos(): Repos {
  return {
    channels: {
      list: () => Promise.resolve([...channels]),
      get: (id: Id) => Promise.resolve(channels.find(c => c.id === id) ?? null),
    },

    folders: {
      listByChannel: (channelId: Id) =>
        Promise.resolve(folders.filter(f => f.channelId === channelId)),
      listAll: () => Promise.resolve([...folders]),
    },

    goals: {
      listByChannel: (channelId: Id) =>
        Promise.resolve(goals.filter(g => g.channelId === channelId)),
      listAll: () => Promise.resolve([...goals]),
    },

    sessions: {
      get: (id: Id) => Promise.resolve(sessions.find(s => s.id === id) ?? null),
      listByChannel: (channelId: Id) =>
        Promise.resolve(sessions.filter(s => s.channelId === channelId)),
      listAll: () => Promise.resolve([...sessions]),
    },

    messages: {
      listBySession: (sessionId: Id) =>
        Promise.resolve(messages.filter(m => m.sessionId === sessionId)),
    },

    inbox: {
      list: () => Promise.resolve([...inboxItems]),
      get: (id: Id) => Promise.resolve(inboxItems.find(i => i.id === id) ?? null),
    },

    usage: {
      get: () => Promise.resolve({ ...usageSummary }),
    },

    wallet: {
      get: () => Promise.resolve({ ...walletSettings }),
    },

    aiAccounts: {
      list: () => Promise.resolve([...aiAccounts]),
    },

    marketplace: {
      list: (params?: { category?: string; q?: string }) => {
        let result = [...pieces]
        if (params?.category) {
          const cat = params.category.toLowerCase()
          result = result.filter(p => p.category.toLowerCase() === cat)
        }
        if (params?.q) {
          const q = params.q.toLowerCase()
          result = result.filter(
            p => p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
          )
        }
        return Promise.resolve(result)
      },
    },

    connectors: {
      list: () => Promise.resolve([...connectors]),
    },

    mcpTokens: {
      list: () => Promise.resolve([...mcpTokens]),
    },

    flows: {
      list: () => Promise.resolve([...flows]),
      get: (id: Id) => Promise.resolve(flows.find(f => f.id === id) ?? null),
      runs: (id: Id) => Promise.resolve(flowRuns.filter(r => r.flowId === id)),
    },

    routines: {
      list: () => Promise.resolve([...routines]),
      get: (id: Id) => Promise.resolve(routines.find(r => r.id === id) ?? null),
    },

    knowledge: {
      sources: () => Promise.resolve([...kbSources]),
      list: (params?: { q?: string }) => {
        if (!params?.q) return Promise.resolve([...kbItems])
        const q = params.q.toLowerCase()
        return Promise.resolve(
          kbItems.filter(
            i => i.heading.toLowerCase().includes(q) || i.text.toLowerCase().includes(q),
          ),
        )
      },
    },

    analytics: {
      overview: (_range?: string) => Promise.resolve({ ...analyticsOverview }),
      helpers: (_range?: string) => Promise.resolve([...analyticsHelpers]),
    },

    skills: {
      list: () => Promise.resolve([...skills]),
      get: (id: Id) => Promise.resolve(skills.find(s => s.id === id) ?? null),
    },

    helpers: {
      list: () => Promise.resolve([...helpers]),
      get: (id: Id) => Promise.resolve(helpers.find(h => h.id === id) ?? null),
    },
  }
}
