import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Flow, Id } from '../core/domain/types'
import type {
  CreateDocInput,
  CreateFlowInput,
  CreateGoalInput,
  CreateHelperInput,
  CreateRoutineInput,
  InviteMemberInput,
  UpdateFlowInput,
  UpdateGoalInput,
  UpdateHelperInput,
  UpdateMeInput,
  UpdateRoutineInput,
  UpdateWalletInput,
} from '../adapters/http/commands'
import type { CompanySettings } from '../core/domain/types'
// ── sweep/docs ──
import type {
  DocGraph,
  DocSummary,
  DocVersion,
  HandbookIndex,
  HandbookSuggestion,
  Lesson,
} from '../core/domain/types'
import type { DocsRepo, HandbookRepo, LessonRepo } from '../core/ports/repos'
import type {
  AddKnowledgeSourceInput,
  CreateLessonInput,
  PatchDocInput,
  SaveHandbookFileInput,
  SuggestHandbookEditInput,
} from '../adapters/http/commands'
import { useCommands } from './CommandsProvider'
import { useRepos } from './ReposProvider'
import { useSession as useSessionStore } from './session'

export function useChannels() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['channels'],
    queryFn: () => repos.channels.list(),
  })
}

export function useChannel(id: Id) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['channel', id],
    queryFn: () => repos.channels.get(id),
    // Skip when there's no id (e.g. the "all areas" view passes ''): an empty id
    // would hit GET /v1/channels/ (trailing slash) → a 307 redirect that drops
    // the auth header on the cross-origin hop → 401.
    enabled: !!id,
  })
}

export function useChannelSessions(channelId: Id) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['sessions', 'byChannel', channelId],
    queryFn: () => repos.sessions.listByChannel(channelId),
  })
}

export function useSession(id: Id) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => repos.sessions.get(id),
    enabled: !!id,
  })
}

export function useMessages(sessionId: Id) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['messages', sessionId],
    queryFn: () => repos.messages.listBySession(sessionId),
  })
}

export function useInbox() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['inbox'],
    queryFn: () => repos.inbox.list(),
  })
}

export function useInboxItem(id: Id) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['inboxItem', id],
    queryFn: () => repos.inbox.get(id),
    enabled: !!id,
  })
}

export function useChannelFolders(channelId: Id) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['folders', 'byChannel', channelId],
    queryFn: () => repos.folders.listByChannel(channelId),
  })
}

export function useChannelGoals(channelId: Id) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['goals', 'byChannel', channelId],
    queryFn: () => repos.goals.listByChannel(channelId),
  })
}

// ── Area-aware queries ────────────────────────────────────────────────────────
// `areaId === null` → everything across all areas; otherwise scoped to one area.
// Used by the unified sidebar (Folders/Recents) and the shared platform pages.

/** Areas are channels (same underlying data), relabeled in the UI. */
export const useAreas = useChannels
export const useArea = useChannel

export function useSessions(areaId: Id | null) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['sessions', areaId ?? 'all'],
    queryFn: () => (areaId ? repos.sessions.listByChannel(areaId) : repos.sessions.listAll()),
  })
}

export function useFolders(areaId: Id | null) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['folders', areaId ?? 'all'],
    queryFn: () => (areaId ? repos.folders.listByChannel(areaId) : repos.folders.listAll()),
  })
}

export function useGoals(areaId: Id | null) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['goals', areaId ?? 'all'],
    queryFn: () => (areaId ? repos.goals.listByChannel(areaId) : repos.goals.listAll()),
  })
}

// ── P12 billing queries ────────────────────────────────────────────────────────

export function usePlans() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['billingPlans'],
    queryFn: () => repos.billingPlans.list(),
  })
}

export function useSubscription() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['billingSubscription'],
    queryFn: () => repos.billingSubscription.get(),
  })
}

// ── P5d control-panel queries ─────────────────────────────────────────────────

export function useUsage() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['usage'],
    queryFn: () => repos.usage.get(),
  })
}

export function useConnectors() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['connectors'],
    queryFn: () => repos.connectors.list(),
  })
}

export function useMarketplace(params?: { category?: string; q?: string }) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['marketplace', params ?? {}],
    queryFn: () => repos.marketplace.list(params),
  })
}

export function useMcpTokens() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['mcpTokens'],
    queryFn: () => repos.mcpTokens.list(),
  })
}

export function useAiAccounts() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['aiAccounts'],
    queryFn: () => repos.aiAccounts.list(),
  })
}

/** Probe this machine for local harness CLIs (self-host). */
export function useHarnessDetect() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['harnessDetect'],
    queryFn: () => repos.aiAccounts.detect?.() ?? Promise.resolve([]),
    staleTime: 60_000,
  })
}

// ── P8 query hooks ─────────────────────────────────────────────────────────────

export function useFlows() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['flows'],
    queryFn: () => repos.flows.list(),
  })
}

export function useFlow(id: Id) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['flow', id],
    queryFn: () => repos.flows.get(id),
    enabled: !!id,
  })
}

export function useFlowRuns(flowId: Id) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['flowRuns', flowId],
    queryFn: () => repos.flows.runs(flowId),
  })
}

/**
 * Aggregate runs across ALL flows for the office "Runs" tab. The backend has
 * no cross-flow runs endpoint, so we fan out `repos.flows.runs(id)` per flow
 * and flatten. Shares the per-flow `['flowRuns', id]` cache key with
 * `useFlowRuns`, so the editor and this tab reuse the same cached runs.
 */
export function useAllFlowRuns(flows: Flow[]) {
  const repos = useRepos()
  const results = useQueries({
    queries: flows.map((f) => ({
      queryKey: ['flowRuns', f.id],
      queryFn: () => repos.flows.runs(f.id),
    })),
  })
  return {
    runs: results.flatMap((r) => r.data ?? []),
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
  }
}

export function useRoutines() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['routines'],
    queryFn: () => repos.routines.list(),
  })
}

export function useRoutine(id: Id) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['routine', id],
    queryFn: () => repos.routines.get(id),
    enabled: !!id,
  })
}

export function useKnowledgeSources() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['knowledgeSources'],
    queryFn: () => repos.knowledge.sources(),
  })
}

export function useKnowledge(params?: { q?: string }) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['knowledge', params ?? {}],
    queryFn: () => repos.knowledge.list(params),
  })
}

export function useAnalyticsOverview(range?: string) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['analyticsOverview', range ?? 'week'],
    queryFn: () => repos.analytics.overview(range),
  })
}

export function useAnalyticsHelpers(range?: string) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['analyticsHelpers', range ?? 'week'],
    queryFn: () => repos.analytics.helpers(range),
  })
}

export function useSkills() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['skills'],
    queryFn: () => repos.skills.list(),
  })
}

