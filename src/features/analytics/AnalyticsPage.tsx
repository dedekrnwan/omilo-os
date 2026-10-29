import { useState } from 'react'
import { ChartLine } from 'lucide-react'
import { Topbar } from '../../ui/ds/Frame'
import type { HelperArea } from '../../core/domain/types'
import type { AnalyticsStat, HelperStat as DomainHelperStat } from '../../core/domain/types'
import { useAnalyticsOverview, useAnalyticsHelpers } from '../../app/queries'
import { BudgetDrawer, BudgetToast } from './BudgetDrawer'
import type { BarChart, ChipTone, HelperStatus, Stat } from './data'
import { ALL_HELPERS, PageHeader, Tabs, Toolbar } from './parts'
import type { TabId } from './parts'
import { ActivityTab, HelpersTab, LoopsTab, OverviewTab, ReliabilityTab } from './tabs'

// ── Local bridge type: maps DomainHelperStat → display shape ─────────────────

/** Display-ready helper row built from domain HelperStat for the overview/helpers tabs. */
export interface LocalHelperRow {
  id: string
  name: string
  /** NOTE(p8-chart-gap): domain HelperStat lacks area — defaulting to 'brand'.
   *  A future backend field (e.g. area) would wire this properly. */
  area: HelperArea
  role: string
  doing: string
  status: HelperStatus
  jobs: string
  success: string
  successWarn?: boolean
  tokens: string
  spend: string
  budget?: { spent: number; limit: number; warn?: boolean }
  lastActive: string
}

// ── Shape conversion helpers ──────────────────────────────────────────────────

