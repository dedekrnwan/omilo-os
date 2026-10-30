/**
 * Mock Commands client for offline / default mode (VITE_USE_HTTP !== '1').
 *
 * Mirrors the HTTP `Commands` port one-for-one so every wired CTA still works
 * offline (Review Focus #1 — mock-mode parity). Each mutation mutates the
 * in-memory fixture arrays and resolves with a plausibly-shaped object.
 *
 * These fixtures are module-level singletons shared with createMockRepos, so a
 * create/delete here is reflected by the next repos.list() read.
 */

import type {
  AiAccount,
  Channel,
  Company,
  CompanyMember,
  CompanySettings,
  Connector,
  Flow,
  Goal,
  Helper,
  McpToken,
  MemoryDoc,
  Message,
  Routine,
  Session,
  WalletSettings,
} from '../../core/domain/types'
import type {
  Commands,
  CreateAiAccountInput,
  CreateAreaInput,
  CreateDocInput,
  CreateFlowInput,
  CreateGoalInput,
  CreateHelperInput,
  CreateRoutineInput,
  CreateSessionInput,
  InviteMemberInput,
  MintMcpTokenInput,
  UpdateCompanyProfileInput,
  UpdateFlowInput,
  UpdateGoalInput,
  UpdateHelperInput,
  UpdateMeInput,
  UpdateRoutineInput,
  UpdateWalletInput,
} from '../http/commands'
import type { SendMessageOptions } from '../http/commands' // sweep/chat
import { chatMockCreateSession, chatMockRecordSend, createChatMockCommands } from './chatMockCommands' // sweep/chat
import type { MeResult } from '../../core/domain/session'
// ── sweep/docs ──
import { mockDocsCommands } from './docsMock'
import {
  aiAccounts,
  channels,
  connectors,
  flows,
  goals,
  helpers,
  mcpTokens,
  members,
  routines,
  walletSettings,
  // ── sweep/control ──
  accountInfo,
  auditEvents,
  companyDetail,
  dataExports,
  invites,
  managedChannels,
  mcpServers,
  seatSummary,
  signInSessions,
  skills,
  telemetryState,
  userPreferences,
} from './fixtures'
// ── sweep/goals-routines ──
import type { PreviewRoutineInput } from '../http/commands'
import {
  dismissed,
  mockGoalSession,
  mockPreview,
  mockRecompute,
  mockRunNow,
  mockRuns,
  mockSkip,
  mockSuggestions,
} from './routinesMock'
// ── sweep/inbox-flows ──
import type { FlowRun } from '../../core/domain/types'
import type { UpdateProposalInput } from '../http/commands'
import { flowRuns, inboxItems } from './fixtures'
import {
  applyMockFlowPublish,
  graphAt,
  mockDecide,
  mockMarkAllRead,
  mockMarkRead,
  mockPublishProposal,
  mockRun,
  mockSnapshot,
  mockUndo,
  mockUpdateProposal,
  rememberGraph,
} from './sweepInboxFlows'
import type { Skill } from '../../core/domain/types'
import type {
  AuditQuery,
  CompanyDetail,
  DataExport,
  ManagedChannel,
  McpServer,
  UserPreferences,
} from '../../core/domain/controlPanel'
import type {
  BuySeatsResult,
  CreateMcpServerFromOpenApiInput,
  CreateMcpServerInput,
  CreateSkillInput,
  UpdateAiAccountInput,
  UpdateChannelInput,
  UpdateMemberInput,
  UpdateSkillInput,
} from '../http/commands'

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-mock-${seq}`
}

/** Shared mutable mock company settings (deep-merged by updateCompanySettings). */
const mockCompanySettings: CompanySettings = {
  safety: {},
  notifications: {},
  aiEngine: {},
  knowledge: {},
}

/** Shallow-ish deep merge used by the mock PATCH /v1/company/settings. */
function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target }
  for (const [k, v] of Object.entries(patch)) {
    const existing = out[k]
    if (
      v && typeof v === 'object' && !Array.isArray(v) &&
      existing && typeof existing === 'object' && !Array.isArray(existing)
    ) {
      out[k] = deepMerge(existing as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

export function createMockCommands(): Commands {
  return {
    // ── P1 session + proposal commands ──────────────────────────────────────────
    createSession(input: CreateSessionInput): Promise<Session> {
      return Promise.resolve(chatMockCreateSession(nextId('ses'), input))
    },
    sendMessage(sessionId: string, content: string, opts?: SendMessageOptions): Promise<{ message: Message; jobId: string }> {
      const message: Message = {
        id: nextId('msg'),
        sessionId,
        author: { kind: 'you', name: 'You' },
        content,
        createdAt: new Date().toISOString(),
      }
      chatMockRecordSend(message, opts)
      return Promise.resolve({ message, jobId: nextId('job') })
    },
    approveProposal(proposalId: string, _note?: string): Promise<{ executionJobId: string }> {
      mockDecide(proposalId, 'done') // sweep/inbox-flows
      applyMockFlowPublish(proposalId, true)
      return Promise.resolve({ executionJobId: nextId('ejob') })
    },
    rejectProposal(proposalId: string, _note: string): Promise<void> {
      mockDecide(proposalId, 'rejected') // sweep/inbox-flows
      return Promise.resolve()
    },
    requestChanges(proposalId: string, _note: string): Promise<void> {
      mockDecide(proposalId, 'changes_requested') // sweep/inbox-flows
      return Promise.resolve()
    },

    // ── P5d MCP token commands ────────────────────────────────────────────────────
    mintMcpToken(input: MintMcpTokenInput): Promise<McpToken & { token: string }> {
      const token: McpToken & { token: string } = {
        id: nextId('mct'),
        label: input.label,
        helperId: input.helperId,
        scopes: input.scopes,
        token: `mock-token-${seq}`,
        expiresAt: input.expiresAt ?? null,
        active: true,
      }
      mcpTokens.push({ ...token, token: undefined } as unknown as McpToken)
      return Promise.resolve(token)
    },
    revokeMcpToken(id: string): Promise<void> {
      const i = mcpTokens.findIndex(t => t.id === id)
      if (i >= 0) mcpTokens.splice(i, 1)
      return Promise.resolve()
    },

    // ── P5d Connector commands ──────────────────────────────────────────────────────
    installConnector(pieceId: string): Promise<Connector> {
      const connector: Connector = {
        id: nextId('con'),
        pieceId,
        label: pieceId,
        source: 'marketplace',
        status: 'needs_auth',
        enabled: false,
      }
      connectors.push(connector)
      return Promise.resolve(connector)
    },
    updateConnector(id: string, p: { enabled?: boolean }): Promise<Connector> {
      const c = connectors.find(x => x.id === id)
      if (c && p.enabled !== undefined) c.enabled = p.enabled
      return Promise.resolve(c ?? { id, pieceId: '', label: '', source: 'marketplace', status: 'error', enabled: false })
    },
    connectorCredentials(id: string, _fields: Record<string, string>): Promise<Connector> {
      const c = connectors.find(x => x.id === id)
      if (c) c.status = 'connected'
      return Promise.resolve(c ?? { id, pieceId: '', label: '', source: 'marketplace', status: 'connected', enabled: true })
    },
    disconnectConnector(id: string): Promise<void> {
      const i = connectors.findIndex(c => c.id === id)
      if (i >= 0) connectors.splice(i, 1)
      return Promise.resolve()
    },

    // ── P5d Area (Channel) commands ──────────────────────────────────────────────────
    createArea(input: CreateAreaInput): Promise<Channel> {
      const channel: Channel = {
        id: nextId('ch'),
        name: input.name,
        accent: (['dev', 'marketing', 'sales'].includes(input.color) ? input.color : 'general') as Channel['accent'], // sweep/chat
        ...(input.colorHex ? { color: input.colorHex } : {}),
        agentCount: 0,
        chatCount: 0,
        openItems: 0,
        icon: input.icon,
        purpose: input.purpose,
        contextScope: input.contextScope,
      }
      channels.push(channel)
      return Promise.resolve(channel)
    },

    // ── P5d Wallet + Billing commands ──────────────────────────────────────────────
    updateWallet(input: UpdateWalletInput): Promise<WalletSettings> {
      walletSettings.autoTopupEnabled = input.autoTopupEnabled
      walletSettings.autoTopupThresholdCredits = input.autoTopupThresholdCredits
      walletSettings.autoTopupPack = input.autoTopupPack ?? null
      return Promise.resolve({ ...walletSettings })
    },
    topup(pack: string): Promise<unknown> {
      return Promise.resolve({ pack, balance: 1000, hosted_url: null })
    },
    changePlan(planId: string, interval: 'monthly' | 'yearly'): Promise<unknown> {
      return Promise.resolve({ subscription: { planId, interval }, hosted_url: null })
    },

    // ── P5d Company profile command ──────────────────────────────────────────────────
    updateCompanyProfile(input: UpdateCompanyProfileInput): Promise<Company> {
      const company: Company = {
        id: 'cmp-mock',
        name: input.name ?? 'Mock Co',
        color: '',
        industry: input.industry,
        teamSize: input.teamSize,
        region: input.region,
        currency: input.currency,
        picRole: input.picRole,
        timezone: input.timezone,
        autonomyDefault: input.autonomyDefault,
      }
      return Promise.resolve(company)
    },

    // ── User profile command ──────────────────────────────────────────────────────────
    updateMe(input: UpdateMeInput): Promise<MeResult> {
      const company = { id: 'cmp-mock', name: 'Mock Co', currency: 'IDR' }
      return Promise.resolve({
        user: { id: 'usr-mock', email: 'demo@omilo.app', name: input.name ?? 'Demo' },
        role: 'owner',
        company,
        companies: [company],
      })
    },

    // ── P13 AI account commands ──────────────────────────────────────────────────────
    createAiAccount(input: CreateAiAccountInput): Promise<AiAccount> {
      const account: AiAccount = {
        id: nextId('acc'),
        harness: input.harness,
        name: input.name,
        tag: input.tag ?? null,
        status: 'ready',
        pctWindow: 0,
        tokens: input.tokenHint ?? null,
        lastUsed: null,
      }
      aiAccounts.push(account)
      return Promise.resolve(account)
    },

    // ── P13 onboarding gate command ──────────────────────────────────────────────────
    onboardCompany(): Promise<{ id: string; name: string; onboarded: boolean; [key: string]: unknown }> {
      return Promise.resolve({ id: 'cmp-mock', name: 'Mock Co', onboarded: true })
    },

    // ── P8 flow + routine + goal + skill commands ──────────────────────────────────
    publishFlow(id: string): Promise<unknown> {
      // sweep/inbox-flows: raise a real (mock) flow_publish decision in the inbox
      const f = flows.find(x => x.id === id)
      if (f) return Promise.resolve(mockPublishProposal(f))
      return Promise.resolve({ id: nextId('prp'), type: 'flow_publish', status: 'pending', flowId: id })
    },
    runFlow(id: string): Promise<unknown> {
      const f = flows.find(x => x.id === id) // sweep/inbox-flows
      if (f) return Promise.resolve(mockRun(f, false))
      return Promise.resolve({ id: nextId('frn'), flowId: id, status: 'running' })
    },
    testRunFlow(id: string, _input?: Record<string, unknown>): Promise<unknown> {
      const f = flows.find(x => x.id === id) // sweep/inbox-flows
      if (f) return Promise.resolve(mockRun(f, true))
      return Promise.resolve({ id: nextId('frn'), flowId: id, status: 'done' })
    },
    runRoutineNow(id: string): Promise<{ jobId: string; runId?: string }> {
      const run = mockRunNow(id)
      return Promise.resolve({ jobId: run.jobId ?? nextId('job'), runId: run.id })
    },
    replanGoal(_id: string): Promise<{ jobId: string }> {
      return Promise.resolve({ jobId: nextId('job') })
    },
    publishSkill(id: string): Promise<unknown> {
      return Promise.resolve({ id: nextId('prp'), type: 'skill_publish', status: 'pending', skillId: id })
    },

    // ── P2 Goal commands ────────────────────────────────────────────────────────────
    createGoal(input: CreateGoalInput): Promise<Goal> {
      const goal: Goal = {
        id: nextId('g'),
        channelId: input.channelId,
        title: input.title,
        progress: 0,
        status: 'on_track',
        ...(input.target ? { target: input.target } : {}),
        ...(input.due ? { due: input.due } : {}),
        ...(input.measuredBy ? { measuredBy: input.measuredBy } : {}),
        ...(input.helperIds ? { helperIds: input.helperIds } : {}),
        ...(input.period ? { period: input.period } : {}),
      }
      goals.push(goal)
      return Promise.resolve(goal)
    },
    updateGoal(id: string, input: UpdateGoalInput): Promise<Goal> {
      const g = goals.find(x => x.id === id)
      if (g) {
        if (input.title !== undefined) g.title = input.title
        if (input.channelId !== undefined) g.channelId = input.channelId
        if (input.target !== undefined) g.target = input.target
        if (input.due !== undefined) g.due = input.due
        if (input.measuredBy !== undefined) g.measuredBy = input.measuredBy
        if (input.helperIds !== undefined) g.helperIds = input.helperIds
        if (input.period !== undefined) g.period = input.period
        if (input.status !== undefined) {
          if (input.status === 'auto') { g.statusSetBy = undefined; g.status = 'on_track' }
          else { g.status = input.status as Goal['status']; g.statusSetBy = 'user' }
        }
      }
      return Promise.resolve(g ?? { id, channelId: input.channelId ?? '', title: input.title ?? '', progress: 0 })
    },
    deleteGoal(id: string): Promise<void> {
      const i = goals.findIndex(g => g.id === id)
      if (i >= 0) goals.splice(i, 1)
      return Promise.resolve()
    },

    // ── P2 Routine commands ─────────────────────────────────────────────────────────
    createRoutine(input: CreateRoutineInput): Promise<Routine> {
      const routine: Routine = {
        id: nextId('rtn'),
        companyId: 'cmp-mock',
        helperId: input.helperId,
        name: input.name,
        subtitle: input.subtitle ?? '',
        instructions: input.instructions,
        freq: input.freq,
        at: input.at,
        days: input.days ?? [],
        monthly: input.monthly ?? null,
        timezone: input.timezone ?? 'Asia/Jakarta',
        cron: '',
        sendsTo: input.sendsTo ?? [],
        enabled: true,
        paused: false,
        managedByChief: false,
        nextAt: null,
        lastAt: null,
        goalIds: input.goalIds ?? [],
        createdBy: 'operator',
        allowChiefShift: input.allowChiefShift ?? true,
        skipHolidays: input.skipHolidays ?? false,
        askBeforeSending: input.askBeforeSending ?? false,
        pausedUntil: null,
        runs: [],
      }
      mockRecompute(routine)
      routines.push(routine)
      return Promise.resolve(routine)
    },
    updateRoutine(id: string, input: UpdateRoutineInput): Promise<Routine> {
      const r = routines.find(x => x.id === id)
      if (r) {
        if (input.paused !== undefined) r.paused = input.paused
        if (input.enabled !== undefined) r.enabled = input.enabled
        if (input.instructions !== undefined) r.instructions = input.instructions
        if (input.name !== undefined) r.name = input.name
        if (input.subtitle !== undefined) r.subtitle = input.subtitle
        if (input.helperId !== undefined) r.helperId = input.helperId
        if (input.sendsTo !== undefined) r.sendsTo = input.sendsTo
        if (input.goalIds !== undefined) r.goalIds = input.goalIds
        if (input.freq !== undefined) r.freq = input.freq
        if (input.at !== undefined) r.at = input.at
        if (input.days !== undefined) r.days = input.days
        if (input.monthly !== undefined) r.monthly = input.monthly
        if (input.timezone !== undefined) r.timezone = input.timezone
        if (input.allowChiefShift !== undefined) r.allowChiefShift = input.allowChiefShift
        if (input.skipHolidays !== undefined) r.skipHolidays = input.skipHolidays
        if (input.askBeforeSending !== undefined) r.askBeforeSending = input.askBeforeSending
        if (input.pausedUntil !== undefined) {
          r.pausedUntil = input.pausedUntil || null
          if (input.pausedUntil) r.paused = true
        }
        if (input.paused === false) r.pausedUntil = null
        if (input.freq !== undefined || input.at !== undefined || input.days !== undefined || input.monthly !== undefined) {
          mockRecompute(r)
        }
      }
      return Promise.resolve(r ?? routines[0])
    },
    deleteRoutine(id: string): Promise<void> {
      const i = routines.findIndex(r => r.id === id)
      if (i >= 0) routines.splice(i, 1)
      return Promise.resolve()
    },
    skipRoutineNext(id: string): Promise<{ nextAt: string | null }> {
      return Promise.resolve({ nextAt: mockSkip(id) })
    },

    // ── P2 Flow commands ────────────────────────────────────────────────────────────
    createFlow(input: CreateFlowInput): Promise<Flow> {
      const flow: Flow = {
        id: nextId('flw'),
        title: input.title ?? 'Untitled flow',
        status: 'draft',
        enabled: false,
        count: Array.isArray(input.nodes) ? input.nodes.length : 0,
        areas: input.areas ?? [],
        createdAt: new Date().toISOString(),
        trigger: input.trigger,
        nodes: input.nodes,
        edges: input.edges,
        channelIds: input.channelIds,
        version: 1, // sweep/inbox-flows
      }
      flows.push(flow)
      mockSnapshot(flow, 'First version') // sweep/inbox-flows
      rememberGraph(flow)
      return Promise.resolve(flow)
    },
    updateFlow(id: string, input: UpdateFlowInput): Promise<Flow> {
      const f = flows.find(x => x.id === id)
      if (f) {
        if (input.title !== undefined) f.title = input.title
        if (input.trigger !== undefined) f.trigger = input.trigger
        if (input.nodes !== undefined) { f.nodes = input.nodes; f.count = input.nodes.length; f.version = (f.version ?? 1) + 1 }
        if (input.edges !== undefined) f.edges = input.edges
        if (input.enabled !== undefined) f.enabled = input.enabled
        if (input.areas !== undefined) f.areas = input.areas
        if (input.settings !== undefined) {
          f.settings = deepMerge(
            (f.settings ?? {}) as Record<string, unknown>,
            input.settings,
          )
        }
      }
      return Promise.resolve(f ?? flows[0])
    },
    deleteFlow(id: string): Promise<void> {
      const i = flows.findIndex(f => f.id === id)
      if (i >= 0) flows.splice(i, 1)
      return Promise.resolve()
    },
    duplicateFlow(input: CreateFlowInput): Promise<Flow> {
      const flow: Flow = {
        id: nextId('flw'),
        title: input.title ? `${input.title} (copy)` : 'Untitled flow (copy)',
        status: 'draft',
        enabled: false,
        count: Array.isArray(input.nodes) ? input.nodes.length : 0,
        areas: input.areas ?? [],
        createdAt: new Date().toISOString(),
        trigger: input.trigger,
        nodes: input.nodes,
        edges: input.edges,
        channelIds: input.channelIds,
      }
      flows.push(flow)
      return Promise.resolve(flow)
    },

    // ── P2 Helper commands ──────────────────────────────────────────────────────────
    createHelper(input: CreateHelperInput): Promise<Helper> {
      const helper: Helper = {
        id: nextId('h'),
        name: input.name,
        area: input.area as Helper['area'],
        role: input.role,
        status: 'active',
        isChief: input.isChief ?? false,
        autonomyCap: input.autonomyCap ?? 'review_first',
        jobDescription: input.jobDescription,
        ...sweepCreateHelperExtras(input),
      }
      helpers.push(helper)
      return Promise.resolve(helper)
    },
    updateHelper(id: string, input: UpdateHelperInput): Promise<Helper> {
      const h = helpers.find(x => x.id === id)
      if (h) {
        if (input.status !== undefined) h.status = input.status
        if (input.role !== undefined) h.role = input.role
        if (input.jobDescription !== undefined) h.jobDescription = input.jobDescription
        if (input.autonomyCap !== undefined) h.autonomyCap = input.autonomyCap
        sweepApplyHelperUpdate(h, input)
      }
      return Promise.resolve(h ?? helpers[0])
    },

    // ── P2 Member commands ──────────────────────────────────────────────────────────
    changeMemberRole(id: string, role: string): Promise<CompanyMember> {
      const m = members.find(x => x.id === id)
      if (m) m.role = role
      return Promise.resolve(m ?? { id, userId: '', name: '', email: '', role })
    },
    removeMember(id: string): Promise<void> {
      const i = members.findIndex(m => m.id === id)
      if (i >= 0) members.splice(i, 1)
      return Promise.resolve()
    },
    inviteMember(input: InviteMemberInput): Promise<unknown> {
      return Promise.resolve({ id: nextId('inv'), email: input.email, role: input.role ?? 'member', status: 'pending' })
    },

    // ── P2 Company commands ─────────────────────────────────────────────────────────
    deleteCompany(): Promise<void> {
      return Promise.resolve()
    },
    getCompanySettings(): Promise<CompanySettings> {
      return Promise.resolve({ ...mockCompanySettings })
    },
    updateCompanySettings(p: CompanySettings): Promise<CompanySettings> {
      const merged = deepMerge(
        mockCompanySettings as Record<string, unknown>,
        p as Record<string, unknown>,
      )
      Object.assign(mockCompanySettings, merged)
      return Promise.resolve({ ...mockCompanySettings })
    },

    // ── P2 AI-account commands ──────────────────────────────────────────────────────
    checkAiAccounts(): Promise<unknown> {
      return Promise.resolve({ checked: aiAccounts.length, ok: aiAccounts.length })
    },
    testAiAccount(id: string): Promise<unknown> {
      return Promise.resolve({ id, ok: true })
    },

    // ── P2 Doc (memory) commands ──────────────────────────────────────────────────────
    createDoc(input: CreateDocInput): Promise<MemoryDoc> {
      const id = nextId('doc')
      mockDocsCommands.addDoc({ id, ...input })
      return Promise.resolve({
        id,
        title: input.title,
        content: input.content,
        kind: input.kind ?? 'note',
      })
    },
    updateDoc(id: string, content: string): Promise<MemoryDoc> {
      mockDocsCommands.setContent(id, content)
      return Promise.resolve({ id, title: '', content, kind: 'note' })
    },

    // ── sweep/docs ──
    patchDoc: mockDocsCommands.patchDoc,
    deleteDoc: mockDocsCommands.deleteDoc,
    addKnowledgeSource: mockDocsCommands.addKnowledgeSource,
    deleteKnowledgeSource: mockDocsCommands.deleteKnowledgeSource,
    createLesson: mockDocsCommands.createLesson,
    updateLesson: mockDocsCommands.updateLesson,
    confirmLesson: mockDocsCommands.confirmLesson,
    forgetLesson: mockDocsCommands.forgetLesson,
    ask: mockDocsCommands.ask,
    saveHandbookFile: mockDocsCommands.saveHandbookFile,
    suggestHandbookEdit: mockDocsCommands.suggestHandbookEdit,
    acceptHandbookSuggestion: mockDocsCommands.acceptHandbookSuggestion,
    dismissHandbookSuggestion: mockDocsCommands.dismissHandbookSuggestion,

    // ── sweep/goals-routines ──
    cancelJob(jobId: string) {
      return Promise.resolve({ jobId, status: 'cancelled' })
    },
    routineRunFeedback(runId: string, vote: 'up' | 'down' | null) {
      const run = Object.values(mockRuns).flat().find((x) => x.id === runId)
      if (run) run.feedback = vote
      return Promise.resolve(run ?? {
        id: runId, routineId: '', jobId: null, at: null, outcome: 'ok' as const, duration: null,
        costCredits: 0, tokens: 0, trigger: null, error: null, feedback: vote,
      })
    },
    resendRoutineRun(runId: string) {
      const run = Object.values(mockRuns).flat().find((x) => x.id === runId)
      const again = run ? mockRunNow(run.routineId, 'resend') : null
      return Promise.resolve({
        resent: false,
        jobId: again?.jobId ?? null,
        runId: again?.id ?? null,
        message: 'Delivery isn’t connected yet, so the routine ran again instead.',
      })
    },
    previewRoutine(input: PreviewRoutineInput) {
      return Promise.resolve(mockPreview(input))
    },
    applyRoutineSuggestion(id: string) {
      const sug = mockSuggestions().find((s) => s.id === id)
      const applied: string[] = []
      for (const mv of sug?.moves ?? []) {
        const r = routines.find((x) => x.id === mv.routineId)
        if (!r) continue
        if (sug?.kind === 'failing') r.paused = true
        else if (mv.toAt) { r.at = mv.toAt; mockRecompute(r) }
        applied.push(r.id)
      }
      dismissed.add(id)
      return Promise.resolve({ applied })
    },
    dismissRoutineSuggestion(id: string) {
      dismissed.add(id)
      return Promise.resolve()
    },
    openGoalSession(goalId: string) {
      return Promise.resolve(mockGoalSession(goalId))
    },

    // ── sweep/inbox-flows ──
    markInboxRead(id: string): Promise<void> {
      mockMarkRead(id)
      return Promise.resolve()
    },
    markAllInboxRead(before?: string): Promise<{ updated: number }> {
      return Promise.resolve({ updated: mockMarkAllRead(before) })
    },
    updateProposal(id: string, input: UpdateProposalInput): Promise<void> {
      mockUpdateProposal(id, input)
      return Promise.resolve()
    },
    approveProposalAmended(id: string, params: Record<string, unknown>, _note?: string): Promise<{ executionJobId: string }> {
      mockDecide(id, 'done', params)
      return Promise.resolve({ executionJobId: nextId('ejob') })
    },
    undoApproval(id: string): Promise<void> {
      return mockUndo(id).then(() => applyMockFlowPublish(id, false))
    },
    decideFlowRun(flowId: string, runId: string, approve: boolean): Promise<FlowRun> {
      const run = flowRuns.find(r => r.id === runId && r.flowId === flowId)
      if (!run) return Promise.reject(new Error('Run not found'))
      const st = (run.steps ?? []).map(x => (x.status === 'waiting' ? { ...x, status: approve ? 'done' : 'declined', note: approve ? 'You approved' : 'You declined' } : x))
      run.steps = st
      run.status = approve ? 'done' : 'declined'
      run.waitingFor = null
      run.endedAt = new Date().toISOString()
      for (const item of inboxItems) {
        if (item.proposals?.some(p => p.flowRunId === runId)) item.status = 'done'
      }
      return Promise.resolve({ ...run })
    },
    retryFlowRun(flowId: string, _runId: string): Promise<FlowRun> {
      const f = flows.find(x => x.id === flowId)
      if (!f) return Promise.reject(new Error('Flow not found'))
      return Promise.resolve(mockRun(f, false))
    },
    cancelFlowRun(flowId: string, runId: string): Promise<FlowRun> {
      const run = flowRuns.find(r => r.id === runId && r.flowId === flowId)
      if (!run) return Promise.reject(new Error('Run not found'))
      run.status = 'cancelled'
      run.waitingFor = null
      run.steps = (run.steps ?? []).map(x => (x.status === 'waiting' ? { ...x, status: 'cancelled' } : x))
      return Promise.resolve({ ...run })
    },
    restoreFlowVersion(flowId: string, version: number): Promise<Flow> {
      const f = flows.find(x => x.id === flowId)
      if (!f) return Promise.reject(new Error('Flow not found'))
      const g = graphAt(flowId, version)
      if (g) { f.nodes = g.nodes; f.edges = g.edges; f.count = g.nodes.length }
      f.version = (f.version ?? 1) + 1
      mockSnapshot(f, `Restored from v${version}`)
      rememberGraph(f)
      return Promise.resolve({ ...f })
    },

    // ── sweep/team-analytics ──
    retireHelper(id: string): Promise<Helper> {
      const h = helpers.find((x) => x.id === id)
      if (!h) return Promise.reject(new Error('Helper not found'))
      if (h.isChief) return Promise.reject(new Error("The Chief can't be let go."))
      h.status = 'retired'
      return Promise.resolve(h)
    },
    allowHelperJob(id: string): Promise<Helper> {
      const h = helpers.find((x) => x.id === id) ?? helpers[0]
      h.budgetAllowJobs = (h.budgetAllowJobs ?? 0) + 1
      if (h.status === 'paused') h.status = 'active'
      return Promise.resolve(h)
    },
    connectHelperChannel(helperId: string, input: ConnectHelperChannelInput): Promise<HelperChannelBinding> {
      const list = (mockHelperChannels[helperId] ??= [])
      let ch = list.find((c) => c.kind === input.kind)
      if (!ch) {
        ch = { id: nextId('hch'), helperId, kind: input.kind, config: {}, secretsSet: [], status: 'pending_setup' }
        list.push(ch)
      }
      ch.config = { ...ch.config, ...(input.config ?? {}) }
      ch.secretsSet = [...new Set([...ch.secretsSet, ...Object.keys(input.secrets ?? {})])].sort()
      return Promise.resolve({ ...ch })
    },
    updateHelperChannel(helperId: string, channelId: string, config: Record<string, unknown>): Promise<HelperChannelBinding> {
      const ch = (mockHelperChannels[helperId] ?? []).find((c) => c.id === channelId)
      if (!ch) return Promise.reject(new Error('Channel not found'))
      ch.config = { ...ch.config, ...config }
      return Promise.resolve({ ...ch })
    },
    disconnectHelperChannel(helperId: string, channelId: string): Promise<void> {
      mockHelperChannels[helperId] = (mockHelperChannels[helperId] ?? []).filter((c) => c.id !== channelId)
      return Promise.resolve()
    },
    setHelperTools(helperId: string, input: SetHelperToolsInput): Promise<HelperTools> {
      const t = mockToolsFor(helperId)
      for (const c of input.connectors ?? []) {
        const row = t.connectors.find((x) => x.id === c.id)
        if (row) { row.on = c.on; if (c.access) row.access = c.access }
      }
      for (const [k, v] of Object.entries(input.builtins ?? {})) {
        const row = t.builtins.find((x) => x.id === k)
        if (row) row.on = v
      }
      return Promise.resolve({ connectors: t.connectors.map((x) => ({ ...x })), builtins: t.builtins.map((x) => ({ ...x })) })
    },
    setHelperSkills(helperId: string, list: HelperSkillSetting[]): Promise<HelperSkillRow[]> {
      const settings = (mockHelperSkillSettings[helperId] ??= {})
      for (const s of list) settings[s.id] = { enabled: s.enabled, permission: s.permission }
      return Promise.resolve(
        skills
          .filter((s) => s.helperId === helperId || s.id in settings)
          .map((s) => ({
            id: s.id, name: s.name, version: s.version, status: s.status, own: s.helperId === helperId,
            description: '', enabled: settings[s.id]?.enabled ?? true,
            permission: settings[s.id]?.permission ?? (s.helperId === helperId ? 'always' : 'ask'),
          })),
      )
    },
    saveHelperFile(helperId: string, name: string, content: string): Promise<HelperFile> {
      const files = mockFilesFor(helperId, helpers.find((h) => h.id === helperId)?.name ?? 'Helper')
      const f = files.find((x) => x.name === name)
      if (!f) return Promise.reject(new Error('Unknown working file'))
      f.content = content
      f.docId ??= nextId('mem')
      f.updatedAt = new Date().toISOString()
      f.updatedBy = 'operator:me'
      return Promise.resolve({ ...f })
    },
    retryJob(jobId: string): Promise<RetryJobResult> {
      const f = mockFailures.find((x) => x.jobId === jobId)
      if (f) { f.status = 'recovered'; f.action = 'view'; f.attempts += 1 }
      return Promise.resolve({ jobId, status: 'done', error: null, attempts: f?.attempts ?? 2 })
    },

    // ── sweep/chat ──
    ...createChatMockCommands(),

    // ── sweep/control ──
    uploadCompanyLogo(dataUrl: string): Promise<CompanyDetail> {
      companyDetail.logoUrl = dataUrl
      return Promise.resolve({ ...companyDetail })
    },
    removeCompanyLogo(): Promise<CompanyDetail> {
      companyDetail.logoUrl = null
      return Promise.resolve({ ...companyDetail })
    },
    updateMember(id: string, input: UpdateMemberInput): Promise<CompanyMember> {
      const m = members.find((x) => x.id === id)
      if (!m) return Promise.reject(new Error('Member not found.'))
      if (input.role !== undefined) m.role = input.role
      if (input.allChannels) {
        m.channels = null
        m.channelNames = null
      } else if (input.channels !== undefined) {
        m.channels = input.channels.length ? [...input.channels] : null
        m.channelNames = m.channels ? m.channels.map((c) => managedChannels.find((ch) => ch.id === c)?.name ?? c) : null
      }
      return Promise.resolve({ ...m })
    },
    revokeInvite(id: string): Promise<void> {
      const i = invites.findIndex((x) => x.id === id)
      if (i >= 0) invites.splice(i, 1)
      return Promise.resolve()
    },
    resendInvite(_id: string): Promise<void> {
      return Promise.resolve()
    },
    buySeats(count: number): Promise<BuySeatsResult> {
      seatSummary.total = (seatSummary.total ?? 0) + count
      return Promise.resolve({ status: 'active', seats: seatSummary.total, hostedUrl: null, paymentId: null, amountIdr: count * 150_000 })
    },
    updateChannel(id: string, input: UpdateChannelInput): Promise<ManagedChannel> {
      const c = managedChannels.find((x) => x.id === id)
      if (!c) return Promise.reject(new Error('Not found.'))
      if (input.archived !== undefined) {
        if (c.isDefault && input.archived) return Promise.reject(new Error("The default channel can't be archived."))
        c.archived = input.archived
        c.archivedAt = input.archived ? new Date().toISOString() : null
      }
      if (input.muted !== undefined) c.muted = input.muted
      if (input.name !== undefined) c.name = input.name
      if (input.purpose !== undefined) c.purpose = input.purpose
      return Promise.resolve({ ...c })
    },
    deleteChannel(id: string): Promise<void> {
      const i = managedChannels.findIndex((x) => x.id === id)
      if (i >= 0 && managedChannels[i].isDefault) return Promise.reject(new Error("The default channel can't be removed."))
      if (i >= 0) managedChannels.splice(i, 1)
      const j = channels.findIndex((x) => x.id === id)
      if (j >= 0) channels.splice(j, 1)
      return Promise.resolve()
    },
    updateAiAccount(id: string, input: UpdateAiAccountInput): Promise<AiAccount> {
      const a = aiAccounts.find((x) => x.id === id)
      if (!a) return Promise.reject(new Error('Account not found.'))
      if (input.name !== undefined) a.name = input.name
      if (input.tag !== undefined) a.tag = input.tag
      if (input.status !== undefined) a.status = input.status
      return Promise.resolve({ ...a })
    },
    reauthConnector(id: string): Promise<Connector> {
      const c = connectors.find((x) => x.id === id)
      if (!c) return Promise.reject(new Error('Connector not found.'))
      c.status = 'needs_auth'
      return Promise.resolve({ ...c, auth: c.auth ?? { type: 'api_key', provider: null, fields: ['api_key'] } })
    },
    refreshMarketplace(): Promise<unknown> {
      return Promise.resolve({ indexed: 0 })
    },
    createMcpServer(input: CreateMcpServerInput): Promise<McpServer> {
      const server: McpServer = {
        id: nextId('mcs'), name: input.name, kind: 'remote', url: input.url,
        authType: input.token ? 'bearer' : 'none', tokenHint: input.token ? `${input.token.slice(0, 4)}…` : null,
        status: 'connected', error: null, enabled: true, createdAt: new Date().toISOString(),
        tools: [{ name: 'echo', description: 'Echo a message back', level: 'read' }],
      }
      mcpServers.unshift(server)
      return Promise.resolve(server)
    },
    createMcpServerFromOpenApi(input: CreateMcpServerFromOpenApiInput): Promise<McpServer> {
      const server: McpServer = {
        id: nextId('mcs'), name: input.name, kind: 'openapi', url: null, authType: 'none', tokenHint: null,
        status: 'connected', error: null, enabled: true, createdAt: new Date().toISOString(),
        tools: [
          { name: 'list_items', description: 'GET /items', level: 'read' },
          { name: 'create_item', description: 'POST /items', level: 'ask' },
        ],
      }
      mcpServers.unshift(server)
      return Promise.resolve(server)
    },
    refreshMcpServer(id: string): Promise<McpServer> {
      const s = mcpServers.find((x) => x.id === id)
      return s ? Promise.resolve({ ...s }) : Promise.reject(new Error('MCP server not found.'))
    },
    deleteMcpServer(id: string): Promise<void> {
      const i = mcpServers.findIndex((x) => x.id === id)
      if (i >= 0) mcpServers.splice(i, 1)
      return Promise.resolve()
    },
    createSkill(input: CreateSkillInput): Promise<Skill> {
      const skill: Skill = {
        id: nextId('skl'), name: input.name, status: 'draft', version: 1, helperId: input.helperId,
        usageCount: 0, bodyMd: input.bodyMd,
      }
      skills.unshift(skill)
      return Promise.resolve(skill)
    },
    updateSkill(id: string, input: UpdateSkillInput): Promise<Skill> {
      const sk = skills.find((x) => x.id === id)
      if (!sk) return Promise.reject(new Error('Skill not found.'))
      if (input.status === 'active' && sk.status === 'draft') {
        return Promise.reject(new Error('Drafts go live through publish review. Publish it instead.'))
      }
      if (input.status !== undefined) sk.status = input.status
      if (input.name !== undefined) sk.name = input.name
      if (input.bodyMd !== undefined) sk.bodyMd = input.bodyMd
      if (input.helperId !== undefined) sk.helperId = input.helperId
      return Promise.resolve({ ...sk })
    },
    setTelemetryOptOut(optedOut: boolean): Promise<void> {
      telemetryState.optedOut = optedOut
      return Promise.resolve()
    },
    updatePreferences(p: UserPreferences): Promise<UserPreferences> {
      Object.assign(userPreferences, deepMerge(userPreferences as Record<string, unknown>, p as Record<string, unknown>))
      return Promise.resolve(JSON.parse(JSON.stringify(userPreferences)) as UserPreferences)
    },
    setTwoFactor(enabled: boolean): Promise<void> {
      accountInfo.twoFactorEnabled = enabled
      return Promise.resolve()
    },
    revokeSession(id: string): Promise<void> {
      const i = signInSessions.findIndex((x) => x.id === id)
      if (i >= 0) signInSessions.splice(i, 1)
      return Promise.resolve()
    },
    uploadAvatar(dataUrl: string): Promise<{ avatarUrl: string }> {
      accountInfo.avatarUrl = dataUrl
      return Promise.resolve({ avatarUrl: dataUrl })
    },
    createDataExport(): Promise<DataExport> {
      const now = new Date()
      const exp: DataExport = {
        id: nextId('exp'), status: 'ready', filename: `omilo-export-${now.toISOString().slice(0, 10)}.zip`,
        sizeBytes: 48_000, summary: { channel: channels.length, member: members.length }, error: null,
        createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      }
      dataExports.unshift(exp)
      return Promise.resolve(exp)
    },
    downloadDataExport(_id: string): Promise<Blob> {
      return Promise.resolve(new Blob([JSON.stringify({ channels, members }, null, 2)], { type: 'application/zip' }))
    },
    downloadAuditCsv(_query?: AuditQuery): Promise<Blob> {
      const lines = ['time,actor,actor_type,type,action,target,channel']
      for (const e of auditEvents) lines.push([e.at, e.actorName, e.actorType, e.type, e.action, e.target, e.channel ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      return Promise.resolve(new Blob([lines.join('\n')], { type: 'text/csv' }))
    },
  }
}

// ── sweep/team-analytics ──

import type {
  ConnectHelperChannelInput,
  HelperSkillSetting,
  RetryJobResult,
  SetHelperToolsInput,
} from '../http/commands'
import type { HelperChannelBinding, HelperFile, HelperSkillRow, HelperTools } from '../../core/domain/types'
import {
  mockFailures,
  mockFilesFor,
  mockHelperChannels,
  mockHelperSkillSettings,
  mockToolsFor,
} from './fixtures'

function sweepCreateHelperExtras(input: CreateHelperInput): Partial<Helper> {
  const out: Partial<Helper> = { jobs: 0, success: 0, jobsMonth: 0, tokensMonth: 0, loops: 0 }
  if (input.model !== undefined) out.model = input.model
  if (input.reportsTo !== undefined) out.reportsTo = input.reportsTo
  if (input.title !== undefined) out.title = input.title
  if (input.look !== undefined) out.look = input.look
  return out
}

function sweepApplyHelperUpdate(h: Helper, input: UpdateHelperInput): void {
  if (input.model !== undefined) h.model = input.model || null
  if (input.name !== undefined) h.name = input.name
  if (input.area !== undefined) h.area = input.area as Helper['area']
  if (input.title !== undefined) h.title = input.title
  if (input.reportsTo !== undefined) h.reportsTo = input.reportsTo
  if (input.look !== undefined) h.look = input.look
  if (input.budgetTokensMonth !== undefined) h.budgetTokensMonth = input.budgetTokensMonth
  if (input.behavior !== undefined) {
    const merged: Record<string, unknown> = { ...(h.behavior ?? {}) }
    for (const [k, v] of Object.entries(input.behavior)) {
      if (v === null) delete merged[k]
      else merged[k] = v
    }
    h.behavior = merged
  }
}
