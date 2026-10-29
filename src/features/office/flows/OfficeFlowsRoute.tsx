// ── Office Flows: List + New Flow dialog ─────────────────────────────────────
// Matches design ref: Cv9lg.png (company-wide flows list + new-flow panel)

import { useMemo, useState } from 'react'
import { SegmentedTabs } from '../../../ui/ds/Segmented'
import { Drawer } from '../../../ui/ds/Drawer'
import { Copy, GitFork, History, Link, Pause, Play, Plus, Power, Settings2, Sparkles, Trash2, Workflow } from 'lucide-react'
import { ContextMenuArea, MoreMenu, copyText } from '../../../ui/ds/ItemMenu'
import type { MenuEntries } from '../../../ui/ds/ItemMenu'
import { notify } from '../../../ui/ds/Toaster'
import { useFlowStore } from './editor/store'
import { draftGraph, flowToCard, useFlowBoard } from './boardStore'
import type { FlowCard } from './boardStore'
import type { Flow, FlowSuggestion } from '../../../core/domain/types'
import { officeRunRow, runsStats, sortRunsByStartedDesc } from './runsAdapter'
import { useNavigate } from '@tanstack/react-router'
import {
  useAllFlowRuns,
  useArea,
  useAreas,
  useCreateFlow,
  useDeleteFlow,
  useDuplicateFlow,
  useFlowSuggestions,
  useFlows,
  useHelpers,
  useUpdateFlow,
} from '../../../app/queries'
import type { CreateFlowInput } from '../../../adapters/http/commands'
import { useUIStore } from '../../../app/store'
import { Button } from '../../../ui/ds/Button'
import { Topbar } from '../../../ui/ds/Frame'
import { Mascot } from '../../../ui/ds/Mascot'
import { FlowChain } from '../../../ui/ds/FlowChain'
import type { FlowIconId } from '../../../ui/ds/FlowChain'
import { TEMPLATES } from './data'
import type { FlowTab, TemplateFlow } from './data'
import { RunStatusChip, Sparkline, Toggle } from './shared'

/** "Use" on a template → a draft flow body (trigger → AI step → app). */
function templateBody(t: TemplateFlow): CreateFlowInput {
  return {
    title: t.title,
    trigger: { kind: t.from === 'clock' ? 'schedule' : 'manual', spec: t.from === 'clock' ? { cron: '0 9 * * 1' } : {} },
    ...draftGraph(t.title, [t.desc.replace(/\.$/, '')], t.from, t.to),
    areas: [],
  }
}

/** "Create" on a suggestion → its server-built draft. */
function suggestionBody(s: FlowSuggestion): CreateFlowInput {
  return { title: s.draft.title, trigger: s.draft.trigger, nodes: s.draft.nodes, edges: s.draft.edges, areas: [] }
}

// ── FlowCard ──────────────────────────────────────────────────────────────────

