import type { Id } from '../../core/domain/types'
import type { Repos } from '../../core/ports/repos'
import {
  billingPlans,
  billingSubscription,
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
  kbItems,
  analyticsOverview,
  analyticsHelpers,
  skills,
  helpers,
  members,
} from './fixtures'
// ── sweep/docs ──
import { mockDocsRepos } from './docsMock'
// ── sweep/goals-routines ──
import { mockGoalDetail, mockRunDetail, mockSchedule, mockSuggestions } from './routinesMock'

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
      // ── sweep/goals-routines ──
      get: (id: Id) => Promise.resolve(mockGoalDetail(id)),
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

    billingPlans: {
      list: () => Promise.resolve([...billingPlans]),
    },

    billingSubscription: {
      get: () => Promise.resolve({ ...billingSubscription }),
    },

    usage: {
      get: () => Promise.resolve({ ...usageSummary }),
    },

    wallet: {
      get: () => Promise.resolve({ ...walletSettings }),
    },

    aiAccounts: {
      list: () => Promise.resolve([...aiAccounts]),
      detect: () =>
        Promise.resolve([
          { id: 'claude-code', name: 'Claude Code', installed: true, signedIn: true, detail: '/usr/local/bin/claude' },
          { id: 'opencode', name: 'OpenCode', installed: true, signedIn: true, detail: '/usr/local/bin/opencode' },
          { id: 'codex', name: 'Codex', installed: true, signedIn: false, detail: '~/.codex' },
          { id: 'copilot', name: 'GitHub Copilot', installed: false, signedIn: false, detail: '' },
          { id: 'gemini-cli', name: 'Gemini CLI', installed: false, signedIn: false, detail: '' },
          { id: 'cursor', name: 'Cursor', installed: false, signedIn: false, detail: '' },
        ]),
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
      // ── sweep/goals-routines ──
      schedule: (from: string, to: string) => Promise.resolve(mockSchedule(from, to)),
      run: (routineId: Id, runId: Id) => Promise.resolve(mockRunDetail(routineId, runId)),
      suggestions: () => Promise.resolve(mockSuggestions()),
    },

    knowledge: {
      sources: () => mockDocsRepos.sources(),
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

    members: {
      list: () => Promise.resolve([...members]),
    },

    // ── sweep/docs ──
    docs: mockDocsRepos.docs,
    lessons: mockDocsRepos.lessons,
    handbook: mockDocsRepos.handbook,
  }
}