function toDisplayStat(s: AnalyticsStat): Stat {
  const value = s.note === '%' ? `${s.value}%` : String(s.value)
  return {
    label: s.label,
    value,
    delta: '',
    tone: 'neutral' as ChipTone,
    note: s.note && s.note !== '%' ? s.note : '',
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function toDomainRow(h: DomainHelperStat): LocalHelperRow {
  return {
    id: h.helperId,
    name: h.name,
    area: 'brand' as HelperArea, // NOTE(p8-chart-gap): area not in domain HelperStat; default 'brand'
    role: '',
    doing: '',
    status: 'idle' as const,
    jobs: String(h.jobs),
    // success is 0-100; display as percentage, or '—' if not applicable
    success: h.success === 0 && h.jobs === 0 ? '—' : `${h.success}%`,
    successWarn: h.success < 80 && h.jobs > 0,
    tokens: formatTokens(h.tokens),
    // NOTE(p8-chart-gap): assuming spend is in cents; if backend returns dollars, remove /100
    spend: `$${(h.spend / 100).toFixed(2)}`,
    lastActive: '—',
  }
}

// ── Fallback bar charts (used until series→BarChart mapping is implemented) ──
// NOTE(p8-chart-gap): AnalyticsSeries {label, values, labels} does not map to
// BarChart {stack, legend, fmt, unit} — using static fallback until chart wiring task.

export const FALLBACK_JOBS_CHART: BarChart = {
  title: 'Jobs',
  sub: '',
  stack: [],
  legend: [],
  fmt: (v) => String(v),
  unit: 'jobs',
}

export const FALLBACK_TOKENS_CHART: BarChart = {
  title: 'Tokens by helper',
  sub: '',
  stack: [],
  legend: [],
  fmt: (v) => String(v),
  unit: 'tokens',
}

export const FALLBACK_SPEND_CHART: BarChart = {
  title: 'Spend by channel',
  sub: '',
  stack: [],
  legend: [],
  fmt: (v) => `$${(v * 0.1).toFixed(2)}`,
  unit: '',
}

// ── URL query helpers ─────────────────────────────────────────────────────────

const TAB_IDS: TabId[] = ['overview', 'helpers', 'loops', 'reliability', 'activity']

function readQuery() {
  if (typeof window === 'undefined') return { tab: 'overview' as TabId, state: null as string | null }
  const q = new URLSearchParams(window.location.search)
  const state = q.get('state')
  const t = q.get('tab') as TabId | null
  const tab = t && TAB_IDS.includes(t) ? t : state ? 'helpers' : 'overview'
  return { tab, state }
}

// ── AnalyticsPage ─────────────────────────────────────────────────────────────

export function AnalyticsPage({
  meta,
  title,
  sub,
  left,
  right,
}: {
  meta: string
  title: string
  sub: string
  left: BarChart
  right: BarChart
}) {
  const [{ tab: initialTab, state }] = useState(readQuery)
  const [tab, setTab] = useState<TabId>(initialTab)
  const [range, setRange] = useState('7 days')

  const overviewQ = useAnalyticsOverview(range)
  const helpersQ = useAnalyticsHelpers(range)

  const [helperFilter, setHelperFilter] = useState(ALL_HELPERS)

  const isError = overviewQ.isError || helpersQ.isError
  const stats = (overviewQ.data?.stats ?? []).map(toDisplayStat)
  const allRows = (helpersQ.data ?? []).map(toDomainRow)
  // Apply the toolbar helper filter so the overview/helpers lists genuinely narrow.
  const rows =
    helperFilter === ALL_HELPERS ? allRows : allRows.filter((r) => r.name === helperFilter)
  const helpersSub = rows.length === 0 ? '' : `${rows.length} helper${rows.length === 1 ? '' : 's'}`

  // BudgetDrawer state — P5d, left unchanged
  const [reached, setReached] = useState(state === 'budget-reached')
  const [toast, setToast] = useState(state === 'budget-reached')
  const [budgetFor, setBudgetFor] = useState<LocalHelperRow | null>(() =>
    state === 'budget' ? (rows[0] ?? null) : null,
  )

  // budget-reached demo: mark the first helper as reached (URL-param demo only)
  const reachedId = reached && rows.length > 0 ? rows[0].id : undefined

  return (
    <>
      <Topbar icon={ChartLine} title="Analytics" meta={meta} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-[16px] px-[24px] py-[20px]">
          <PageHeader title={title} sub={sub} />
          <Tabs value={tab} onChange={setTab} />
          <Toolbar
            range={range}
            onRange={setRange}
            helperNames={allRows.map((r) => r.name)}
            helperFilter={helperFilter}
            onHelperFilter={setHelperFilter}
          />

          {isError && (
            <div className="flex w-full items-center justify-center rounded-lg bg-bad-tint p-[24px] text-[14px] text-bad outline-1 -outline-offset-1 outline-bad-line">
              Something went wrong loading analytics. Try again.
            </div>
          )}

          {!isError && tab === 'overview' && (
            <>
              {stats.length === 0 && rows.length === 0 ? (
                <div className="flex w-full items-center justify-center p-[48px] text-[14px] text-muted">
                  No data for this period.
                </div>
              ) : (
                <OverviewTab
                  stats={stats}
                  left={left}
                  right={right}
                  rows={rows.slice(0, 4)}
                  helpersSub={helpersSub}
                  onSetBudget={setBudgetFor}
                />
              )}
            </>
          )}
          {!isError && tab === 'helpers' && (
            <HelpersTab list={rows} reachedId={reachedId} onSetBudget={setBudgetFor} />
          )}
          {tab === 'loops' && <LoopsTab />}
          {tab === 'reliability' && <ReliabilityTab />}
          {tab === 'activity' && <ActivityTab />}
        </div>
      </div>
      <BudgetDrawer
        helper={budgetFor}
        onClose={() => {
          if (reached) setReached(false)
          setBudgetFor(null)
        }}
      />
      {toast && (
        <BudgetToast
          title="Budget limit reached"
          body="A helper hit its budget. Raise the budget or allow this one job."
          onClose={() => setToast(false)}
        />
      )}
    </>
  )
}
