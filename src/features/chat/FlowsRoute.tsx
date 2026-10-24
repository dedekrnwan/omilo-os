import { useState } from 'react'
import { Activity, GitFork, Plus } from 'lucide-react'
import { useParams } from '@tanstack/react-router'
import { useChannel } from '../../app/queries'
import { Button } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'

const DEFAULT_CHANNEL_ID = 'ch-general'

// ── Types & static data ───────────────────────────────────────────────────────

type FlowTab = 'Yours' | 'Suggested' | 'Templates' | 'Runs'

interface FlowCard {
  id: string
  title: string
  status: string
  enabled: boolean
  areas: Array<'brand' | 'dev' | 'ops' | 'marketing'>
  bars: number[]
}

const YOUR_FLOWS: FlowCard[] = [
  {
    id: 'f-deploy-triage',
    title: 'Deploy failure triage',
    status: '12m ago',
    enabled: true,
    areas: ['brand', 'dev', 'ops'],
    bars: [2, 4, 3, 5, 4, 3, 5, 4, 5, 4, 3, 4, 5, 4, 3],
  },
  {
    id: 'f-latency',
    title: 'Weekly latency report',
    status: 'Mon',
    enabled: false,
    areas: ['brand', 'ops'],
    bars: [1, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5, 4, 5, 4],
  },
  {
    id: 'f-freeze',
    title: 'Freeze-window guard',
    status: 'waiting for you',
    enabled: true,
    areas: ['brand', 'dev'],
    bars: [5, 4, 5, 4, 5, 3, 4, 3, 5, 4, 5, 4, 3, 4, 5],
  },
  {
    id: 'f-oncall',
    title: 'On-call digest',
    status: 'today 08:00',
    enabled: true,
    areas: ['brand'],
    bars: [3, 2, 3, 2, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3],
  },
]

const TEMPLATES: Array<{ id: string; title: string; desc: string; areas: Array<'brand' | 'dev' | 'ops' | 'marketing'> }> = [
  { id: 't1', title: 'Incident → postmortem',    desc: 'Pages on-call, collects the timeline, drafts the postmortem.',            areas: ['brand', 'dev'] },
  { id: 't2', title: 'PR digest to chat',         desc: 'Morning summary of open PRs, reviews needed and blockers.',               areas: ['brand', 'dev', 'ops'] },
  { id: 't3', title: 'Weekly uptime report',       desc: 'Pulls uptime and latency, writes the Friday report.',                    areas: ['brand', 'ops'] },
  { id: 't4', title: 'Deploy failure triage',      desc: 'Reads logs on failed deploys and posts the likely cause.',               areas: ['brand', 'dev'] },
  { id: 't5', title: 'Release notes from merges',  desc: 'Turns merged PRs into readable release notes.',                         areas: ['brand', 'dev', 'ops'] },
  { id: 't6', title: 'Freeze-window guard',         desc: 'Blocks deploys during freeze windows and tells the team.',              areas: ['brand', 'dev'] },
  { id: 't7', title: 'Stale PR nudger',             desc: 'Labels idle PRs and pings the author after 5 days.',                   areas: ['brand', 'dev'] },
  { id: 't8', title: 'On-call handoff',             desc: 'Summarises the week\'s incidents for the next on-call.',               areas: ['brand'] },
  { id: 't9', title: 'Cost spike alert',            desc: 'Watches cloud spend and flags unusual jumps.',                          areas: ['brand', 'ops'] },
]

type RunStatus = 'Running' | 'Needs you' | 'Done' | 'Failed'
interface RunRow {
  id: string
  icon: 'flow' | 'doc'
  title: string
  status: RunStatus
  trigger: string
  started: string
  duration: string
  cost: string
}