function FlowCardItem({ card, onClick }: { card: FlowCard; onClick?: () => void }) {
  const navigate = useNavigate()
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const enabled = optimistic ?? card.enabled
  const { startTest } = useFlowStore()
  const { scheduleDelete, restore } = useFlowBoard()
  const duplicateFlow = useDuplicateFlow()
  const deleteFlow = useDeleteFlow()
  const updateFlow = useUpdateFlow()
  const go = (to: '/flows/$flowId/canvas' | '/flows/$flowId/runs' | '/flows/$flowId/settings') =>
    void navigate({ to, params: { flowId: card.id } })

  function setEnabled(on: boolean, toast?: boolean) {
    setOptimistic(on)
    updateFlow.mutate(
      { id: card.id, input: { enabled: on } },
      {
        onSuccess: () => {
          if (toast) notify(on ? `${card.title} is on` : `${card.title} paused`, on ? undefined : () => setEnabled(true))
        },
        onError: () => notify('Could not change the flow — try again'),
        onSettled: () => setOptimistic(null),
      },
    )
  }

  const menu: MenuEntries = [
    { label: 'Open canvas', icon: Workflow, onSelect: () => go('/flows/$flowId/canvas') },
    { label: 'View runs', icon: History, onSelect: () => go('/flows/$flowId/runs') },
    { label: 'Settings', icon: Settings2, onSelect: () => go('/flows/$flowId/settings') },
    { type: 'separator' },
    {
      label: 'Test run',
      icon: Play,
      onSelect: () => {
        // The canvas performs the real POST /test-run and shows the result sheet.
        startTest(card.id)
        go('/flows/$flowId/canvas')
      },
    },
    enabled
      ? { label: 'Pause flow', icon: Pause, onSelect: () => setEnabled(false, true) }
      : { label: 'Turn on', icon: Power, onSelect: () => setEnabled(true, true) },
    {
      label: 'Duplicate',
      icon: Copy,
      onSelect: () =>
        duplicateFlow.mutate(
          {
            title: card.title,
            trigger: card.trigger ?? { kind: 'manual', spec: {} },
            nodes: card.nodes ?? [],
            edges: card.edges ?? [],
            areas: card.areas ?? [],
            channelIds: card.channelIds,
          },
          { onSuccess: (c) => notify(`Made “${c.title}”`) },
        ),
    },
    { label: 'Copy link', icon: Link, onSelect: () => { copyText(`${location.origin}/flows/${card.id}/canvas`); notify('Link copied') } },
    { type: 'separator' },
    {
      label: 'Delete flow',
      icon: Trash2,
      danger: true,
      onSelect: () => {
        // Hide now; the server delete waits out the Undo window so Undo is real.
        scheduleDelete(card.id, () =>
          deleteFlow.mutate(card.id, {
            onError: () => {
              restore(card.id)
              notify('Could not delete the flow')
            },
          }),
        )
        notify('Flow deleted', () => restore(card.id))
      },
    },
  ]

  return (
    <ContextMenuArea items={menu} label={`${card.title} actions`}>
      <div className="group/card relative flex w-full flex-col gap-[10px] rounded-lg bg-surface p-[14px] text-left outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft data-[state=open]:bg-soft">
        <button type="button" aria-label={card.title} onClick={onClick} className="absolute inset-0 rounded-lg" />
        <div className="pointer-events-none relative flex items-center justify-between">
          <FlowChain from={card.from} to={card.to} count={card.count} />
          <span className="pointer-events-auto flex items-center gap-[6px]">
            <span className="hidden group-hover/card:flex group-focus-within/card:flex has-[[data-state=open]]:flex">
              <MoreMenu items={menu} label={`${card.title} actions`} size={22} />
            </span>
            <button
              type="button"
              aria-label={enabled ? `Pause ${card.title}` : `Turn on ${card.title}`}
              onClick={() => setEnabled(!enabled)}
              className="flex rounded-pill"
            >
              <Toggle on={enabled} />
            </button>
          </span>
        </div>
        <span className="pointer-events-none relative text-[13px] font-medium text-ink">{card.title}</span>
        <div className="pointer-events-none relative flex items-end justify-between gap-[8px]">
          <span className="text-[11.5px] text-muted">{enabled ? card.statusLabel : `Paused · ${card.statusLabel}`}</span>
          <Sparkline bars={card.bars} />
        </div>
      </div>
    </ContextMenuArea>
  )
}

// ── SuggestedCard ─────────────────────────────────────────────────────────────

function SuggestedCard({ item, onCreate }: { item: FlowSuggestion; onCreate?: () => void }) {
  return (
    <div className="flex flex-col gap-[10px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-soft p-[14px]">
      {/* chain + suggesting helper */}
      <div className="flex items-center justify-between">
        <FlowChain from={item.from as FlowIconId} to={item.to as FlowIconId} count={item.count} />
        <Mascot size={22} radius={6} area={item.helperArea} title={item.runsAs} />
      </div>
      <span className="text-[13px] font-medium text-ink">{item.title}</span>
      <div className="flex items-center justify-between gap-[8px]">
        <span className="flex min-w-0 items-center gap-[5px] text-[11.5px] text-muted">
          <Sparkles size={12} aria-hidden className="shrink-0 text-[#4338CA]" />
          <span className="truncate">{item.sub}</span>
        </span>
        <Button variant="primary" height={28} icon={Plus} onClick={onCreate}>Create</Button>
      </div>
      <span className="text-[11.5px] text-faint">{item.hint}</span>
    </div>
  )
}

