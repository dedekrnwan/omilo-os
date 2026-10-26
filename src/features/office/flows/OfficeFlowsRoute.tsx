// ── Office Flows: List + New Flow dialog ─────────────────────────────────────
// Matches design ref: Cv9lg.png (company-wide flows list + new-flow panel)

import { useState } from 'react'
import { SegmentedTabs } from '../../../ui/ds/Segmented'
import * as Dialog from '@radix-ui/react-dialog'
import { drawerOverlayClass, drawerContentClass } from '../../../ui/ds/Drawer'
import { Copy, GitFork, History, Link, Pause, Play, Plus, Power, Settings2, Sparkles, Trash2, Workflow, X } from 'lucide-react'
import { ContextMenuArea, MoreMenu, copyText } from '../../../ui/ds/ItemMenu'
import type { MenuEntries } from '../../../ui/ds/ItemMenu'
import { notify } from '../../../ui/ds/Toaster'
import { useFlowStore } from './editor/store'
import { useFlowBoard } from './boardStore'
import type { FlowCard } from './boardStore'
import { useNavigate } from '@tanstack/react-router'
import { useArea } from '../../../app/queries'
import { useUIStore } from '../../../app/store'
import { Button } from '../../../ui/ds/Button'
import { Topbar } from '../../../ui/ds/Frame'
import { Mascot } from '../../../ui/ds/Mascot'
import { FlowChain } from '../../../ui/ds/FlowChain'
import {
  OFFICE_FLOWS,
  TEMPLATES,
  SUGGESTED_FLOWS,
  OFFICE_FLOW_RUNS,
  newDraftId,
} from './data'
import type { FlowTab } from './data'
import { RunStatusChip, Sparkline, Toggle } from './shared'

// ── FlowCard ──────────────────────────────────────────────────────────────────

function FlowCardItem({ card, onClick }: { card: FlowCard; onClick?: () => void }) {
  const navigate = useNavigate()
  const enabled = useFlowStore((st) => st.flows[card.id]?.enabled) ?? card.enabled
  const { setEnabled, startTest } = useFlowStore()
  const { remove, restore, duplicate } = useFlowBoard()
  const go = (to: '/flows/$flowId/canvas' | '/flows/$flowId/runs' | '/flows/$flowId/settings') =>
    void navigate({ to, params: { flowId: card.id } })

  const menu: MenuEntries = [
    { label: 'Open canvas', icon: Workflow, onSelect: () => go('/flows/$flowId/canvas') },
    { label: 'View runs', icon: History, onSelect: () => go('/flows/$flowId/runs') },
    { label: 'Settings', icon: Settings2, onSelect: () => go('/flows/$flowId/settings') },
    { type: 'separator' },
    {
      label: 'Test run',
      icon: Play,
      onSelect: () => {
        startTest(card.id)
        go('/flows/$flowId/canvas')
      },
    },
    enabled
      ? { label: 'Pause flow', icon: Pause, onSelect: () => { setEnabled(card.id, false); notify(`${card.title} paused`, () => setEnabled(card.id, true)) } }
      : { label: 'Turn on', icon: Power, onSelect: () => { setEnabled(card.id, true); notify(`${card.title} is on`) } },
    { label: 'Duplicate', icon: Copy, onSelect: () => { const c = duplicate(card); notify(`Made “${c.title}”`) } },
    { label: 'Copy link', icon: Link, onSelect: () => { copyText(`${location.origin}/flows/${card.id}/canvas`); notify('Link copied') } },
    { type: 'separator' },
    { label: 'Delete flow', icon: Trash2, danger: true, onSelect: () => { remove(card.id); notify('Flow deleted', () => restore(card.id)) } },
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
              onClick={() => setEnabled(card.id, !enabled)}
              className="flex rounded-pill"
            >
              <Toggle on={enabled} />
            </button>
          </span>
        </div>
        <span className="pointer-events-none relative text-[13px] font-medium text-ink">{card.title}</span>
        <div className="pointer-events-none relative flex items-end justify-between gap-[8px]">
          <span className="text-[11.5px] text-muted">{enabled ? card.status : `Paused · ${card.status}`}</span>
          <Sparkline bars={card.bars} />
        </div>
      </div>
    </ContextMenuArea>
  )
}