const RUNS: RunRow[] = [
  { id: 'r1', icon: 'flow', title: 'Deploy failure triage',  status: 'Running',   trigger: 'GitHub · deploy #882', started: 'now',      duration: '—',      cost: '—' },
  { id: 'r2', icon: 'doc',  title: 'Weekly latency report',  status: 'Needs you', trigger: 'Schedule · Fri 16:00', started: '12m ago',  duration: '48s',    cost: '$0.02' },
  { id: 'r3', icon: 'flow', title: 'Freeze-window guard',    status: 'Done',      trigger: 'GitHub · push to main',started: '34m ago',  duration: '6s',     cost: '$0.00' },
  { id: 'r4', icon: 'flow', title: 'Deploy failure triage',  status: 'Failed',    trigger: 'GitHub · deploy #879', started: '2h ago',   duration: '1m 12s', cost: '$0.03' },
  { id: 'r5', icon: 'doc',  title: 'On-call digest',         status: 'Done',      trigger: 'Schedule · daily 08:00', started: 'Today 08:00', duration: '51s', cost: '$0.01' },
  { id: 'r6', icon: 'doc',  title: 'Weekly latency report',  status: 'Done',      trigger: 'Schedule · Fri 16:00', started: 'Last Fri',  duration: '51s',    cost: '$0.02' },
]

const RUN_STATUS_STYLE: Record<RunStatus, { bg: string; ink: string }> = {
  Running:    { bg: 'var(--color-info-tint)',  ink: 'var(--color-info)' },
  'Needs you':{ bg: 'var(--color-warn-tint)', ink: 'var(--color-warn)' },
  Done:       { bg: 'var(--color-ok-tint)',   ink: 'var(--color-ok)' },
  Failed:     { bg: 'var(--color-bad-tint)',  ink: 'var(--color-bad)' },
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ bars }: { bars: number[] }) {
  const max = 5
  const barW = 4
  const h = 20
  return (
    <div className="flex items-end gap-[2px]" aria-hidden style={{ height: h }}>
      {bars.map((v, i) => {
        const pct = v / max
        const barH = Math.max(3, Math.round(pct * h))
        // green ↑ orange mid red ↓
        const color =
          pct > 0.7
            ? 'var(--color-ok)'
            : pct > 0.4
            ? 'var(--color-helper-marketing)'
            : 'var(--color-bad-solid)'
        return (
          <span
            key={i}
            style={{ width: barW, height: barH, background: color, borderRadius: 2, display: 'block' }}
          />
        )
      })}
    </div>
  )
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      className="relative inline-flex h-[16px] w-[28px] shrink-0 cursor-pointer items-center rounded-pill transition-colors"
      style={{ background: on ? 'var(--color-helper-brand)' : 'var(--color-line-strong)' }}
    >
      <span
        className="absolute size-[12px] rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: on ? 'translateX(14px)' : 'translateX(2px)' }}
      />
    </span>
  )
}

// ── FlowCard ──────────────────────────────────────────────────────────────────

function FlowCardItem({ card }: { card: FlowCard }) {
  return (
    <div className="flex flex-col gap-[10px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[14px]">
      {/* icons row + toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[4px]">
          {card.areas.map((area, i) => (
            <Mascot key={i} size={20} radius={5} area={area} />
          ))}
        </div>
        <Toggle on={card.enabled} />
      </div>
      {/* title */}
      <span className="text-[13px] font-medium text-ink">{card.title}</span>
      {/* status + sparkline */}
      <div className="flex items-end justify-between gap-[8px]">
        <span className="text-[11.5px] text-muted">{card.status}</span>
        <Sparkline bars={card.bars} />
      </div>
    </div>
  )
}

// ── SuggestedCard ─────────────────────────────────────────────────────────────

function SuggestedCard({
  title,
  sub,
  suggested,
}: {
  title: string
  sub: string
  suggested: string
}) {
  return (
    <div className="flex flex-col gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-soft p-[14px]">
      <div className="flex items-start justify-between gap-[8px]">
        <div className="flex flex-col gap-[4px] min-w-0">
          <span className="text-[13px] font-medium text-ink">{title}</span>
          <span className="text-[11.5px] text-muted">{sub}</span>
        </div>
        <Button variant="primary" height={28}>Create</Button>
      </div>
      <span className="text-[11.5px] text-faint">{suggested}</span>
    </div>
  )
}

// ── NewFlowCard ───────────────────────────────────────────────────────────────