// ── NewFlowCard ───────────────────────────────────────────────────────────────

function NewFlowCard({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-[8px] rounded-lg border-2 border-dashed border-line-strong p-[14px] min-h-[120px] text-center transition-colors hover:bg-soft w-full"
    >
      <span className="flex size-[28px] items-center justify-center rounded-full bg-line-strong">
        <Plus size={14} aria-hidden className="text-muted" />
      </span>
      <span className="text-[12.5px] text-muted">New flow</span>
      <span className="text-[11.5px] text-faint">Describe it — Chief drafts it</span>
    </button>
  )
}

// ── TemplateCard ─────────────────────────────────────────────────────────────

function TemplateCard({ t, onUse }: { t: (typeof TEMPLATES)[number]; onUse?: () => void }) {
  return (
    <div className="flex flex-col gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[12px]">
      <div className="flex items-start justify-between gap-[8px]">
        <FlowChain from={t.from} to={t.to} count={t.count} />
        <button
          type="button"
          aria-label={`Use ${t.title}`}
          onClick={onUse}
          className="flex size-[22px] shrink-0 items-center justify-center rounded-base outline-1 -outline-offset-1 outline-line-strong text-muted transition-colors hover:bg-soft"
        >
          <Plus size={13} aria-hidden />
        </button>
      </div>
      <span className="text-[12.5px] font-medium text-ink">{t.title}</span>
      <span className="text-[11.5px] text-muted">{t.desc}</span>
    </div>
  )
}

// ── YoursTab ──────────────────────────────────────────────────────────────────

