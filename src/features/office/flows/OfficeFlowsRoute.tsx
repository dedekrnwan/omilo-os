// ── Office Flows: List + New Flow dialog ─────────────────────────────────────
// Matches design ref: Cv9lg.png (company-wide flows list + new-flow panel)

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { GitFork, Plus, X } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Topbar } from '../../../ui/ds/Frame'
import { Mascot } from '../../../ui/ds/Mascot'
import {
  OFFICE_FLOWS,
  TEMPLATES,
  SUGGESTED_FLOWS,
  OFFICE_FLOW_RUNS,
} from './data'
import type { FlowTab } from './data'
import { MascotRow, RunStatusChip, Sparkline, Toggle } from './shared'

// ── FlowCard ──────────────────────────────────────────────────────────────────

function FlowCardItem({ card, onClick }: { card: (typeof OFFICE_FLOWS)[number]; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-[10px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[14px] text-left transition-colors hover:bg-soft w-full"
    >
      <div className="flex items-center justify-between">
        <MascotRow areas={card.areas} />
        <Toggle on={card.enabled} />
      </div>
      <span className="text-[13px] font-medium text-ink">{card.title}</span>
      <div className="flex items-end justify-between gap-[8px]">
        <span className="text-[11.5px] text-muted">{card.status}</span>
        <Sparkline bars={card.bars} />
      </div>
    </button>
  )
}

// ── SuggestedCard ─────────────────────────────────────────────────────────────

function SuggestedCard({ item }: { item: (typeof SUGGESTED_FLOWS)[number] }) {
  return (
    <div className="flex flex-col gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-soft p-[14px]">
      <div className="flex items-start justify-between gap-[8px]">
        <div className="flex flex-col gap-[4px] min-w-0">
          <span className="text-[13px] font-medium text-ink">{item.title}</span>
          <span className="text-[11.5px] text-muted">{item.sub}</span>
        </div>
        <Button variant="primary" height={28}>Create</Button>
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

function TemplateCard({ t }: { t: (typeof TEMPLATES)[number] }) {
  return (
    <div className="flex flex-col gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[12px]">
      <div className="flex items-start justify-between gap-[8px]">
        <MascotRow areas={t.areas} />
        <button
          type="button"
          aria-label={`Use ${t.title}`}
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

function YoursTab({ onCardClick, onNewClick }: { onCardClick?: () => void; onNewClick?: () => void }) {
  return (
    <div className="flex flex-col gap-[20px]">
      <div className="grid grid-cols-3 gap-[12px]">
        {OFFICE_FLOWS.map((card) => (
          <FlowCardItem key={card.id} card={card} onClick={onCardClick} />
        ))}
        {SUGGESTED_FLOWS.map((item) => (
          <SuggestedCard key={item.id} item={item} />
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
              <div className="flex items-center gap-[6px]">
                {t.areas.slice(0, 3).map((area, i) => (
                  <Mascot key={i} size={16} radius={4} area={area} />
                ))}
                <span className="text-[12px] text-ink-2">{t.title}</span>
              </div>
              <button
                type="button"
                aria-label={`Use ${t.title}`}
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

function SuggestedTab() {
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
              <Button variant="secondary" height={28}>Preview</Button>
              <Button variant="primary" height={28} icon={Plus}>Create flow</Button>
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

function TemplatesTab() {
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
          <TemplateCard key={t.id} t={t} />
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
}

type NewFlowMode = 'describe' | 'blank' | 'template'

function NewFlowDialog({ open, onOpenChange }: NewFlowDialogProps) {
  const [mode, setMode] = useState<NewFlowMode>('describe')
  const [description, setDescription] = useState(
    "Every Friday 16:00, pull this week's Stripe payouts, match them to referral signups, and send me a summary on WhatsApp. Ask me before paying anyone over Rp 5jt."
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#0C0A0940] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby="new-flow-desc"
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-dialog bg-surface shadow-[0_24px_64px_#0C0A0929] outline-1 -outline-offset-1 outline-line-strong data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
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
                  <MascotRow areas={t.areas} />
                  <div className="flex flex-col gap-[1px] min-w-0 flex-1">
                    <span className="text-[12.5px] font-medium text-ink">{t.title}</span>
                    <span className="text-[11.5px] text-muted truncate">{t.desc}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Use ${t.title}`}
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
            <Button variant="primary" height={30} onClick={() => onOpenChange(false)}>
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

function OfficeFlowsPage() {
  const [activeTab, setActiveTab] = useState<FlowTab>('Yours')
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <Topbar
        icon={GitFork}
        title="Flows"
        meta="All areas · Company-wide"
        actions={
          <Button icon={Plus} onClick={() => setDialogOpen(true)}>
            New flow
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[24px] py-[20px]">
        <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">
          Flows in Engineering
        </h2>

        {/* Tabs */}
        <div className="mt-[14px] mb-[20px] flex items-center gap-[2px] border-b border-line">
          {TABS.map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              aria-current={activeTab === key ? 'true' : undefined}
              className="relative flex h-[36px] items-center gap-[5px] rounded-t-sm px-[10px] text-[12.5px] font-medium transition-colors"
              style={{
                color: activeTab === key ? 'var(--color-ink)' : 'var(--color-muted)',
                borderBottom: activeTab === key ? '2px solid var(--color-ink)' : '2px solid transparent',
              }}
            >
              {label}
              {count !== undefined && (
                <span className="text-[11.5px]" style={{ color: activeTab === key ? 'var(--color-muted)' : 'var(--color-faint)' }}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'Yours'     && <YoursTab onNewClick={() => setDialogOpen(true)} />}
        {activeTab === 'Suggested' && <SuggestedTab />}
        {activeTab === 'Templates' && <TemplatesTab />}
        {activeTab === 'Runs'      && <RunsTab />}
      </div>

      <NewFlowDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}

// ── OfficeFlowsRoute ──────────────────────────────────────────────────────────

/**
 * Main content for /office/flows.
 * OfficeSidebar + Inset are provided by OfficeLayout.
 */
export function OfficeFlowsRoute() {
  return <OfficeFlowsPage />
}