export function useSkill(id: Id) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['skill', id],
    queryFn: () => repos.skills.get(id),
    enabled: !!id,
  })
}

export function useHelpers() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['helpers'],
    queryFn: () => repos.helpers.list(),
  })
}

export function useHelper(id: Id) {
  const repos = useRepos()
  return useQuery({
    queryKey: ['helper', id],
    queryFn: () => repos.helpers.get(id),
    enabled: !!id,
  })
}

// ── P13 control-panel members ─────────────────────────────────────────────────

export function useMembers() {
  const repos = useRepos()
  return useQuery({
    queryKey: ['members'],
    queryFn: () => repos.members.list(),
  })
}

// ── P2 company settings query ─────────────────────────────────────────────────

export function useCompanySettings() {
  const commands = useCommands()
  return useQuery({
    queryKey: ['companySettings'],
    queryFn: () => commands.getCompanySettings(),
  })
}

// ── P2 mutation hooks ─────────────────────────────────────────────────────────
// Each mutation goes through the Commands port (HTTP or mock, swapped by
// CommandsProvider) and invalidates the list/detail query key it mutates so the
// cached read refreshes after a create/update/delete.

// Goals → ['goals']

export function useCreateGoal() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateGoalInput) => commands.createGoal(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['goals'] }) },
  })
}

export function useUpdateGoal() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: Id; input: UpdateGoalInput }) =>
      commands.updateGoal(id, input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['goals'] }) },
  })
}

export function useDeleteGoal() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: Id) => commands.deleteGoal(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['goals'] }) },
  })
}

// Routines → ['routines'] (+ ['routine', id])

export function useCreateRoutine() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateRoutineInput) => commands.createRoutine(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['routines'] }) },
  })
}

export function useUpdateRoutine() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: Id; input: UpdateRoutineInput }) =>
      commands.updateRoutine(id, input),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: ['routines'] })
      void qc.invalidateQueries({ queryKey: ['routine', id] })
    },
  })
}

export function useDeleteRoutine() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: Id) => commands.deleteRoutine(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['routines'] }) },
  })
}

export function useSkipRoutineNext() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: Id) => commands.skipRoutineNext(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ['routines'] })
      void qc.invalidateQueries({ queryKey: ['routine', id] })
    },
  })
}

// Flows → ['flows']

export function useCreateFlow() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateFlowInput) => commands.createFlow(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['flows'] }) },
  })
}

export function useUpdateFlow() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: Id; input: UpdateFlowInput }) =>
      commands.updateFlow(id, input),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: ['flows'] })
      void qc.invalidateQueries({ queryKey: ['flow', id] })
    },
  })
}

export function useDeleteFlow() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: Id) => commands.deleteFlow(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['flows'] }) },
  })
}

export function useDuplicateFlow() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateFlowInput) => commands.duplicateFlow(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['flows'] }) },
  })
}

// Helpers → ['helpers']

export function useCreateHelper() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateHelperInput) => commands.createHelper(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['helpers'] }) },
  })
}

export function useUpdateHelper() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: Id; input: UpdateHelperInput }) =>
      commands.updateHelper(id, input),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: ['helpers'] })
      void qc.invalidateQueries({ queryKey: ['helper', id] })
    },
  })
}

// Members → ['members']

export function useChangeMemberRole() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, role }: { id: Id; role: string }) =>
      commands.changeMemberRole(id, role),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['members'] }) },
  })
}

export function useRemoveMember() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: Id) => commands.removeMember(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['members'] }) },
  })
}

export function useInviteMember() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: InviteMemberInput) => commands.inviteMember(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['members'] }) },
  })
}

// Company settings → ['companySettings']

export function useUpdateCompanySettings() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: CompanySettings) => commands.updateCompanySettings(patch),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['companySettings'] }) },
  })
}

// User profile → session store

/**
 * PATCH /v1/me — update the authed user's real name and push the returned /me
 * shape into the session store so the Rail / avatar refresh immediately.
 */
export function useUpdateMe() {
  const commands = useCommands()
  const applyMe = useSessionStore((s) => s.applyMe)
  return useMutation({
    mutationFn: (input: UpdateMeInput) => commands.updateMe(input),
    onSuccess: (result) => { applyMe(result) },
  })
}

// AI accounts → ['aiAccounts']

export function useCheckAiAccounts() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => commands.checkAiAccounts(),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aiAccounts'] }) },
  })
}

export function useTestAiAccount() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: Id) => commands.testAiAccount(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['aiAccounts'] }) },
  })
}

// Docs / knowledge → ['knowledge']

export function useCreateDoc() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateDocInput) => commands.createDoc(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['knowledge'] })
      void qc.invalidateQueries({ queryKey: ['docs'] })
    },
  })
}

export function useUpdateDoc() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, content }: { id: Id; content: string }) =>
      commands.updateDoc(id, content),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['knowledge'] })
      void qc.invalidateQueries({ queryKey: ['docs'] })
    },
  })
}

// Billing → ['billingSubscription'] / ['usage']

export function useTopup() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pack: string) => commands.topup(pack),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['usage'] }) },
  })
}

export function useChangePlan() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ planId, interval }: { planId: string; interval: 'monthly' | 'yearly' }) =>
      commands.changePlan(planId, interval),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['billingSubscription'] })
      void qc.invalidateQueries({ queryKey: ['usage'] })
    },
  })
}

export function useUpdateWallet() {
  const commands = useCommands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateWalletInput) => commands.updateWallet(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['usage'] }) },
  })
}

// ── sweep/docs ──────────────────────────────────────────────────────────────
// Query keys: ['docs', …] (list/detail/versions/graph), ['lessons'],
// ['knowledgeSources'], ['handbook', …].

/** Fallbacks for Repos stubs that predate the docs/lessons/handbook repos. */
const EMPTY_DOCS_REPOS = {
  docs: {
    list: () => Promise.resolve([] as DocSummary[]),
    get: () => Promise.resolve(null),
    versions: () => Promise.resolve([] as DocVersion[]),
    graph: () => Promise.resolve({ nodes: [], edges: [] } as DocGraph),
  } satisfies DocsRepo,
  lessons: { list: () => Promise.resolve([] as Lesson[]) } satisfies LessonRepo,
  handbook: {
    index: () => Promise.resolve({ files: [], openSuggestions: 0 } as HandbookIndex),
    file: () => Promise.resolve(null),
    suggestions: () => Promise.resolve([] as HandbookSuggestion[]),
  } satisfies HandbookRepo,
}

function useDocsRepos() {
  const repos = useRepos()
  return {
    docs: repos.docs ?? EMPTY_DOCS_REPOS.docs,
    lessons: repos.lessons ?? EMPTY_DOCS_REPOS.lessons,
    handbook: repos.handbook ?? EMPTY_DOCS_REPOS.handbook,
  }
}

