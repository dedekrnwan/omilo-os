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
  // ── sweep/control ──
  accountInfo,
  auditEvents,
  companyDetail,
  creditPacks,
  dataExports,
  invites,
  invoices,
  ledgerEntries,
  managedChannels,
  mcpServers,
  payments,
  seatSummary,
  signInSessions,
  storageSummary,
  telemetryState,
  userPreferences,
} from './fixtures'
// ── sweep/docs ──
import { mockDocsRepos } from './docsMock'
// ── sweep/goals-routines ──
import { mockGoalDetail, mockRunDetail, mockSchedule, mockSuggestions } from './routinesMock'
// ── sweep/inbox-flows ──
import { mockFlowSuggestions, mockFlowVersions, mockProposals, withFlowExtras } from './sweepInboxFlows'
import * as chatMock from './chatMock' // sweep/chat
import type { AuditQuery } from '../../core/domain/controlPanel'

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
      get: (id: Id) => Promise.resolve(sessions.find(s => s.id === id) ?? chatMock.findSession(id) ?? null), // sweep/chat: + archived / Chief
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
      list: () => Promise.resolve(flows.map(withFlowExtras)),
      get: (id: Id) => {
        const f = flows.find(x => x.id === id)
        return Promise.resolve(f ? withFlowExtras(f) : null)
      },
      runs: (id: Id) => Promise.resolve(flowRuns.filter(r => r.flowId === id)),
      // ── sweep/inbox-flows ──
      run: (id: Id, runId: Id) => Promise.resolve(flowRuns.find(r => r.flowId === id && r.id === runId) ?? null),
      versions: (id: Id) => Promise.resolve([...(mockFlowVersions[id] ?? [])]),
      suggestions: () => {
        const titles = new Set(flows.map(f => f.title.toLowerCase()))
        return Promise.resolve(mockFlowSuggestions.filter(s => !titles.has(s.draft.title.toLowerCase())))
      },
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
      // ── sweep/team-analytics ──
      overviewFor: (_range: string, _channelId?: string) => Promise.resolve(sweepMockOverview()),
      helpersFor: (_range: string, channelId?: string) => Promise.resolve(sweepMockHelperStats(channelId)),
      spendByChannel: () => Promise.resolve(mockSpendByChannel),
      tokensByHelper: () => Promise.resolve(mockTokensByHelper),
      loops: () => Promise.resolve(mockLoops.map((l) => ({ ...l }))),
      reliability: () => Promise.resolve(mockReliability),
      failures: () => Promise.resolve(mockFailures.map((f) => ({ ...f }))),
      activity: (q: ActivityQuery) => Promise.resolve(sweepMockActivity(q)),
    },

    skills: {
      list: () => Promise.resolve([...skills]),
      get: (id: Id) => Promise.resolve(skills.find(s => s.id === id) ?? null),
    },

    helpers: {
      list: () => Promise.resolve([...helpers]),
      get: (id: Id) => Promise.resolve(helpers.find(h => h.id === id) ?? null),
      // ── sweep/team-analytics ──
      detail: (id: Id) => Promise.resolve(sweepMockHelperDetail(id)),
      channels: (id: Id) => Promise.resolve([...(mockHelperChannels[id] ?? [])]),
      tools: (id: Id) => Promise.resolve(mockToolsFor(id)),
      skillRows: (id: Id) => Promise.resolve(sweepMockSkillRows(id)),
      files: (id: Id) => Promise.resolve(mockFilesFor(id, helpers.find((h) => h.id === id)?.name ?? 'Helper')),
    },

    members: {
      list: () => Promise.resolve([...members]),
    },

    // ── sweep/docs ──
    docs: mockDocsRepos.docs,
    lessons: mockDocsRepos.lessons,
    handbook: mockDocsRepos.handbook,

    // ── sweep/inbox-flows ──
    proposals: {
      get: (id: Id) => {
        const p = mockProposals[id]
        return Promise.resolve(p ? { ...p } : null)
      },
    },

    // ── sweep/chat ──
    chat: {
      archived: (areaId: Id | null) =>
        Promise.resolve(chatMock.archivedSessions.filter((s) => !areaId || s.channelId === areaId)),
      chiefThreads: () => Promise.resolve([...chatMock.chiefThreads]),
      chiefNudges: () => Promise.resolve(chatMock.listChiefNudges()),
      folder: (id: Id) => Promise.resolve(chatMock.folderDetail(id)),
      folderFiles: (id: Id) => Promise.resolve([...(chatMock.folderFiles[id] ?? [])]),
      folderShares: (id: Id) => Promise.resolve({ members: [...(chatMock.folderShares[id] ?? [])] }),
      sessionShares: (id: Id) => Promise.resolve(chatMock.getSessionShares(id)),
      sessionResults: (id: Id) => Promise.resolve(chatMock.getSessionResults(id)),
    },

    // ── sweep/control ──
    controlPanel: {
      company: () => Promise.resolve({ ...companyDetail }),
      seats: () => {
        const used = members.filter((m) => m.role !== 'viewer').length
        const pending = invites.filter((i) => i.role !== 'viewer').length
        const total = seatSummary.total ?? 0
        return Promise.resolve({
          ...seatSummary,
          used,
          pending,
          viewers: members.length - used,
          available: Math.max(0, total - used - pending),
        })
      },
      packs: () => Promise.resolve([...creditPacks]),
      invoices: () => Promise.resolve([...invoices]),
      ledger: () => Promise.resolve([...ledgerEntries]),
      payment: (id: string) => Promise.resolve(payments.find((p) => p.id === id) ?? null),
      invites: () => Promise.resolve([...invites]),
      channels: () => Promise.resolve(managedChannels.map((c) => ({ ...c }))),
      audit: (q?: AuditQuery) => {
        let rows = [...auditEvents]
        if (q?.type) {
          const types = q.type.split(',')
          rows = rows.filter((e) => types.includes(e.type))
        }
        if (q?.actor) rows = rows.filter((e) => e.actorType === q.actor)
        return Promise.resolve({ events: rows, nextCursor: null })
      },
      storage: () => Promise.resolve({ ...storageSummary }),
      exports: () => Promise.resolve([...dataExports]),
      account: () => Promise.resolve({ ...accountInfo }),
      preferences: () => Promise.resolve(JSON.parse(JSON.stringify(userPreferences)) as typeof userPreferences),
      sessions: () => Promise.resolve([...signInSessions]),
      mcpServers: () => Promise.resolve([...mcpServers]),
      telemetryOptedOut: () => Promise.resolve(telemetryState.optedOut),
    },
  }
}