// ── SuggestedCard ─────────────────────────────────────────────────────────────

function SuggestedCard({ item, onCreate }: { item: (typeof SUGGESTED_FLOWS)[number]; onCreate?: () => void }) {
  return (
    <div className="flex flex-col gap-[10px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-soft p-[14px]">
      {/* chain + suggesting helper */}
      <div className="flex items-center justify-between">
        <FlowChain from={item.from} to={item.to} count={item.count} />
        <Mascot size={22} radius={6} area="dev" title="Dev" />
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
  onCardClick,
  onNewClick,
  onTemplateUse,
  onSuggestedCreate,
}: {
  onCardClick?: (flowId: string) => void
  onNewClick?: () => void
  onTemplateUse?: (templateId: string) => void
  onSuggestedCreate?: (suggestedId: string) => void
}) {
  const { deleted, copies } = useFlowBoard()
  const cards = [...OFFICE_FLOWS, ...copies].filter((c) => !deleted.includes(c.id))
  return (
    <div className="flex flex-col gap-[20px]">
      <div className="grid grid-cols-3 gap-[12px]">
        {cards.map((card) => (
          <FlowCardItem key={card.id} card={card} onClick={() => onCardClick?.(card.id)} />
        ))}
        {SUGGESTED_FLOWS.map((item) => (
          <SuggestedCard key={item.id} item={item} onCreate={() => onSuggestedCreate?.(item.id)} />
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
                onClick={() => onTemplateUse?.(t.id)}
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

function SuggestedTab({ onCreateFlow, onPreview }: { onCreateFlow?: (suggestedId: string) => void; onPreview?: (suggestedId: string) => void }) {
  return (
    <div className="flex flex-col gap-[12px]">
      <p className="text-[13px] text-muted">
        Helpers watch how the company works and propose flows. Nothing runs until you create it.
      </p>
      {SUGGESTED_FLOWS.map((s) => (
        <div
          key={s.id}
          className="flex flex-col gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[14px]"
        >
          <div className="flex items-start justify-between gap-[12px]">
            <div className="flex items-center gap-[10px] min-w-0">
              <Mascot size={28} radius={8} area="dev" />
              <div className="flex flex-col gap-[2px] min-w-0">
                <span className="text-[13px] font-medium text-ink">{s.title}</span>
                <span className="text-[11.5px] text-muted">{s.sub}</span>
              </div>
            </div>
            <div className="flex gap-[6px] shrink-0">
              <Button variant="secondary" height={28} onClick={() => onPreview?.(s.id)}>Preview</Button>
              <Button variant="primary" height={28} icon={Plus} onClick={() => onCreateFlow?.(s.id)}>Create flow</Button>
            </div>
          </div>
          <span className="text-[11.5px] text-faint">{s.hint}</span>
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

function TemplatesTab({ onTemplateUse }: { onTemplateUse?: (templateId: string) => void }) {
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
        <span className="text-[12px] text-faint">{TEMPLATES.length} templates</span>
      </div>
      <div className="grid grid-cols-3 gap-[12px]">
        {TEMPLATES.map((t) => (
          <TemplateCard key={t.id} t={t} onUse={() => onTemplateUse?.(t.id)} />
        ))}
      </div>
    </div>
  )
}

// ── RunsTab ───────────────────────────────────────────────────────────────────

const RUN_FILTERS = ['All', 'Running', 'Needs you', 'Failed', 'Done'] as const
type RunFilter = (typeof RUN_FILTERS)[number]

const RUNS_STATS = {
  'Runs this week': '14',
  'Success rate': '91%',
  'Needs you': '1',
  Spend: '$0.018',
}

function RunsTab() {
  const [filter, setFilter] = useState<RunFilter>('All')
  const shown = filter === 'All' ? OFFICE_FLOW_RUNS : OFFICE_FLOW_RUNS.filter((r) => r.status === filter)

  return (
    <div className="flex flex-col gap-[20px]">
      {/* Stats */}
      <div className="flex gap-[32px]">
        {Object.entries(RUNS_STATS).map(([label, val]) => (
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

interface NewFlowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDraft?: () => void
}

type NewFlowMode = 'describe' | 'blank' | 'template'

function NewFlowDialog({ open, onOpenChange, onDraft }: NewFlowDialogProps) {
  const [mode, setMode] = useState<NewFlowMode>('describe')
  const [description, setDescription] = useState(
    "Every Friday 16:00, pull this week's Stripe payouts, match them to referral signups, and send me a summary on WhatsApp. Ask me before paying anyone over Rp 5jt."
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={drawerOverlayClass} />
        <Dialog.Content
          aria-describedby="new-flow-desc"
          style={{ width: 480 }}
          className={drawerContentClass}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-[8px] px-[22px] pt-[22px] pb-[16px]">
            <div>
              <Dialog.Title className="m-0 text-[15px] font-semibold text-ink">New flow</Dialog.Title>
              <p id="new-flow-desc" className="m-0 mt-[2px] text-[12.5px] text-muted">
                Describe it and Chief stuffs the steps, or start blank.
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="flex size-[26px] shrink-0 items-center justify-center rounded-sm text-faint transition-colors hover:bg-hover hover:text-muted"
              >
                <X size={15} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {/* Mode selector */}
          <div className="flex gap-[8px] px-[22px] pb-[16px]">
            {(
              [
                { key: 'describe' as const, label: 'Describe it', sub: 'Chief stuffs the steps' },
                { key: 'blank' as const,    label: 'Start blank',  sub: 'Empty canvas' },
                { key: 'template' as const, label: 'From a template', sub: '12 ready flows' },
              ] satisfies Array<{ key: NewFlowMode; label: string; sub: string }>
            ).map(({ key, label, sub }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className="flex flex-1 flex-col items-center gap-[3px] rounded-lg p-[10px] text-center transition-colors outline-1 -outline-offset-1"
                style={{
                  outlineColor: mode === key ? 'var(--color-primary)' : 'var(--color-line-strong)',
                  background: mode === key ? 'var(--color-soft)' : 'transparent',
                }}
              >
                <span className="text-[12.5px] font-medium text-ink">{label}</span>
                <span className="text-[11.5px] text-muted">{sub}</span>
              </button>
            ))}
          </div>

          {/* Describe body */}
          {mode === 'describe' && (
            <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[22px] pb-[4px]">
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what you want the flow to do…"
                className="w-full resize-none rounded-base bg-soft px-[10px] py-[9px] text-[13px] leading-[1.5] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary placeholder:text-faint"
              />

              {/* Chief will draft */}
              <div className="flex items-start gap-[10px] rounded-lg outline-1 -outline-offset-1 outline-line-strong p-[12px]">
                <Mascot size={28} radius={7} area="brand" />
                <div className="flex flex-col gap-[4px] min-w-0">
                  <span className="text-[12.5px] font-medium text-ink">Chief will draft</span>
                  <div className="flex flex-wrap gap-[4px]">
                    {(['Fri 16:00', 'Stripe', 'AI match', 'Approve', 'WhatsApp'] as const).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex h-[20px] items-center rounded-pill px-[7px] text-[11px] font-medium"
                        style={{ background: 'var(--color-soft)', color: 'var(--color-ink-2)' }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <span className="text-[11.5px] text-muted">
                    3 steps · 1 AI · ~$0.03 a run · you review the draft before it runs
                  </span>
                </div>
              </div>

              {/* Area + Runs as */}
              <div className="grid grid-cols-2 gap-[10px]">
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[12px] font-medium text-ink-2">Area</label>
                  <div className="flex items-center gap-[6px] rounded-base bg-soft px-[10px] py-[7px] outline-1 -outline-offset-1 outline-line-strong">
                    <span className="size-[8px] shrink-0 rounded-full bg-helper-marketing" aria-hidden />
                    <select className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none">
                      <option>Marketing</option>
                      <option>Engineering</option>
                      <option>Business</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-[5px]">
                  <label className="text-[12px] font-medium text-ink-2">Runs as</label>
                  <div className="flex items-center gap-[6px] rounded-base bg-soft px-[10px] py-[7px] outline-1 -outline-offset-1 outline-line-strong">
                    <span className="size-[8px] shrink-0 rounded-full bg-helper-marketing" aria-hidden />
                    <select className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none">
                      <option>Growth</option>
                      <option>Ops</option>
                      <option>Dev</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {mode === 'blank' && (
            <div className="flex flex-1 items-center justify-center px-[22px] pb-[16px]">
              <p className="text-[13px] text-muted text-center">Opens an empty canvas where you add steps.</p>
            </div>
          )}

          {mode === 'template' && (
            <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[22px] pb-[4px]">
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
                    onClick={() => { onOpenChange(false); onDraft?.() }}
                    className="text-[12px] text-muted transition-colors hover:text-ink-2 shrink-0"
                  >
                    Use
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center gap-[8px] border-t border-line px-[22px] py-[14px]">
            <span className="flex-1" />
            <Button variant="secondary" height={30} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" height={30} onClick={() => { onOpenChange(false); onDraft?.() }}>
              Draft with Chief
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── OfficeFlowsPage ───────────────────────────────────────────────────────────

const TABS: Array<{ key: FlowTab; label: string; count?: number }> = [
  { key: 'Yours',     label: 'Yours',                count: OFFICE_FLOWS.length },
  { key: 'Suggested', label: 'Suggested by agents',  count: SUGGESTED_FLOWS.length },
  { key: 'Templates', label: 'Templates' },
  { key: 'Runs',      label: 'Runs' },
]

/** Shared Flows board. `areaId === null` → company-wide; else scoped to one area. */
function FlowsBoard({ areaId }: { areaId: string | null }) {
  const { data: area } = useArea(areaId ?? '')
  const areaName = areaId ? area?.name ?? '' : null
  const [activeTab, setActiveTab] = useState<FlowTab>('Yours')
  const [dialogOpen, setDialogOpen] = useState(false)
  const navigate = useNavigate()

  // The flow editor is a mode-neutral, full-screen route (no sidebar).
  function goToCanvas(flowId: string) {
    navigate({ to: '/flows/$flowId/canvas', params: { flowId } })
  }

  function goToDraft(sourceId?: string) {
    navigate({ to: '/flows/$flowId/draft', params: { flowId: newDraftId(sourceId) } })
  }

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
          options={TABS.map(({ key, label, count }) => ({ id: key, label, count }))}
          value={activeTab}
          onChange={setActiveTab}
        />

        {activeTab === 'Yours'     && (
          <YoursTab
            onCardClick={goToCanvas}
            onNewClick={() => setDialogOpen(true)}
            onTemplateUse={(id) => goToDraft(id)}
            onSuggestedCreate={(id) => goToDraft(id)}
          />
        )}
        {activeTab === 'Suggested' && (
          <SuggestedTab
            onCreateFlow={(id) => goToDraft(id)}
            onPreview={(id) => {
              // Suggested flows don't have a canvas yet; navigate to draft preview or notify.
              const existing = [...OFFICE_FLOWS].find((f) => f.id === id)
              if (existing) {
                void navigate({ to: '/flows/$flowId/canvas', params: { flowId: existing.id } })
              } else {
                notify('Preview')
              }
            }}
          />
        )}
        {activeTab === 'Templates' && <TemplatesTab onTemplateUse={(id) => goToDraft(id)} />}
        {activeTab === 'Runs'      && <RunsTab />}
      </div>

      <NewFlowDialog open={dialogOpen} onOpenChange={setDialogOpen} onDraft={() => goToDraft()} />
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