export function useMemoryDocs(params?: { helperId?: string; kind?: string }) {
  const repos = useDocsRepos()
  return useQuery({
    queryKey: ['docs', 'list', params ?? {}],
    queryFn: () => repos.docs.list(params),
  })
}

export function useMemoryDoc(id: Id | null) {
  const repos = useDocsRepos()
  return useQuery({
    queryKey: ['docs', 'detail', id],
    queryFn: () => repos.docs.get(id!),
// ── sweep/team-analytics ──────────────────────────────────────────────────────

import type { ActivityQuery } from '../core/ports/repos'
import type {
  ConnectHelperChannelInput,
  HelperSkillSetting,
  SetHelperToolsInput,
} from '../adapters/http/commands'

const EMPTY_SERIES = { buckets: [], series: [], total: 0 }

/** Analytics overview for a range ('week' | 'month' | 'quarter') and optional channel. */
export function useAnalyticsOverviewFor(range: string, channelId?: string) {
    queryKey: ['analyticsOverview', range, channelId ?? null],
    queryFn: () =>
      repos.analytics.overviewFor ? repos.analytics.overviewFor(range, channelId) : repos.analytics.overview(range),

export function useAnalyticsHelpersFor(range: string, channelId?: string) {
    queryKey: ['analyticsHelpers', range, channelId ?? null],
    queryFn: () =>
      repos.analytics.helpersFor ? repos.analytics.helpersFor(range, channelId) : repos.analytics.helpers(range),

export function useSpendByChannel(range: string, channelId?: string) {
    queryKey: ['analyticsSpendByChannel', range, channelId ?? null],
    queryFn: () => repos.analytics.spendByChannel?.(range, channelId) ?? Promise.resolve(EMPTY_SERIES),

export function useTokensByHelper(range: string, channelId?: string) {
    queryKey: ['analyticsTokensByHelper', range, channelId ?? null],
    queryFn: () => repos.analytics.tokensByHelper?.(range, channelId) ?? Promise.resolve(EMPTY_SERIES),

export function useAnalyticsLoops(range: string) {
    queryKey: ['analyticsLoops', range],
    queryFn: () => repos.analytics.loops?.(range) ?? Promise.resolve([]),

export function useAnalyticsReliability(range: string, channelId?: string) {
    queryKey: ['analyticsReliability', range, channelId ?? null],
    queryFn: () =>
      repos.analytics.reliability?.(range, channelId) ??
      Promise.resolve({ stats: [], causes: [], causesTip: '' }),

export function useAnalyticsFailures(range: string, channelId?: string) {
    queryKey: ['analyticsFailures', range, channelId ?? null],
    queryFn: () => repos.analytics.failures?.(range, channelId) ?? Promise.resolve([]),

export function useActivity(q: ActivityQuery) {
    queryKey: ['activity', q],
    queryFn: () =>
      repos.analytics.activity?.(q) ??
      Promise.resolve({ items: [], nextCursor: null, counts: { done: 0, needs_you: 0, failed: 0, started: 0 } }),

export function useHelperDetail(id: Id) {
    queryKey: ['helperDetail', id],
    queryFn: async () => {
      if (repos.helpers.detail) return repos.helpers.detail(id)
      const helper = await repos.helpers.get(id)
      return helper
        ? { helper, routines: [], skills: [], counts: { channels: 1, tools: 0, skills: 0, routines: 0 } }
        : null
    },
// ── sweep/chat ────────────────────────────────────────────────────────────────
// Persisted chat workspace: sidebar edits (rename/pin/move/archive/delete),
// folders (look, instructions, files, sharing), area looks, archive drawer,
// results panel, private Chief threads and nudges. Session/folder/channel
// patches are applied optimistically to every cached list, then refetched.

type SessionList = import('../core/domain/types').Session[]
type FolderList = import('../core/domain/types').Folder[]
type ChannelList = import('../core/domain/types').Channel[]

const EMPTY_RESULTS: import('../core/domain/types').SessionResults = {
  steps: [],
  outputs: [],
  activity: [],
  usage: { tokensIn: 0, tokensOut: 0, costCredits: 0 },

export function useArchivedSessions(areaId: Id | null) {
    queryKey: ['sessions', 'archived', areaId ?? 'all'],
    queryFn: () => repos.chat?.archived(areaId) ?? Promise.resolve([]),

export function useChiefThreads(enabled = true) {
    queryKey: ['sessions', 'chief'],
    queryFn: () => repos.chat?.chiefThreads() ?? Promise.resolve([]),
    enabled,

export function useChiefNudges() {
    queryKey: ['chiefNudges'],
    queryFn: () => repos.chat?.chiefNudges() ?? Promise.resolve([]),

export function useFolder(id: Id) {
    queryKey: ['folder', id],
    queryFn: () => repos.chat?.folder(id) ?? Promise.resolve(null),
    enabled: !!id,
  })
}

export function useDocVersions(id: Id | null) {
  const repos = useDocsRepos()
  return useQuery({
    queryKey: ['docs', 'versions', id],
    queryFn: () => repos.docs.versions(id!),
export function useHelperChannels(id: Id) {
  const repos = useRepos()
    queryKey: ['helperChannels', id],
    queryFn: () => repos.helpers.channels?.(id) ?? Promise.resolve([]),
export function useFolderFiles(id: Id) {
    queryKey: ['folderFiles', id],
    queryFn: () => repos.chat?.folderFiles(id) ?? Promise.resolve([]),
    enabled: !!id,
  })
}

export function useDocGraph() {
  const repos = useDocsRepos()
  return useQuery({
    queryKey: ['docs', 'graph'],
    queryFn: () => repos.docs.graph(),
  })
}

export function useLessons(params?: { status?: 'review' | 'active' }) {
  const repos = useDocsRepos()
  return useQuery({
    queryKey: ['lessons', params ?? {}],
    queryFn: () => repos.lessons.list(params),
  })
}

export function useHandbook() {
  const repos = useDocsRepos()
  return useQuery({
    queryKey: ['handbook', 'index'],
    queryFn: () => repos.handbook.index(),
  })
}

export function useHandbookFile(name: string | null) {
  const repos = useDocsRepos()
  return useQuery({
    queryKey: ['handbook', 'file', name],
    queryFn: () => repos.handbook.file(name!),
    enabled: !!name,
  })
}

function useInvalidate(...keys: string[]) {
  const qc = useQueryClient()
  return () => { for (const k of keys) void qc.invalidateQueries({ queryKey: [k] }) }
}

export function usePatchDoc() {
  const commands = useCommands()
  const invalidate = useInvalidate('docs', 'knowledge')
  return useMutation({
    mutationFn: ({ id, patch }: { id: Id; patch: PatchDocInput }) => commands.patchDoc(id, patch),
    onSuccess: invalidate,
  })
}

export function useDeleteDoc() {
  const commands = useCommands()
  const invalidate = useInvalidate('docs', 'knowledge')
  return useMutation({
    mutationFn: (id: Id) => commands.deleteDoc(id),
    onSuccess: invalidate,
  })
}

export function useAddKnowledgeSource() {
  const commands = useCommands()
  const invalidate = useInvalidate('knowledgeSources', 'knowledge')
  return useMutation({
    mutationFn: (input: AddKnowledgeSourceInput) => commands.addKnowledgeSource(input),
    onSuccess: invalidate,
  })
}

export function useDeleteKnowledgeSource() {
  const commands = useCommands()
  const invalidate = useInvalidate('knowledgeSources', 'knowledge')
  return useMutation({
    mutationFn: (id: Id) => commands.deleteKnowledgeSource(id),
    onSuccess: invalidate,
  })
}

export function useCreateLesson() {
  const commands = useCommands()
  const invalidate = useInvalidate('lessons')
  return useMutation({
    mutationFn: (input: CreateLessonInput) => commands.createLesson(input),
    onSuccess: invalidate,
  })
}

export function useUpdateLesson() {
  const commands = useCommands()
  const invalidate = useInvalidate('lessons')
  return useMutation({
    mutationFn: ({ id, text }: { id: Id; text: string }) => commands.updateLesson(id, { text }),
    onSuccess: invalidate,
  })
}

export function useConfirmLesson() {
  const commands = useCommands()
  const invalidate = useInvalidate('lessons')
  return useMutation({
    mutationFn: (id: Id) => commands.confirmLesson(id),
    onSuccess: invalidate,
  })
}

export function useForgetLesson() {
  const commands = useCommands()
  const invalidate = useInvalidate('lessons')
  return useMutation({
    mutationFn: (id: Id) => commands.forgetLesson(id),
    onSuccess: invalidate,
  })
}

export function useAsk() {
  const commands = useCommands()
  return useMutation({ mutationFn: (q: string) => commands.ask(q) })
}

export function useSaveHandbookFile() {
  const commands = useCommands()
  const invalidate = useInvalidate('handbook', 'docs')
  return useMutation({
    mutationFn: ({ name, input }: { name: string; input: SaveHandbookFileInput }) => commands.saveHandbookFile(name, input),
    onSuccess: invalidate,
  })
}

export function useSuggestHandbookEdit() {
  const commands = useCommands()
  const invalidate = useInvalidate('handbook')
  return useMutation({
    mutationFn: (input: SuggestHandbookEditInput) => commands.suggestHandbookEdit(input),
    onSuccess: invalidate,
  })
}

export function useResolveHandbookSuggestion() {
  const commands = useCommands()
  const invalidate = useInvalidate('handbook', 'docs')
  return useMutation({
    mutationFn: ({ id, accept }: { id: Id; accept: boolean }) =>
      accept ? commands.acceptHandbookSuggestion(id) : commands.dismissHandbookSuggestion(id),
    onSuccess: invalidate,
// ── sweep/goals-routines ──────────────────────────────────────────────────────

/** GET /v1/goals/{id} — goal + planned jobs + proposals (null when the repo lacks it). */
export function useGoalDetail(id: Id | null) {
    queryKey: ['goal', id],
    queryFn: () => (repos.goals.get ? repos.goals.get(id as Id) : Promise.resolve(null)),

/** POST /v1/goals/{id}/session — open (create once) the goal's session. */
export function useOpenGoalSession() {
    mutationFn: (goalId: Id) => commands.openGoalSession(goalId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goals'] })
      void qc.invalidateQueries({ queryKey: ['sessions'] })
    },

export function useReplanGoal() {
    mutationFn: (goalId: Id) => commands.replanGoal(goalId),
    onSuccess: (_r, goalId) => {
      void qc.invalidateQueries({ queryKey: ['goals'] })
      void qc.invalidateQueries({ queryKey: ['goal', goalId] })
    },

/** GET /v1/routines/schedule — Week view slots (empty when the repo lacks it). */
export function useRoutineSchedule(from: string, to: string) {
    queryKey: ['routines', 'schedule', from, to],
    queryFn: () =>
      repos.routines.schedule ? repos.routines.schedule(from, to) : Promise.resolve({ from, to, items: [] }),

/** GET /v1/routines/{id}/runs/{runId}; polls every 2s while the run is going. */
export function useRoutineRun(routineId: Id | null, runId: Id | null) {
    queryKey: ['routines', 'run', routineId, runId],
    queryFn: () =>
      repos.routines.run ? repos.routines.run(routineId as Id, runId as Id) : Promise.resolve(null),
    enabled: !!routineId && !!runId,
    refetchInterval: (q) => (q.state.data?.running ? 2000 : false),

export function useRoutineSuggestions() {
    queryKey: ['routines', 'suggestions'],
    queryFn: () => (repos.routines.suggestions ? repos.routines.suggestions() : Promise.resolve([])),

/** Invalidate everything routine-shaped after a write. */
function useInvalidateRoutines() {
  return (id?: Id) => {
    void qc.invalidateQueries({ queryKey: ['routines'] })
    if (id) void qc.invalidateQueries({ queryKey: ['routine', id] })

export function useRunRoutineNow() {
  const invalidate = useInvalidateRoutines()
    mutationFn: (id: Id) => commands.runRoutineNow(id),
    onSuccess: (_r, id) => invalidate(id),

export function useCancelJob() {
  const invalidate = useInvalidateRoutines()
    mutationFn: (jobId: Id) => commands.cancelJob(jobId),
    onSettled: () => invalidate(),

export function useRoutineRunFeedback() {
  const invalidate = useInvalidateRoutines()
    mutationFn: ({ runId, vote }: { runId: Id; vote: 'up' | 'down' | null }) =>
      commands.routineRunFeedback(runId, vote),
    onSuccess: () => invalidate(),

export function useResendRoutineRun() {
  const invalidate = useInvalidateRoutines()
    mutationFn: (runId: Id) => commands.resendRoutineRun(runId),
    onSuccess: () => invalidate(),

export function useApplyRoutineSuggestion() {
  const invalidate = useInvalidateRoutines()
    mutationFn: (id: string) => commands.applyRoutineSuggestion(id),
    onSuccess: () => invalidate(),

export function useDismissRoutineSuggestion() {
  const invalidate = useInvalidateRoutines()
    mutationFn: (id: string) => commands.dismissRoutineSuggestion(id),
    onSuccess: () => invalidate(),

/** POST /v1/routines/preview — read-like, so exposed as a query keyed by the draft. */
export function useRoutinePreview(input: import('../adapters/http/commands').PreviewRoutineInput | null) {
    queryKey: ['routines', 'preview', input],
    queryFn: () => commands.previewRoutine(input!),
    enabled: !!input && /^\d{1,2}:\d{2}$/.test(input.at),
    staleTime: 10_000,
// ── sweep/inbox-flows ──

/** Everything an inbox decision / flow approval can change. */
function invalidateDecisions(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['inbox'] })
  void qc.invalidateQueries({ queryKey: ['inboxItem'] })
  void qc.invalidateQueries({ queryKey: ['proposal'] })
  void qc.invalidateQueries({ queryKey: ['flows'] })
  void qc.invalidateQueries({ queryKey: ['flow'] })
  void qc.invalidateQueries({ queryKey: ['flowRuns'] })
  void qc.invalidateQueries({ queryKey: ['flowRun'] })
  void qc.invalidateQueries({ queryKey: ['flowVersions'] })

export function useMarkInboxRead() {
    mutationFn: (id: Id) => commands.markInboxRead(id),
      void qc.invalidateQueries({ queryKey: ['inbox'] })

export function useMarkAllInboxRead() {
    mutationFn: (before?: string) => commands.markAllInboxRead(before),
      void qc.invalidateQueries({ queryKey: ['inbox'] })

export function useProposal(id: Id | undefined) {
    queryKey: ['proposal', id],
    queryFn: () => repos.proposals?.get(id!) ?? Promise.resolve(null),

export function useUpdateProposal() {
    mutationFn: ({ id, input }: { id: Id; input: { assignee?: string | null; due?: string | null } }) =>
      commands.updateProposal(id, input),
    onSuccess: () => invalidateDecisions(qc),

export type ProposalDecision =
  | { kind: 'approve'; proposalId: Id; note?: string; params?: Record<string, unknown> }
  | { kind: 'reject'; proposalId: Id; note: string }
  | { kind: 'changes'; proposalId: Id; note: string }
  | { kind: 'undo'; proposalId: Id }
  | { kind: 'flowRun'; flowId: Id; runId: Id; approve: boolean }

/** Approve / reject / request changes / undo a proposal, or decide a waiting flow run. */
export function useDecide() {
    mutationFn: async (d: ProposalDecision): Promise<unknown> => {
      switch (d.kind) {
        case 'approve':
          return d.params
            ? commands.approveProposalAmended(d.proposalId, d.params, d.note)
            : commands.approveProposal(d.proposalId, d.note)
        case 'reject':
          return commands.rejectProposal(d.proposalId, d.note)
        case 'changes':
          return commands.requestChanges(d.proposalId, d.note)
        case 'undo':
          return commands.undoApproval(d.proposalId)
        case 'flowRun':
          return commands.decideFlowRun(d.flowId, d.runId, d.approve)
      }
    onSettled: () => invalidateDecisions(qc),

export function useFlowRun(flowId: Id, runId: Id | undefined, opts: { poll?: boolean } = {}) {
    queryKey: ['flowRun', flowId, runId],
    queryFn: () => repos.flows.run?.(flowId, runId!) ?? Promise.resolve(null),
    enabled: !!runId,
    refetchInterval: (q) => {
      const st = (q.state.data as { status?: string } | null | undefined)?.status
      return opts.poll && st === 'running' ? 1000 : false

export function useFlowVersions(flowId: Id) {
    queryKey: ['flowVersions', flowId],
    queryFn: () => repos.flows.versions?.(flowId) ?? Promise.resolve([]),

export function useFlowSuggestions() {
    queryKey: ['flowSuggestions'],
    queryFn: () => repos.flows.suggestions?.() ?? Promise.resolve([]),

export type FlowRunAction =
  | { kind: 'run'; flowId: Id }
  | { kind: 'test'; flowId: Id }
  | { kind: 'retry'; flowId: Id; runId: Id }
  | { kind: 'cancel'; flowId: Id; runId: Id }
  | { kind: 'decide'; flowId: Id; runId: Id; approve: boolean }

/** Start / test / retry / cancel / approve a flow run → the affected run's id. */
export function useFlowRunAction() {
    mutationFn: async (a: FlowRunAction): Promise<{ id: Id; status: string }> => {
      const run = (await (a.kind === 'run'
        ? commands.runFlow(a.flowId)
        : a.kind === 'test'
          ? commands.testRunFlow(a.flowId)
          : a.kind === 'retry'
            ? commands.retryFlowRun(a.flowId, a.runId)
            : a.kind === 'cancel'
              ? commands.cancelFlowRun(a.flowId, a.runId)
              : commands.decideFlowRun(a.flowId, a.runId, a.approve))) as { id: Id; status: string }
      return { id: run.id, status: run.status }
    onSettled: () => invalidateDecisions(qc),

export function usePublishFlow() {
    mutationFn: (id: Id) => commands.publishFlow(id) as Promise<{ id?: Id }>,
    onSettled: () => invalidateDecisions(qc),

export function useRestoreFlowVersion() {
    mutationFn: ({ flowId, version }: { flowId: Id; version: number }) => commands.restoreFlowVersion(flowId, version),
    onSettled: () => invalidateDecisions(qc),
export function useHelperTools(id: Id) {
  const repos = useRepos()
    queryKey: ['helperTools', id],
    queryFn: () => repos.helpers.tools?.(id) ?? Promise.resolve({ connectors: [], builtins: [] }),
    enabled: !!id,

export function useHelperSkillRows(id: Id) {
  const repos = useRepos()
    queryKey: ['helperSkills', id],
    queryFn: () => repos.helpers.skillRows?.(id) ?? Promise.resolve([]),
    enabled: !!id,

export function useHelperFiles(id: Id) {
  const repos = useRepos()
    queryKey: ['helperFiles', id],
    queryFn: () => repos.helpers.files?.(id) ?? Promise.resolve([]),
    enabled: !!id,

function invalidateHelper(qc: ReturnType<typeof useQueryClient>, id: Id) {
  void qc.invalidateQueries({ queryKey: ['helpers'] })
  void qc.invalidateQueries({ queryKey: ['helper', id] })
  void qc.invalidateQueries({ queryKey: ['helperDetail', id] })
  void qc.invalidateQueries({ queryKey: ['analyticsHelpers'] })

/** PATCH a helper and refresh roster, detail and analytics rows. */
export function useUpdateHelperEverywhere() {
    mutationFn: ({ id, input }: { id: Id; input: UpdateHelperInput }) => commands.updateHelper(id, input),
    onSuccess: (_d, { id }) => invalidateHelper(qc, id),

export function useRetireHelper() {
    mutationFn: (id: Id) => commands.retireHelper(id),
    onSuccess: (_d, id) => invalidateHelper(qc, id),

export function useAllowHelperJob() {
    mutationFn: (id: Id) => commands.allowHelperJob(id),
    onSuccess: (_d, id) => invalidateHelper(qc, id),

export function useConnectHelperChannel(helperId: Id) {
    mutationFn: (input: ConnectHelperChannelInput) => commands.connectHelperChannel(helperId, input),
      void qc.invalidateQueries({ queryKey: ['helperChannels', helperId] })
      void qc.invalidateQueries({ queryKey: ['helperDetail', helperId] })

export function useUpdateHelperChannel(helperId: Id) {
    mutationFn: ({ channelId, config }: { channelId: Id; config: Record<string, unknown> }) =>
      commands.updateHelperChannel(helperId, channelId, config),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['helperChannels', helperId] }) },

export function useDisconnectHelperChannel(helperId: Id) {
    mutationFn: (channelId: Id) => commands.disconnectHelperChannel(helperId, channelId),
      void qc.invalidateQueries({ queryKey: ['helperChannels', helperId] })
      void qc.invalidateQueries({ queryKey: ['helperDetail', helperId] })

export function useSetHelperTools(helperId: Id) {
    mutationFn: (input: SetHelperToolsInput) => commands.setHelperTools(helperId, input),
    onSuccess: (data) => {
      qc.setQueryData(['helperTools', helperId], data)
      void qc.invalidateQueries({ queryKey: ['helperDetail', helperId] })

export function useSetHelperSkills(helperId: Id) {
    mutationFn: (list: HelperSkillSetting[]) => commands.setHelperSkills(helperId, list),
    onSuccess: (data) => {
      qc.setQueryData(['helperSkills', helperId], data)
      void qc.invalidateQueries({ queryKey: ['helperDetail', helperId] })

export function useSaveHelperFile(helperId: Id) {
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      commands.saveHelperFile(helperId, name, content),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['helperFiles', helperId] }) },

export function useRetryJob() {
    mutationFn: (jobId: Id) => commands.retryJob(jobId),
      void qc.invalidateQueries({ queryKey: ['analyticsFailures'] })
      void qc.invalidateQueries({ queryKey: ['analyticsReliability'] })
      void qc.invalidateQueries({ queryKey: ['activity'] })
export function useFolderShares(id: Id, enabled = true) {
    queryKey: ['folderShares', id],
    queryFn: () => repos.chat?.folderShares(id) ?? Promise.resolve({ members: [] }),
    enabled: !!id && enabled,

export function useSessionShares(id: Id, enabled = true) {
    queryKey: ['sessionShares', id],
    queryFn: () => repos.chat?.sessionShares(id) ?? Promise.resolve({ members: [] }),
    enabled: !!id && enabled,

export function useSessionResults(id: Id, enabled = true) {
    queryKey: ['sessionResults', id],
    queryFn: () => repos.chat?.sessionResults(id) ?? Promise.resolve(EMPTY_RESULTS),
    enabled: !!id && enabled,

/** Apply a session patch to a cached list; `drop` removes it instead. */
function patchSessionList(list: SessionList | undefined, id: Id, patch: Partial<import('../core/domain/types').Session> | null, unset: string[] = []) {
  if (!list) return list
  if (patch === null) return list.filter((s) => s.id !== id)
  return list.map((s) => {
    if (s.id !== id) return s
    const next = { ...s, ...patch } as Record<string, unknown>
    for (const k of unset) delete next[k]
    return next as unknown as import('../core/domain/types').Session

export function useUpdateSession() {
    mutationFn: ({ id, input }: { id: Id; input: import('../adapters/http/commands').UpdateSessionInput }) =>
      commands.updateSession(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: ['sessions'] })
      const snapshot = qc.getQueriesData<SessionList>({ queryKey: ['sessions'] })
      const prevSession = qc.getQueryData(['session', id])
      const patch: Record<string, unknown> = {}
      const unset: string[] = []
      if (input.title !== undefined) patch.title = input.title
      if (input.folderId !== undefined) {
        if (input.folderId === null) unset.push('folderId')
        else patch.folderId = input.folderId
      if (input.pinned !== undefined) {
        if (input.pinned) patch.pinned = true
        else unset.push('pinned')
      if (input.model !== undefined) patch.model = input.model
      if (input.goalId === null) unset.push('goalId', 'goal')
      for (const [key, list] of snapshot) {
        const isArchivedList = key[1] === 'archived'
        const isChief = key[1] === 'chief'
        let next = list
        if (input.archived === true && !isArchivedList && !isChief) next = patchSessionList(list, id, null)
        else if (input.archived === false && isArchivedList) next = patchSessionList(list, id, null)
        else next = patchSessionList(list, id, patch, unset)
        qc.setQueryData(key, next)
      qc.setQueryData(['session', id], (s: unknown) =>
        s ? patchSessionList([s as import('../core/domain/types').Session], id, patch, unset)?.[0] : s,
      )
      return { snapshot, prevSession }
    onError: (_err, { id }, ctx) => {
      for (const [key, list] of ctx?.snapshot ?? []) qc.setQueryData(key, list)
      if (ctx) qc.setQueryData(['session', id], ctx.prevSession)
    onSettled: (_data, _err, { id }) => {
      void qc.invalidateQueries({ queryKey: ['session', id] })
      void qc.invalidateQueries({ queryKey: ['folders'] })
      void qc.invalidateQueries({ queryKey: ['folder'] })

export function useDeleteSession() {
    mutationFn: (id: Id) => commands.deleteSession(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['sessions'] })
      const snapshot = qc.getQueriesData<SessionList>({ queryKey: ['sessions'] })
      for (const [key, list] of snapshot) qc.setQueryData(key, patchSessionList(list, id, null))
      return { snapshot }
    onError: (_e, _id, ctx) => {
      for (const [key, list] of ctx?.snapshot ?? []) qc.setQueryData(key, list)
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['folders'] })

export function useDeleteArchivedSessions() {
    mutationFn: (channelId?: Id) => commands.deleteArchivedSessions(channelId),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['sessions'] }) },

export function useSetSessionShares() {
    mutationFn: ({ id, input }: { id: Id; input: import('../adapters/http/commands').SetSharesInput }) =>
      commands.setSessionShares(id, input),
    onSuccess: (data, { id }) => { qc.setQueryData(['sessionShares', id], data) },

export function useCreateFolder() {
    mutationFn: (input: import('../adapters/http/commands').CreateFolderInput) => commands.createFolder(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['folders'] }) },

export function useUpdateFolder() {
    mutationFn: ({ id, input }: { id: Id; input: import('../adapters/http/commands').UpdateFolderInput }) =>
      commands.updateFolder(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: ['folders'] })
      const snapshot = qc.getQueriesData<FolderList>({ queryKey: ['folders'] })
      const apply = (f: import('../core/domain/types').Folder) => {
        const next = { ...f } as Record<string, unknown>
        for (const k of ['name', 'icon', 'color', 'instructions'] as const) {
          const v = input[k]
          if (v === undefined) continue
          if (v === null || v === '') delete next[k]
          else next[k] = v
        }
        return next as unknown as import('../core/domain/types').Folder
      for (const [key, list] of snapshot) qc.setQueryData(key, list?.map((f) => (f.id === id ? apply(f) : f)))
      const prevFolder = qc.getQueryData<import('../core/domain/types').Folder | null>(['folder', id])
      if (prevFolder) qc.setQueryData(['folder', id], apply(prevFolder))
      return { snapshot, prevFolder }
    onError: (_e, { id }, ctx) => {
      for (const [key, list] of ctx?.snapshot ?? []) qc.setQueryData(key, list)
      if (ctx?.prevFolder) qc.setQueryData(['folder', id], ctx.prevFolder)
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: ['folders'] })
      void qc.invalidateQueries({ queryKey: ['folder', id] })

export function useDeleteFolder() {
    mutationFn: (id: Id) => commands.deleteFolder(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['folders'] })
      const snapshot = qc.getQueriesData<FolderList>({ queryKey: ['folders'] })
      for (const [key, list] of snapshot) qc.setQueryData(key, list?.filter((f) => f.id !== id))
      return { snapshot }
    onError: (_e, _id, ctx) => {
      for (const [key, list] of ctx?.snapshot ?? []) qc.setQueryData(key, list)
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['folders'] })

export function useAddFolderFile() {
    mutationFn: ({ folderId, input }: { folderId: Id; input: import('../adapters/http/commands').AddFolderFileInput }) =>
      commands.addFolderFile(folderId, input),
    onSuccess: (_d, { folderId }) => { void qc.invalidateQueries({ queryKey: ['folderFiles', folderId] }) },

export function useRemoveFolderFile() {
    mutationFn: ({ folderId, fileId }: { folderId: Id; fileId: Id }) => commands.removeFolderFile(folderId, fileId),
    onSuccess: (_d, { folderId }) => { void qc.invalidateQueries({ queryKey: ['folderFiles', folderId] }) },

export function useSetFolderShares() {
    mutationFn: ({ id, input }: { id: Id; input: import('../adapters/http/commands').SetSharesInput }) =>
      commands.setFolderShares(id, input),
    onSuccess: (data, { id }) => { qc.setQueryData(['folderShares', id], data) },

export function useUpdateArea() {
    mutationFn: ({ id, input }: { id: Id; input: import('../adapters/http/commands').UpdateAreaInput }) =>
      commands.updateArea(id, input),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: ['channels'] })
      const prev = qc.getQueryData<ChannelList>(['channels'])
      const prevOne = qc.getQueryData<import('../core/domain/types').Channel | null>(['channel', id])
      const apply = (c: import('../core/domain/types').Channel) => {
        const next = { ...c } as Record<string, unknown>
        for (const k of ['name', 'purpose', 'icon', 'color'] as const) {
          const v = input[k]
          if (v === undefined) continue
          if (v === null || v === '') delete next[k]
          else next[k] = v
        }
        return next as unknown as import('../core/domain/types').Channel
      if (prev) qc.setQueryData(['channels'], prev.map((c) => (c.id === id ? apply(c) : c)))
      if (prevOne) qc.setQueryData(['channel', id], apply(prevOne))
      return { prev, prevOne }
    onError: (_e, { id }, ctx) => {
      if (ctx?.prev) qc.setQueryData(['channels'], ctx.prev)
      if (ctx?.prevOne) qc.setQueryData(['channel', id], ctx.prevOne)
    onSettled: (_d, _e, { id }) => {
      void qc.invalidateQueries({ queryKey: ['channels'] })
      void qc.invalidateQueries({ queryKey: ['channel', id] })

export function useDismissChiefNudge() {
    mutationFn: ({ id, snoozeUntil }: { id: Id; snoozeUntil?: string }) => commands.dismissChiefNudge(id, snoozeUntil),
    onMutate: ({ id }) => {
      const prev = qc.getQueryData<import('../core/domain/types').ChiefNudge[]>(['chiefNudges'])
      if (prev) qc.setQueryData(['chiefNudges'], prev.filter((n) => n.id !== id))
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['chiefNudges'] }) },

/**
 * Start a chat: create the session (area / folder / goal / model / kind) and,
 * when there is a first message, send it. Returns the session.
 */
export function useStartChat() {
    mutationFn: async ({ input, text }: { input: import('../adapters/http/commands').CreateSessionInput; text?: string }) => {
      const session = await commands.createSession(input)
      if (text && text.trim()) await commands.sendMessage(session.id, text.trim(), { model: input.model })
      return session
    onSuccess: (session) => {
      void qc.invalidateQueries({ queryKey: ['folders'] })
      void qc.invalidateQueries({ queryKey: ['messages', session.id] })
  })
}
// ── sweep/control ──
// Control-panel reads + mutations. Reads go through repos.controlPanel (HTTP
// or mock); it is optional on Repos so hand-built test repos keep compiling —
// a missing repo surfaces as a query error (sections render their error state).

import type { AuditQuery, UserPreferences } from '../core/domain/controlPanel'
import type { ControlPanelRepo } from '../core/ports/repos'
  CreateMcpServerFromOpenApiInput,
  CreateMcpServerInput,
  CreateSkillInput,
  UpdateAiAccountInput,
  UpdateChannelInput,
  UpdateMemberInput,
  UpdateSkillInput,

function cp(repos: ReturnType<typeof useRepos>): ControlPanelRepo {
  if (!repos.controlPanel) throw new Error('Control panel data is unavailable.')
  return repos.controlPanel

export function useCompanyDetail() {
  return useQuery({ queryKey: ['companyDetail'], queryFn: () => cp(repos).company() })

export function useSeats() {
  return useQuery({ queryKey: ['seats'], queryFn: () => cp(repos).seats() })

export function useCreditPacks() {
  return useQuery({ queryKey: ['creditPacks'], queryFn: () => cp(repos).packs(), staleTime: 300_000 })

export function useInvoices() {
  return useQuery({ queryKey: ['invoices'], queryFn: () => cp(repos).invoices() })

export function useLedger() {
  return useQuery({ queryKey: ['ledger'], queryFn: () => cp(repos).ledger() })

/** Poll a pending payment (hosted checkout) until it settles. */
export function usePayment(id: string | null) {
    queryKey: ['payment', id],
    queryFn: () => cp(repos).payment(id as string),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'pending' ? false : 5_000),

export function useWallet() {
  return useQuery({ queryKey: ['wallet'], queryFn: () => repos.wallet.get() })

export function useInvites() {
  return useQuery({ queryKey: ['invites'], queryFn: () => cp(repos).invites() })

export function useManagedChannels() {
  return useQuery({ queryKey: ['managedChannels'], queryFn: () => cp(repos).channels() })

export function useAuditLog(query: AuditQuery) {
  return useQuery({ queryKey: ['audit', query], queryFn: () => cp(repos).audit(query) })

export function useStorage() {
  return useQuery({ queryKey: ['storage'], queryFn: () => cp(repos).storage() })

export function useDataExports() {
  return useQuery({ queryKey: ['dataExports'], queryFn: () => cp(repos).exports() })

export function useAccount() {
  return useQuery({ queryKey: ['account'], queryFn: () => cp(repos).account() })

export function usePreferences() {
  return useQuery({ queryKey: ['preferences'], queryFn: () => cp(repos).preferences() })

export function useSignInSessions() {
  return useQuery({ queryKey: ['signInSessions'], queryFn: () => cp(repos).sessions() })

export function useMcpServers() {
  return useQuery({ queryKey: ['mcpServers'], queryFn: () => cp(repos).mcpServers() })

export function useTelemetryOptedOut() {
  return useQuery({ queryKey: ['telemetryOptedOut'], queryFn: () => cp(repos).telemetryOptedOut() })

/** Small helper: a mutation that invalidates the given query keys on success. */
function useInvalidatingMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  keys: string[][],
) {
    mutationFn: fn,
      for (const k of keys) void qc.invalidateQueries({ queryKey: k })

export function useUploadCompanyLogo() {
  const c = useCommands()
  return useInvalidatingMutation((dataUrl: string) => c.uploadCompanyLogo(dataUrl), [['companyDetail']])

export function useUpdateMember() {
  const c = useCommands()
  return useInvalidatingMutation(
    ({ id, input }: { id: string; input: UpdateMemberInput }) => c.updateMember(id, input),
    [['members'], ['seats'], ['managedChannels']],
  )

export function useRevokeInvite() {
  const c = useCommands()
  return useInvalidatingMutation((id: string) => c.revokeInvite(id), [['invites'], ['seats']])

export function useResendInvite() {
  const c = useCommands()
  return useInvalidatingMutation((id: string) => c.resendInvite(id), [['invites']])

export function useBuySeats() {
  const c = useCommands()
  return useInvalidatingMutation((count: number) => c.buySeats(count), [['seats'], ['billingSubscription']])

export function useUpdateChannel() {
  const c = useCommands()
  return useInvalidatingMutation(
    ({ id, input }: { id: string; input: UpdateChannelInput }) => c.updateChannel(id, input),
    [['managedChannels'], ['channels']],
  )

export function useDeleteChannel() {
  const c = useCommands()
  return useInvalidatingMutation((id: string) => c.deleteChannel(id), [['managedChannels'], ['channels']])

export function useUpdateAiAccount() {
  const c = useCommands()
  return useInvalidatingMutation(
    ({ id, input }: { id: string; input: UpdateAiAccountInput }) => c.updateAiAccount(id, input),
    [['aiAccounts']],
  )

export function useReauthConnector() {
  const c = useCommands()
  return useInvalidatingMutation((id: string) => c.reauthConnector(id), [['connectors']])

export function useCreateMcpServer() {
  const c = useCommands()
  return useInvalidatingMutation((input: CreateMcpServerInput) => c.createMcpServer(input), [['mcpServers']])

export function useCreateMcpServerFromOpenApi() {
  const c = useCommands()
  return useInvalidatingMutation(
    (input: CreateMcpServerFromOpenApiInput) => c.createMcpServerFromOpenApi(input),
    [['mcpServers']],
  )

export function useDeleteMcpServer() {
  const c = useCommands()
  return useInvalidatingMutation((id: string) => c.deleteMcpServer(id), [['mcpServers']])

export function useCreateSkill() {
  const c = useCommands()
  return useInvalidatingMutation((input: CreateSkillInput) => c.createSkill(input), [['skills']])

export function useUpdateSkill() {
  const c = useCommands()
  return useInvalidatingMutation(
    ({ id, input }: { id: string; input: UpdateSkillInput }) => c.updateSkill(id, input),
    [['skills']],
  )

export function usePublishSkill() {
  const c = useCommands()
  return useInvalidatingMutation((id: string) => c.publishSkill(id), [['skills'], ['inbox']])

export function useUpdatePreferences() {
  const c = useCommands()
  return useInvalidatingMutation((patch: UserPreferences) => c.updatePreferences(patch), [['preferences']])

export function useSetTwoFactor() {
  const c = useCommands()
  return useInvalidatingMutation((enabled: boolean) => c.setTwoFactor(enabled), [['account']])

export function useRevokeSession() {
  const c = useCommands()
  return useInvalidatingMutation((id: string) => c.revokeSession(id), [['signInSessions']])

export function useUploadAvatar() {
  const c = useCommands()
  return useInvalidatingMutation((dataUrl: string) => c.uploadAvatar(dataUrl), [['account'], ['members']])

export function useCreateDataExport() {
  const c = useCommands()
  return useInvalidatingMutation(() => c.createDataExport(), [['dataExports'], ['storage']])

export function useSetTelemetryOptOut() {
  const c = useCommands()
  return useInvalidatingMutation((optedOut: boolean) => c.setTelemetryOptOut(optedOut), [['telemetryOptedOut']])

export function useInstallConnector() {
  const c = useCommands()
  return useInvalidatingMutation((pieceId: string) => c.installConnector(pieceId), [['connectors']])

export function useUpdateConnector() {
  const c = useCommands()
  return useInvalidatingMutation(
    ({ id, enabled }: { id: string; enabled: boolean }) => c.updateConnector(id, { enabled }),
    [['connectors']],
  )

export function useConnectorCredentials() {
  const c = useCommands()
  return useInvalidatingMutation(
    ({ id, fields }: { id: string; fields: Record<string, string> }) => c.connectorCredentials(id, fields),
    [['connectors']],
  )

export function useDisconnectConnector() {
  const c = useCommands()
  return useInvalidatingMutation((id: string) => c.disconnectConnector(id), [['connectors']])

export function useRefreshMarketplace() {
  const c = useCommands()
  return useInvalidatingMutation(() => c.refreshMarketplace(), [['marketplace']])

export function useMintMcpToken() {
  const c = useCommands()
  return useInvalidatingMutation(
    (input: { label: string; helperId: string; scopes: string[] }) => c.mintMcpToken(input),
    [['mcpTokens']],
  )

export function useRevokeMcpToken() {
  const c = useCommands()
  return useInvalidatingMutation((id: string) => c.revokeMcpToken(id), [['mcpTokens']])

export function useUpdateCompanyProfile() {
  const c = useCommands()
  return useInvalidatingMutation(
    (input: Parameters<ReturnType<typeof useCommands>['updateCompanyProfile']>[0]) => c.updateCompanyProfile(input),
    [['companyDetail']],
  )
