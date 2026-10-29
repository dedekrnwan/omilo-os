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
      const session: Session = {
        id: nextId('ses'),
        title: input.title ?? 'New chat',
        channelId: input.channelId,
        updated: 'now',
      }
      return Promise.resolve(session)
    },
    sendMessage(sessionId: string, content: string): Promise<{ message: Message; jobId: string }> {
      const message: Message = {
        id: nextId('msg'),
        sessionId,
        author: { kind: 'you', name: 'You' },
        content,
        createdAt: new Date().toISOString(),
      }
      return Promise.resolve({ message, jobId: nextId('job') })
    },
    approveProposal(_proposalId: string, _note?: string): Promise<{ executionJobId: string }> {
      return Promise.resolve({ executionJobId: nextId('ejob') })
    },
    rejectProposal(_proposalId: string, _note: string): Promise<void> {
      return Promise.resolve()
    },
    requestChanges(_proposalId: string, _note: string): Promise<void> {
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
        accent: input.color as Channel['accent'],
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
      return Promise.resolve({ id: nextId('prp'), type: 'flow_publish', status: 'pending', flowId: id })
    },
    runFlow(id: string): Promise<unknown> {
      return Promise.resolve({ id: nextId('frn'), flowId: id, status: 'running' })
    },
    testRunFlow(id: string, _input?: Record<string, unknown>): Promise<unknown> {
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
      }
      flows.push(flow)
      return Promise.resolve(flow)
    },
    updateFlow(id: string, input: UpdateFlowInput): Promise<Flow> {
      const f = flows.find(x => x.id === id)
      if (f) {
        if (input.title !== undefined) f.title = input.title
        if (input.trigger !== undefined) f.trigger = input.trigger
        if (input.nodes !== undefined) { f.nodes = input.nodes; f.count = input.nodes.length }
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
        costCredits: 0, trigger: null, error: null, feedback: vote,
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
  }
}
