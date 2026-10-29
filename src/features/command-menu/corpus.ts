/**
 * Live ⌘K corpus — built client-side from the cached queries so every result
 * routes to the actual record (chat, goal, flow, doc, helper, private Chief chat).
 */
import { useMemo } from 'react'
import type { FlowRun } from '../../core/domain/types'
import {
  useAllFlowRuns,
  useAreas,
  useChiefThreads,
  useFlows,
  useGoals,
  useHelpers,
  useInbox,
  useKnowledgeSources,
  useSessions,
} from '../../app/queries'
import { useUIStore } from '../../app/store'
import { ACTIONS, PAGES, SETTINGS } from './data'
import type { Corpus, Item, Preview } from './data'

function runTime(r: FlowRun): string {
  if (r.status === 'running') return 'now'
  const iso = r.endedAt ?? r.startedAt
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function previewStatus(s: string): 'done' | 'running' | 'failed' {
  if (s === 'running' || s === 'waiting' || s === 'queued') return 'running'
  if (s === 'failed' || s === 'error' || s === 'cancelled') return 'failed'
  return 'done'
}

export function useCommandCorpus(): Corpus {
  const { data: sessions = [] } = useSessions(null)
  const { data: chief = [] } = useChiefThreads()
  const { data: goals = [] } = useGoals(null)
  const { data: flows = [] } = useFlows()
  const { runs } = useAllFlowRuns(flows)
  const { data: helpers = [] } = useHelpers()
  const { data: docs = [] } = useKnowledgeSources()
  const { data: inbox = [] } = useInbox()
  const { data: areas = [] } = useAreas()
  const mode = useUIStore((s) => s.mode)

  return useMemo<Corpus>(() => {
    const areaName = (id?: string) => (id ? areas.find((a) => a.id === id)?.name : undefined)
    const needsYou = inbox.filter((i) => i.needsYou).length
    const nameOfFlow = (id: string) => flows.find((f) => f.id === id)?.title ?? 'Flow'

    const lastRuns = [...runs]
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
      .slice(0, 3)
      .map((r) => ({ status: previewStatus(r.status), name: nameOfFlow(r.flowId), time: runTime(r) }))
    const flowsPreview: Preview = {
      icon: 'workflow',
      title: 'Flows',
      sub: 'Office · company-wide',
      stats: [
        { value: String(flows.length), label: 'flows' },
        { value: String(runs.filter((r) => previewStatus(r.status) === 'running').length), label: 'running' },
        { value: String(flows.filter((f) => f.enabled).length), label: 'on' },
      ],
      listLabel: 'LAST RUNS',
      list: lastRuns,
      askLabel: 'Ask Chief about flows',
    }

    const pages: Item[] = PAGES.map((p) => {
      if (p.id === 'p-inbox') return { ...p, meta: needsYou ? `${needsYou} need you` : 'Nothing needs you' }
      if (p.id === 'p-team') return { ...p, meta: `${helpers.length} helper${helpers.length === 1 ? '' : 's'}` }
      if (p.id === 'p-flows') return { ...p, preview: flowsPreview }
      return p
    })

    const chats: Item[] = sessions.map((s) => ({
      id: `c-${s.id}`,
      group: 'CHATS',
      icon: 'message-circle',
      label: s.title,
      meta: [areaName(s.channelId) ? `#${areaName(s.channelId)!.toLowerCase()}` : null, s.updated].filter(Boolean).join(' · '),
      keywords: s.goal,
      run: { kind: 'go', to: `/chat/${s.id}` },
    }))
    const chiefChats: Item[] = chief.map((t) => ({
      id: `cp-${t.id}`,
      group: 'CHATS',
      icon: 'lock',
      label: t.title,
      meta: 'Private chat with Chief',
      keywords: 'chief private',
      run: { kind: 'chief', threadId: t.id },
    }))
    const goalItems: Item[] = goals.map((g) => ({
      id: `g-${g.id}`,
      group: 'GOALS',
      icon: 'target',
      label: g.title,
      meta: `Goal · ${g.progress}%${areaName(g.channelId) ? ` · ${areaName(g.channelId)}` : ''}`,
      run: { kind: 'go', to: '/goals' },
    }))
    const flowItems: Item[] = flows.map((f) => ({
      id: `f-${f.id}`,
      group: 'FLOWS',
      icon: 'workflow',
      label: f.title,
      meta: `${f.enabled ? 'On' : 'Off'} · ${f.count} step${f.count === 1 ? '' : 's'}`,
      hint: runs.some((r) => r.flowId === f.id && previewStatus(r.status) === 'running') ? 'Running' : undefined,
      keywords: 'flow',
      run: { kind: 'go', to: `/flows/${f.id}/canvas` },
    }))
    const docItems: Item[] = docs.map((d) => ({
      id: `d-${d.id}`,
      group: 'DOCS',
      icon: 'file-text',
      label: d.title,
      meta: `Docs · ${d.kind}`,
      run: { kind: 'go', to: '/docs' },
    }))
    const helperItems: Item[] = helpers.map((h) =>
      h.isChief
        ? { id: `h-${h.id}`, group: 'HELPERS', helper: h.area, label: h.name, meta: h.role ?? 'Chief of Staff', run: { kind: 'chief' } }
        : { id: `h-${h.id}`, group: 'HELPERS', helper: h.area, label: h.name, meta: h.role ?? h.area, run: { kind: 'go', to: `/team/${h.id}` } },
    )

    const actions = ACTIONS.map((a) =>
      a.id === 'a-mode' ? { ...a, label: mode === 'chat' ? 'Switch to Office mode' : 'Switch to Chat mode' } : a,
    )
    const recent = [...chiefChats.slice(0, 1), ...chats.slice(0, 3)]
    const jumpTo = pages.filter((p) => ['p-inbox', 'p-goals', 'p-flows', 'p-team'].includes(p.id)).concat(SETTINGS[0])

    return {
      recent,
      jumpTo,
      actions: actions.filter((a) => ['a-chat', 'a-goal', 'a-chief', 'a-mode'].includes(a.id)),
      all: [...pages, ...flowItems, ...goalItems, ...actions, ...docItems, ...chats, ...chiefChats, ...helperItems, ...SETTINGS],
    }
  }, [sessions, chief, goals, flows, runs, helpers, docs, inbox, areas, mode])
}
