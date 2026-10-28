import { useQueries, useQuery } from '@tanstack/react-query'
import type { Flow, Id } from '../core/domain/types'
import { useRepos } from './ReposProvider'

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
  })
}