// ── sweep/team-analytics ──

import type {
  ActivityPage,
  AnalyticsOverview,
  HelperDetail,
  HelperSkillRow,
  HelperStat,
} from '../../core/domain/types'
import type { ActivityQuery } from '../../core/ports/repos'
import {
  mockActivity,
  mockAnalyticsBuckets,
  mockFailures,
  mockFilesFor,
  mockHelperChannels,
  mockHelperSkillSettings,
  mockJobsSeries,
  mockLoops,
  mockReliability,
  mockSpendByChannel,
  mockTokensByHelper,
  mockToolsFor,
  routines as sweepRoutines,
} from './fixtures'

function sweepMockOverview(): AnalyticsOverview {
  const labels = mockAnalyticsBuckets.map((b) => b.start)
  return {
    stats: [
      { label: 'Jobs done', value: 128, prev: 114 },
      { label: 'Success rate', value: 96, prev: 94, note: '%', failed: 4 },
      { label: 'Tokens', value: 284_000, prev: 241_000, perJob: 2_100 },
      { label: 'Tokens per job', value: 2_100, prev: 2_300, note: 'tokens' },
    ],
    series: [
      ...analyticsOverview.series,
      { label: 'Done', values: mockJobsSeries.done, labels },
      { label: 'Failed', values: mockJobsSeries.failed, labels },
    ],
    buckets: mockAnalyticsBuckets,
  }
}

function sweepMockHelperStats(channelId?: string): HelperStat[] {
  const live = helpers.filter((h) => h.status !== 'retired')
  return analyticsHelpers
    .filter((s) => live.some((h) => h.id === s.helperId))
    .filter((s) => !channelId || channelId === 'ch-general' || s.helperId !== 'h-growth' || channelId === 'ch-marketing')
    .map((s) => {
      const h = live.find((x) => x.id === s.helperId)!
      const limit = h.budgetTokensMonth ?? null
      const spent = h.tokensMonth ?? 0
      const cur = h.currentJob
      return {
        ...s,
        name: h.name,
        area: h.area,
        role: h.title ?? h.role ?? '',
        isChief: h.isChief,
        status: h.status === 'paused' ? 'paused' : cur ? (cur.status === 'waiting' ? 'needs' : 'working') : 'idle',
        doing: cur ? cur.brief : h.nextRoutine ? `Next: ${h.nextRoutine.name}` : '',
        lastActive: h.lastActive ?? null,
        budget: limit != null ? { spent, limit } : null,
        budgetReached: limit != null && spent >= limit && !(h.budgetAllowJobs ?? 0),
      }
    })
}

function sweepMockSkillRows(helperId: string): HelperSkillRow[] {
  const settings = (mockHelperSkillSettings[helperId] ??= {})
  return skills
    .filter((s) => s.helperId === helperId || s.id in settings)
    .map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      status: s.status,
      own: s.helperId === helperId,
      description: '',
      enabled: settings[s.id]?.enabled ?? true,
      permission: settings[s.id]?.permission ?? (s.helperId === helperId ? 'always' : 'ask'),
    }))
}

function sweepMockHelperDetail(id: string): HelperDetail | null {
  const helper = helpers.find((h) => h.id === id)
  if (!helper) return null
  const rs = sweepRoutines.filter((r) => r.helperId === id)
  const rows = sweepMockSkillRows(id)
  const tools = mockToolsFor(id)
  return {
    helper,
    routines: rs.map((r) => ({
      id: r.id, name: r.name, freq: r.freq, at: r.at, days: r.days, paused: r.paused,
      enabled: r.enabled, nextAt: r.nextAt, managedByChief: r.managedByChief,
    })),
    skills: rows,
    counts: {
      channels: (mockHelperChannels[id]?.length ?? 0) + 1,
      tools: tools.connectors.filter((t) => t.on).length + tools.builtins.filter((t) => t.on).length,
      skills: rows.filter((r) => r.enabled).length,
      routines: rs.length,
    },
  }
}

function sweepMockActivity(q: ActivityQuery): ActivityPage {
  const limit = q.limit ?? 30
  const items = mockActivity
    .filter((a) => !q.kinds || q.kinds.includes(a.kind))
    .filter((a) => !q.helperIds || q.helperIds.includes(a.helperId))
    .filter((a) => !q.cursor || a.at < q.cursor)
  const page = items.slice(0, limit)
  return {
    items: page,
    nextCursor: items.length > limit ? page[page.length - 1].at : null,
    counts: {
      done: mockActivity.filter((a) => a.kind === 'done').length,
      needs_you: mockActivity.filter((a) => a.kind === 'needs_you').length,
      failed: mockActivity.filter((a) => a.kind === 'failed').length,
      started: mockActivity.length,
    },
  }
}