function YoursTab({
  liveFlows,
  suggestions,
  loading,
  error,
  onCardClick,
  onNewClick,
  onTemplateUse,
  onSuggestedCreate,
}: {
  liveFlows: Flow[]
  suggestions: FlowSuggestion[]
  loading: boolean
  error: boolean
  onCardClick?: (flowId: string) => void
  onNewClick?: () => void
  onTemplateUse?: (template: TemplateFlow) => void
  onSuggestedCreate?: (s: FlowSuggestion) => void
}) {
  const { deleted } = useFlowBoard()

  if (error) {
    return <div className="px-[24px] py-[20px] text-[13px] text-bad">Failed to load flows. Please refresh to try again.</div>
  }
  if (loading) {
    return <div className="px-[24px] py-[20px] text-[13px] text-muted">Loading flows…</div>
  }

  const now = Date.now()
  const cards = liveFlows.map((f) => flowToCard(f, now)).filter((c) => !deleted.includes(c.id))

  if (cards.length === 0) {
    return (
      <div className="flex flex-col gap-[20px]">
        <div className="grid grid-cols-3 gap-[12px]">
          <div className="col-span-3 py-[24px] text-center text-[13px] text-muted">No flows yet</div>
          {suggestions.map((item) => (
            <SuggestedCard key={item.id} item={item} onCreate={() => onSuggestedCreate?.(item)} />
          ))}
          <NewFlowCard onClick={onNewClick} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="grid grid-cols-3 gap-[12px]">
        {cards.map((card) => (
          <FlowCardItem key={card.id} card={card} onClick={() => onCardClick?.(card.id)} />
        ))}
        {suggestions.map((item) => (
          <SuggestedCard key={item.id} item={item} onCreate={() => onSuggestedCreate?.(item)} />
        ))}
        <NewFlowCard onClick={onNewClick} />
      </div>

      {/* Templates row */}
      <div className="flex flex-col gap-[10px]">
        <span className="text-[12px] font-medium text-muted">Start from a template</span>
        <div className="flex gap-[10px] overflow-x-auto pb-[4px]">
          {TEMPLATES.slice(0, 4).map((t) => (
            <div
              key={t.id}
              className="flex min-w-[200px] shrink-0 items-center justify-between gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface px-[12px] py-[8px]"
            >
              <div className="flex items-center gap-[8px]">
                <FlowChain from={t.from} to={t.to} count={t.count} />
                <span className="text-[12px] text-ink-2">{t.title}</span>
              </div>
              <button
                type="button"
                aria-label={`Use ${t.title}`}
                onClick={() => onTemplateUse?.(t)}
                className="flex size-[20px] shrink-0 items-center justify-center rounded-base outline-1 -outline-offset-1 outline-line-strong text-muted transition-colors hover:bg-soft"
              >
                <Plus size={12} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── SuggestedTab ──────────────────────────────────────────────────────────────

function SuggestedTab({
  suggestions,
  loading,
  onCreateFlow,
}: {
  suggestions: FlowSuggestion[]
  loading: boolean
  onCreateFlow?: (s: FlowSuggestion) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-[12px]">
      <p className="text-[13px] text-muted">
        Helpers look at the apps and routines you already have and propose flows. Nothing runs until you create it.
      </p>
      {loading && <p className="m-0 text-[13px] text-muted">Loading suggestions…</p>}
      {!loading && suggestions.length === 0 && (
        <p className="m-0 text-[13px] text-muted">No suggestions right now — connect an app or add a routine and check back.</p>
      )}
      {suggestions.map((s) => (
        <div
          key={s.id}
          className="flex flex-col gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[14px]"
        >
          <div className="flex items-start justify-between gap-[12px]">
            <div className="flex items-center gap-[10px] min-w-0">
              <Mascot size={28} radius={8} area={s.helperArea} />
              <div className="flex flex-col gap-[2px] min-w-0">
                <span className="text-[13px] font-medium text-ink">{s.title}</span>
                <span className="text-[11.5px] text-muted">{s.sub}</span>
              </div>
            </div>
            <div className="flex gap-[6px] shrink-0">
              <Button variant="secondary" height={28} aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                Preview
              </Button>
              <Button variant="primary" height={28} icon={Plus} onClick={() => onCreateFlow?.(s)}>Create flow</Button>
            </div>
          </div>
          <span className="text-[11.5px] text-faint">{s.hint}</span>
          {open === s.id && (
            <ol className="m-0 flex list-decimal flex-col gap-[2px] pl-[18px] text-[12.5px] text-ink-2">
              {(s.draft.nodes as { id: string; label?: string }[]).map((n) => (
                <li key={n.id}>{n.label ?? n.id}</li>
              ))}
            </ol>
          )}
          {/* Area + Runs as */}
          <div className="flex items-center gap-[16px] pt-[4px]">
            <span className="text-[11.5px] text-faint">Area</span>
            <span className="inline-flex items-center gap-[5px] text-[11.5px] text-ink-2">
              <span className="size-[6px] rounded-full bg-helper-marketing" aria-hidden />
              {s.area}
            </span>
            <span className="text-[11.5px] text-faint">Runs as</span>
            <span className="inline-flex items-center gap-[5px] text-[11.5px] text-ink-2">
              <span className="size-[6px] rounded-full bg-helper-marketing" aria-hidden />
              {s.runsAs}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── TemplatesTab ──────────────────────────────────────────────────────────────

const TEMPLATE_CATS = ['All', 'Engineering', 'Ops', 'Reporting', 'Support'] as const
type TemplateCat = (typeof TEMPLATE_CATS)[number]

function inCat(t: TemplateFlow, cat: TemplateCat) {
  switch (cat) {
    case 'All':
      return true
    case 'Engineering':
      return t.areas.includes('dev')
    case 'Ops':
      return t.areas.includes('ops')
    case 'Reporting':
      return /report|digest|summar|notes/i.test(`${t.title} ${t.desc}`)
    case 'Support':
      return t.areas.includes('support')
  }
}

function TemplatesTab({ onTemplateUse }: { onTemplateUse?: (template: TemplateFlow) => void }) {
  const [cat, setCat] = useState<TemplateCat>('All')
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex items-center justify-between">
        <div className="flex gap-[2px]">
          {TEMPLATE_CATS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className="h-[28px] rounded-btn px-[10px] text-[12px] font-medium transition-colors"
              style={{
                background: cat === c ? 'var(--color-hover)' : 'transparent',
                color: cat === c ? 'var(--color-ink)' : 'var(--color-muted)',
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-faint">{TEMPLATES.filter((t) => inCat(t, cat)).length} templates</span>
      </div>
      <div className="grid grid-cols-3 gap-[12px]">
        {TEMPLATES.filter((t) => inCat(t, cat)).map((t) => (
          <TemplateCard key={t.id} t={t} onUse={() => onTemplateUse?.(t)} />
        ))}
      </div>
    </div>
  )
}

// ── RunsTab ───────────────────────────────────────────────────────────────────

const RUN_FILTERS = ['All', 'Running', 'Needs you', 'Failed', 'Done'] as const
type RunFilter = (typeof RUN_FILTERS)[number]

function RunsTab({ flows }: { flows: Flow[] }) {
  const [filter, setFilter] = useState<RunFilter>('All')
  const { runs, isLoading, isError } = useAllFlowRuns(flows)

  const now = Date.now()
  const titleById = useMemo(() => new Map(flows.map((f) => [f.id, f.title])), [flows])
  const rows = useMemo(
    () => sortRunsByStartedDesc(runs).map((r) => officeRunRow(r, titleById.get(r.flowId) ?? 'Flow', now)),
    [runs, titleById, now],
  )
  const stats = useMemo(() => runsStats(runs, now), [runs, now])

  if (isError) {
    return (
      <div role="alert" className="px-[24px] py-[20px] text-[13px] text-bad">
        Failed to load runs. Please refresh to try again.
      </div>
    )
  }
  if (isLoading) {
    return <div className="px-[24px] py-[20px] text-[13px] text-muted">Loading runs…</div>
  }

  const shown = filter === 'All' ? rows : rows.filter((r) => r.status === filter)

  return (
    <div className="flex flex-col gap-[20px]">
      {/* Stats */}
      <div className="flex gap-[32px]">
        {Object.entries(stats).map(([label, val]) => (
          <div key={label} className="flex flex-col gap-[2px]">
            <span className="text-[11.5px] text-muted">{label}</span>
            <span className="text-[22px] font-semibold text-ink">{val}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-[4px]">
        {RUN_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className="h-[28px] rounded-btn px-[10px] text-[12px] font-medium transition-colors"
            style={{
              background: filter === f ? 'var(--color-hover)' : 'transparent',
              color: filter === f ? 'var(--color-ink)' : 'var(--color-muted)',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-line-strong">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-soft">
              {['Flow', 'Status', 'Trigger', 'Started', 'Duration', 'Cost'].map((h) => (
                <th key={h} className="px-[12px] py-[8px] text-left font-medium text-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr
                key={row.id}
                className={`border-b border-line last:border-0 transition-colors hover:bg-hover ${i % 2 === 0 ? 'bg-surface' : 'bg-soft'}`}
              >
                <td className="px-[12px] py-[9px]">
                  <div className="flex items-center gap-[8px]">
                    <GitFork size={13} aria-hidden className="shrink-0 text-muted" />
                    <span className="text-ink-2">{row.flowTitle}</span>
                  </div>
                </td>
                <td className="px-[12px] py-[9px]">
                  <RunStatusChip status={row.status} />
                </td>
                <td className="px-[12px] py-[9px] text-muted">{row.trigger}</td>
                <td className="px-[12px] py-[9px] text-muted">{row.startedAt}</td>
                <td className="px-[12px] py-[9px] text-muted">{row.duration}</td>
                <td className="px-[12px] py-[9px] text-muted">{row.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── NewFlowDialog ─────────────────────────────────────────────────────────────

/** Typed inputs from the "Describe it" form, passed up to create the flow. */
export interface NewFlowDraft {
  description: string
  areaId: string
  runsAs: string
}

interface NewFlowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Available areas for the Area select. */
  areas: Array<{ id: string; name: string }>
  onDraft?: (draft: NewFlowDraft) => void
  /** Start an empty flow (no Chief draft). */
  onBlank?: () => void
  /** Start from a template. */
  onTemplate?: (t: TemplateFlow) => void
  /** Helper names for "Runs as". */
  runsAsOptions: string[]
}

type NewFlowMode = 'describe' | 'blank' | 'template'

const NEW_FLOW_MODES: Array<{ id: NewFlowMode; label: string }> = [
  { id: 'describe', label: 'Describe it' },
  { id: 'blank', label: 'Start blank' },
  { id: 'template', label: 'From a template' },
]

const APP_WORDS = ['Stripe', 'WhatsApp', 'Slack', 'GitHub', 'Gmail', 'Email', 'Sheets', 'Notion', 'Calendar']

/** What Chief will draft, read straight from the description (no model call). */
function draftTags(description: string): string[] {
  const tags: string[] = []
  const when = /\b(every\s+\w+(?:\s+\d{1,2}[:.]\d{2})?|daily|weekly|monthly|\d{1,2}[:.]\d{2})\b/i.exec(description)
  if (when) tags.push(when[1].replace(/^every\s+/i, ''))
  for (const w of APP_WORDS) if (new RegExp(`\\b${w}\\b`, 'i').test(description)) tags.push(w)
  if (/\bask me|approve|approval|before\b/i.test(description)) tags.push('Approve')
  return tags
}

function NewFlowDialog({ open, onOpenChange, areas, onDraft, onBlank, onTemplate, runsAsOptions }: NewFlowDialogProps) {
  const [mode, setMode] = useState<NewFlowMode>('describe')
  const [description, setDescription] = useState('')
  const [areaId, setAreaId] = useState(areas[0]?.id ?? '')
  const [runsAs, setRunsAs] = useState<string>(runsAsOptions[0] ?? 'Chief')
  const tags = draftTags(description)

  if (!open) return null
  const close = () => onOpenChange(false)
  const draft = () => { close(); onDraft?.({ description: description.trim(), areaId, runsAs }) }
  const blank = () => { close(); onBlank?.() }

  return (
    <Drawer
      title="New flow"
      subtitle="Describe it and Chief drafts the steps — you review before it runs."
      onClose={close}
      footer={
        <>
          <span className="min-w-0 flex-1 text-[12px] text-muted">
            {mode === 'blank' ? 'An empty canvas — add steps yourself' : 'You review the draft before it runs'}
          </span>
          <Button variant="secondary" height={30} onClick={close}>Cancel</Button>
          {mode === 'blank' ? (
            <Button variant="primary" height={30} icon={Plus} onClick={blank}>
              Start blank
            </Button>
          ) : (
            <Button variant="primary" height={30} icon={Sparkles} disabled={mode === 'describe' && !description.trim()} onClick={draft}>
              Draft with Chief
            </Button>
          )}
        </>
      }
    >
      {/* Mode selector */}
      <SegmentedTabs
        label="How to start"
        options={NEW_FLOW_MODES}
        value={mode}
        onChange={setMode}
      />

      {/* Describe body */}
      {mode === 'describe' && (
        <>
          <label className="flex w-full shrink-0 flex-col gap-[6px]">
            <span className="text-[13px] font-medium text-ink-2">What should it do?</span>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Every Friday 16:00, sum this week's Stripe payouts and send me a summary on WhatsApp. Ask me before paying anyone."
              className="w-full resize-none rounded-base bg-surface px-[10px] py-[9px] text-[13.5px] leading-[1.55] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-ink placeholder:text-faint"
            />
          </label>

          {/* Chief will draft */}
          <section
            aria-label="Chief will draft"
            className="flex w-full shrink-0 flex-col gap-[10px] rounded-lg bg-[#EEF2FF] p-[14px] outline-1 -outline-offset-1 outline-[#C7D2FE]"
          >
            <div className="flex items-center gap-[8px]">
              <Mascot size={20} radius={6} area="brand" />
              <span className="text-[13px] font-semibold text-ink">Chief will draft</span>
            </div>
            <div className="flex flex-wrap gap-[4px]">
              {(tags.length ? tags : ['Describe it above']).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex h-[20px] items-center rounded-pill bg-surface px-[7px] text-[11px] font-medium text-ink-2"
                >
                  {tag}
                </span>
              ))}
            </div>
            <span className="text-[11.5px] text-muted">A trigger, an AI step and what you mention — you review before it runs</span>
          </section>

          {/* Area + Runs as */}
          <div className="grid w-full shrink-0 grid-cols-2 gap-[10px]">
            <div className="flex flex-col gap-[5px]">
              <label className="text-[12px] font-medium text-ink-2" htmlFor="new-flow-area">Area</label>
              <div className="flex items-center gap-[6px] rounded-base bg-soft px-[10px] py-[7px] outline-1 -outline-offset-1 outline-line-strong">
                <span className="size-[8px] shrink-0 rounded-full bg-helper-marketing" aria-hidden />
                <select
                  id="new-flow-area"
                  value={areaId}
                  onChange={(e) => setAreaId(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
                >
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-[5px]">
              <label className="text-[12px] font-medium text-ink-2" htmlFor="new-flow-runs-as">Runs as</label>
              <div className="flex items-center gap-[6px] rounded-base bg-soft px-[10px] py-[7px] outline-1 -outline-offset-1 outline-line-strong">
                <span className="size-[8px] shrink-0 rounded-full bg-helper-marketing" aria-hidden />
                <select
                  id="new-flow-runs-as"
                  value={runsAs}
                  onChange={(e) => setRunsAs(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
                >
                  {runsAsOptions.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </>
      )}

      {mode === 'blank' && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[13px] text-muted text-center">Opens an empty canvas where you add steps.</p>
        </div>
      )}

      {mode === 'template' && (
        <div className="flex w-full shrink-0 flex-col gap-[10px]">
          {TEMPLATES.slice(0, 6).map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-[10px] rounded-base outline-1 -outline-offset-1 outline-line-strong px-[12px] py-[10px] bg-surface hover:bg-soft transition-colors"
            >
              <FlowChain from={t.from} to={t.to} count={t.count} />
              <div className="flex flex-col gap-[1px] min-w-0 flex-1">
                <span className="text-[12.5px] font-medium text-ink">{t.title}</span>
                <span className="text-[11.5px] text-muted truncate">{t.desc}</span>
              </div>
              <button
                type="button"
                aria-label={`Use ${t.title}`}
                onClick={() => { close(); onTemplate?.(t) }}
                className="text-[12px] text-muted transition-colors hover:text-ink-2 shrink-0"
              >
                Use
              </button>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}

// ── OfficeFlowsPage ───────────────────────────────────────────────────────────

/** Shared Flows board. `areaId === null` → company-wide; else scoped to one area. */
function FlowsBoard({ areaId }: { areaId: string | null }) {
  const { data: area } = useArea(areaId ?? '')
  const areaName = areaId ? area?.name ?? '' : null
  const { data: liveFlows = [], isLoading: flowsLoading, isError: flowsError } = useFlows()
  const { data: allAreas = [] } = useAreas()
  const { data: suggestions = [], isLoading: suggestionsLoading } = useFlowSuggestions()
  const { data: helpers = [] } = useHelpers()
  const createFlow = useCreateFlow()
  const [activeTab, setActiveTab] = useState<FlowTab>('Yours')
  const [dialogOpen, setDialogOpen] = useState(false)
  const navigate = useNavigate()

  // Tabs — count from live query
  const tabs: Array<{ key: FlowTab; label: string; count?: number }> = [
    { key: 'Yours',     label: 'Yours',                count: liveFlows.length },
    { key: 'Suggested', label: 'Suggested by agents',  count: suggestions.length },
    { key: 'Templates', label: 'Templates' },
    { key: 'Runs',      label: 'Runs' },
  ]

  // The flow editor is a mode-neutral, full-screen route (no sidebar).
  function goToCanvas(flowId: string) {
    navigate({ to: '/flows/$flowId/canvas', params: { flowId } })
  }

  /** Create a real draft flow, then open it (draft canvas for templates/suggestions). */
  function create(body: CreateFlowInput, to: 'canvas' | 'draft', toast: string) {
    createFlow.mutate(body, {
      onSuccess: (flow) => {
        notify(toast)
        void navigate({ to: to === 'draft' ? '/flows/$flowId/draft' : '/flows/$flowId/canvas', params: { flowId: flow.id } })
      },
      onError: () => notify('Could not create the flow — try again'),
    })
  }

  // "Describe it" → a draft with a manual trigger and one AI step carrying the brief.
  function createFromDraft(draft: NewFlowDraft) {
    const title = draft.description.split(/[.\n]/)[0]?.slice(0, 60) || 'New flow'
    create(
      {
        title,
        trigger: { kind: 'manual', spec: { description: draft.description, runsAs: draft.runsAs } },
        ...draftGraph('When you run it', [draft.description.slice(0, 120)], 'clock', 'message-circle'),
        areas: draft.areaId ? [draft.areaId] : [],
      },
      'draft',
      'Flow drafted',
    )
  }

  function goToBlank() {
    create({ title: 'Untitled flow', trigger: { kind: 'manual', spec: {} }, nodes: [], edges: [], areas: areaId ? [areaId] : [] }, 'canvas', 'Blank flow created')
  }

  const applyTemplate = (t: TemplateFlow) => create(templateBody(t), 'draft', `“${t.title}” added as a draft`)
  const applySuggestion = (sg: FlowSuggestion) => create(suggestionBody(sg), 'draft', 'Draft created from the suggestion')
  const runsAsOptions = helpers.length ? helpers.map((h) => h.name) : ['Chief']

  return (
    <>
      <Topbar
        icon={GitFork}
        title="Flows"
        meta={areaName ? `in ${areaName}` : 'All areas · Company-wide'}
        actions={
          <Button icon={Plus} onClick={() => setDialogOpen(true)}>
            New flow
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[24px] py-[20px]">
        <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">
          {areaName ? `Flows in ${areaName}` : 'Flows across the company'}
        </h2>

        {/* Tabs */}
        <SegmentedTabs
          label="Flows views"
          className="mt-[14px] mb-[20px]"
          options={tabs.map(({ key, label, count }) => ({ id: key, label, count }))}
          value={activeTab}
          onChange={setActiveTab}
        />

        {activeTab === 'Yours'     && (
          <YoursTab
            liveFlows={liveFlows}
            suggestions={suggestions}
            loading={flowsLoading}
            error={flowsError}
            onCardClick={goToCanvas}
            onNewClick={() => setDialogOpen(true)}
            onTemplateUse={applyTemplate}
            onSuggestedCreate={applySuggestion}
          />
        )}
        {activeTab === 'Suggested' && (
          <SuggestedTab suggestions={suggestions} loading={suggestionsLoading} onCreateFlow={applySuggestion} />
        )}
        {activeTab === 'Templates' && <TemplatesTab onTemplateUse={applyTemplate} />}
        {activeTab === 'Runs'      && <RunsTab flows={liveFlows} />}
      </div>

      <NewFlowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        areas={allAreas}
        onDraft={createFromDraft}
        onBlank={goToBlank}
        onTemplate={applyTemplate}
        runsAsOptions={runsAsOptions}
      />
    </>
  )
}

// ── Route wrappers (shared board, area from the store) ────────────────────────

/** Office · Flows — company-wide when no area is selected. */
export function OfficeFlowsRoute() {
  const areaId = useUIStore((s) => s.areaId)
  return <FlowsBoard areaId={areaId} />
}

/** Chat · Flows — same board, area-filtered. */
export function ChatFlowsRoute() {
  const areaId = useUIStore((s) => s.areaId)
  return <FlowsBoard areaId={areaId} />
}