function NewFlowCard() {
  return (
    <div className="flex flex-col items-center justify-center gap-[8px] rounded-lg border-2 border-dashed border-line-strong p-[14px] min-h-[120px] text-center transition-colors hover:bg-soft">
      <span className="flex size-[28px] items-center justify-center rounded-full bg-line-strong">
        <Plus size={14} aria-hidden className="text-muted" />
      </span>
      <span className="text-[12.5px] text-muted">New flow</span>
      <span className="text-[11.5px] text-faint">Describe it — Chief drafts it</span>
    </div>
  )
}

// ── TemplateCard ─────────────────────────────────────────────────────────────

function TemplateCard({ t }: { t: (typeof TEMPLATES)[number] }) {
  return (
    <div className="flex flex-col gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[12px]">
      <div className="flex items-start justify-between gap-[8px]">
        <div className="flex items-center gap-[4px]">
          {t.areas.map((area, i) => (
            <Mascot key={i} size={18} radius={5} area={area} />
          ))}
        </div>
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

// ── RunsTab ───────────────────────────────────────────────────────────────────

function RunsTab() {
  const [filter, setFilter] = useState<'All' | 'Running' | 'Needs you' | 'Failed' | 'Done'>('All')
  const filters = ['All', 'Running', 'Needs you', 'Failed', 'Done'] as const

  const stats = {
    'Runs this week': '142',
    'Success rate': '96%',
    'Needs you': '2',
    Spend: '$1.84',
  }

  const shown = filter === 'All' ? RUNS : RUNS.filter((r) => r.status === filter)

  return (
    <div className="flex flex-col gap-[20px]">
      {/* Stats row */}
      <div className="flex gap-[32px]">
        {Object.entries(stats).map(([label, val]) => (
          <div key={label} className="flex flex-col gap-[2px]">
            <span className="text-[11.5px] text-muted">{label}</span>
            <span className="text-[22px] font-semibold text-ink">{val}</span>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div className="flex gap-[4px]">
        {filters.map((f) => (
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
                <th key={h} className="px-[12px] py-[8px] text-left font-medium text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => {
              const st = RUN_STATUS_STYLE[row.status]
              return (
                <tr key={row.id} className={`border-b border-line last:border-0 ${i % 2 === 0 ? 'bg-surface' : 'bg-soft'} hover:bg-hover transition-colors`}>
                  <td className="px-[12px] py-[9px]">
                    <div className="flex items-center gap-[8px]">
                      {row.icon === 'flow' ? (
                        <GitFork size={13} aria-hidden className="shrink-0 text-muted" />
                      ) : (
                        <Activity size={13} aria-hidden className="shrink-0 text-muted" />
                      )}
                      <span className="text-ink-2">{row.title}</span>
                    </div>
                  </td>
                  <td className="px-[12px] py-[9px]">
                    <span
                      className="inline-flex h-[20px] items-center rounded-pill px-[8px] text-[11.5px] font-medium"
                      style={{ background: st.bg, color: st.ink }}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-[12px] py-[9px] text-muted">{row.trigger}</td>
                  <td className="px-[12px] py-[9px] text-muted">{row.started}</td>
                  <td className="px-[12px] py-[9px] text-muted">{row.duration}</td>
                  <td className="px-[12px] py-[9px] text-muted">{row.cost}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── TemplatesTab ──────────────────────────────────────────────────────────────

const TEMPLATE_CATEGORIES = ['All', 'Engineering', 'Ops', 'Reporting', 'Support'] as const
type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

function TemplatesTab() {
  const [cat, setCat] = useState<TemplateCategory>('All')

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Category pills + count */}
      <div className="flex items-center justify-between">
        <div className="flex gap-[2px]">
          {TEMPLATE_CATEGORIES.map((c) => (
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
        <span className="text-[12px] text-faint">12 templates</span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 gap-[12px]">
        {TEMPLATES.map((t) => (
          <TemplateCard key={t.id} t={t} />
        ))}
      </div>
    </div>
  )
}

// ── SuggestedTab ─────────────────────────────────────────────────────────────

const SUGGESTED = [
  {
    id: 's1',
    title: 'Triage failed deploys for you?',
    sub: 'GitHub deploy fails → read logs → find the PR → post summary to #engineering',
    suggested: 'Dev saw you do it 4× this week  ·  ~3 runs/week  ·  ~$0.02 a run',
  },
  {
    id: 's2',
    title: 'Auto-label stale pull requests',
    sub: 'Every morning → find PRs idle 5 days → label stale and ping the author',
    suggested: '12 PRs sat untouched for 5+ days last month  ·  ~$0.01 a run',
  },
]

function SuggestedTab() {
  return (
    <div className="flex flex-col gap-[12px]">
      <p className="text-[13px] text-muted">
        Helpers watch how Engineering works and propose flows. Nothing runs until you create it.
      </p>
      {SUGGESTED.map((s) => (
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
          <span className="text-[11.5px] text-faint">{s.suggested}</span>
        </div>
      ))}
    </div>
  )
}

// ── YoursTab ─────────────────────────────────────────────────────────────────

function YoursTab() {
  return (
    <div className="flex flex-col gap-[20px]">
      {/* Flow cards grid */}
      <div className="grid grid-cols-3 gap-[12px]">
        {YOUR_FLOWS.map((card) => (
          <FlowCardItem key={card.id} card={card} />
        ))}
        {/* Suggested card in grid */}
        <SuggestedCard
          title="Triage failed deploys for you?"
          sub="Dev saw you do it 4× this week"
          suggested="Suggested by Dev"
        />
        {/* New flow card */}
        <NewFlowCard />
      </div>

      {/* Templates row */}
      <div className="flex flex-col gap-[10px]">
        <span className="text-[12px] font-medium text-muted">Start from a template</span>
        <div className="flex gap-[10px] overflow-x-auto pb-[4px]">
          {[
            { id: 'tr1', title: 'Incident → postmortem', areas: ['brand', 'dev'] as const },
            { id: 'tr2', title: 'PR digest to chat', areas: ['brand', 'dev', 'ops'] as const },
            { id: 'tr3', title: 'Weekly uptime report', areas: ['brand', 'ops'] as const },
          ].map((t) => (
            <div
              key={t.id}
              className="flex min-w-[200px] shrink-0 items-center justify-between gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface px-[12px] py-[8px]"
            >
              <div className="flex items-center gap-[6px]">
                {t.areas.map((area, i) => (
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

// ── FlowsPage ─────────────────────────────────────────────────────────────────

const TABS: Array<{ key: FlowTab; label: string; count?: number }> = [
  { key: 'Yours',     label: 'Yours',                count: 4 },
  { key: 'Suggested', label: 'Suggested by agents',  count: 4 },
  { key: 'Templates', label: 'Templates' },
  { key: 'Runs',      label: 'Runs' },
]

function FlowsPage({ channelName }: { channelName: string }) {
  const [activeTab, setActiveTab] = useState<FlowTab>('Yours')

  return (
    <>
      <Topbar
        icon={GitFork}
        title="Flows"
        meta={`in ${channelName}`}
        actions={
          <Button icon={Plus}>
            New flow
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[24px] py-[20px]">
        <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">
          Flows in {channelName}
        </h2>

        {/* Tabs */}
        <div className="mt-[14px] mb-[20px] flex items-center gap-[2px] border-b border-line pb-[0]">
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

        {/* Tab content */}
        {activeTab === 'Yours'     && <YoursTab />}
        {activeTab === 'Suggested' && <SuggestedTab />}
        {activeTab === 'Templates' && <TemplatesTab />}
        {activeTab === 'Runs'      && <RunsTab />}
      </div>
    </>
  )
}

// ── FlowsRoute ────────────────────────────────────────────────────────────────

/**
 * Main content for /chat/$channelId/flows.
 * The sidebar and Inset wrapper are provided by ChatChannelLayout.
 */
export function FlowsRoute() {
  const params = useParams({ strict: false })
  const channelId = params.channelId ?? DEFAULT_CHANNEL_ID
  const { data: channel } = useChannel(channelId)

  return <FlowsPage channelName={channel?.name ?? '…'} />
}
