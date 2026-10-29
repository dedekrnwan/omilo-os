import { useState } from 'react'
import { ChartLine } from 'lucide-react'
import { Topbar } from '../../ui/ds/Frame'
import type { AnalyticsOverview, HelperStat as DomainHelperStat } from '../../core/domain/types'
import {
  useAllowHelperJob,
  useAnalyticsHelpersFor,
  useAnalyticsOverviewFor,
  useSpendByChannel,
  useTokensByHelper,
} from '../../app/queries'
import { notify } from '../../ui/ds/Toaster'
import { BudgetDrawer, BudgetToast } from './BudgetDrawer'
import { PERIOD_SUFFIX, RANGE_KEY, asArea, jobsChart, stackedChart, toDisplayStat } from './data'
import type { BarChart, HelperStat, HelperStatus, RangeLabel } from './data'
import { formatCredits, formatTokens, relativeTime } from './format'
import { ALL_HELPERS, PageHeader, Tabs, Toolbar } from './parts'
import type { TabId } from './parts'
import { ActivityTab, HelpersTab, LoopsTab, OverviewTab, ReliabilityTab } from './tabs'

/** Display row for a helper — the analytics HelperStat view model. */
export type LocalHelperRow = HelperStat

/** Which chart a card shows: built from the matching analytics endpoint. */
export type ChartKind = 'spend' | 'tokens' | 'jobs'

// ── Shape conversion ──────────────────────────────────────────────────────────

const STATUSES: HelperStatus[] = ['working', 'idle', 'needs', 'paused']

function toDomainRow(h: DomainHelperStat): LocalHelperRow {
  const status = (STATUSES as string[]).includes(h.status ?? '') ? (h.status as HelperStatus) : 'idle'
  const budget = h.budget
    ? { spent: h.budget.spent, limit: h.budget.limit, warn: h.budget.limit > 0 && h.budget.spent / h.budget.limit >= 0.8 }
    : undefined
  return {
    id: h.helperId,
    name: h.name,
    area: asArea(h.area),
    role: h.role ?? '',
    doing: h.doing ?? '',
    status,
    jobs: String(h.jobs),
    // success is 0-100; '—' when the helper hasn't run in this period
    success: h.jobs === 0 ? '—' : `${h.success}%`,
    successWarn: h.success < 80 && h.jobs > 0,
    tokens: formatTokens(h.tokens),
    spend: formatCredits(h.spend),
    budget,
    budgetReached: !!h.budgetReached,
    lastActive: relativeTime(h.lastActive),
  }
}

function seriesValues(o: AnalyticsOverview | undefined, label: string): number[] {
  return o?.series.find((s) => s.label === label)?.values ?? []
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
  channelId,
}: {
  meta: string
  title: string
  sub: string
  left: ChartKind
  right: ChartKind
  /** Scope every number to one channel (chat analytics); omit for company-wide. */
  channelId?: string
}) {
  const [{ tab: initialTab, state }] = useState(readQuery)
  const [tab, setTab] = useState<TabId>(initialTab)
  const [range, setRange] = useState<RangeLabel>('7 days')
  const rangeKey = RANGE_KEY[range]

  const overviewQ = useAnalyticsOverviewFor(rangeKey, channelId)
  const helpersQ = useAnalyticsHelpersFor(rangeKey, channelId)
  const spendQ = useSpendByChannel(rangeKey, channelId)
  const tokensQ = useTokensByHelper(rangeKey, channelId)
  const allowJob = useAllowHelperJob()

  const [helperFilter, setHelperFilter] = useState(ALL_HELPERS)

  const isError = overviewQ.isError || helpersQ.isError
  const stats = (overviewQ.data?.stats ?? []).map((s) => toDisplayStat(s, rangeKey))
  const allRows = (helpersQ.data ?? []).map(toDomainRow)
  // Apply the toolbar helper filter so the overview/helpers lists genuinely narrow.
  const rows = helperFilter === ALL_HELPERS ? allRows : allRows.filter((r) => r.name === helperFilter)
  const working = rows.filter((r) => r.status === 'working').length
  const helpersSub =
    rows.length === 0
      ? ''
      : `${rows.length} helper${rows.length === 1 ? '' : 's'}${working ? ` · ${working} working now` : ''}`

  const periodWord = PERIOD_SUFFIX[rangeKey] ?? 'this week'
  const charts: Record<ChartKind, BarChart> = {
    jobs: jobsChart(
      seriesValues(overviewQ.data, 'Done'),
      seriesValues(overviewQ.data, 'Failed'),
      overviewQ.data?.buckets ?? [],
    ),
    spend: stackedChart('spend', spendQ.data, periodWord),
    tokens: stackedChart('tokens', tokensQ.data, periodWord),
  }

  // Budget reached is real: a helper whose month-to-date spend hit its budget.
  const reachedRow = allRows.find((r) => r.budgetReached)
  const [toastDismissed, setToastDismissed] = useState(false)
  const [budgetFor, setBudgetFor] = useState<LocalHelperRow | null>(null)
  const [budgetFromUrl, setBudgetFromUrl] = useState(state === 'budget')
  if (budgetFromUrl && !budgetFor && allRows.length > 0) {
    setBudgetFromUrl(false)
    setBudgetFor(allRows[0])
  }

  const allowOneMore = (h: LocalHelperRow) =>
    allowJob.mutate(h.id, {
      onSuccess: () => notify(`Allowed one more job for ${h.name}`),
      onError: () => notify(`Couldn't allow a job for ${h.name}`),
    })

  return (
    <>
      <Topbar icon={ChartLine} title="Analytics" meta={meta} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-[16px] px-[24px] py-[20px]">
          <PageHeader title={title} sub={sub} />
          <Tabs value={tab} onChange={setTab} />
          <Toolbar
            range={range}
            onRange={(r) => setRange(r as RangeLabel)}
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
              {overviewQ.isLoading || helpersQ.isLoading ? (
                <div className="flex w-full items-center justify-center p-[48px] text-[14px] text-muted">
                  Loading analytics…
                </div>
              ) : stats.length === 0 && rows.length === 0 ? (
                <div className="flex w-full items-center justify-center p-[48px] text-[14px] text-muted">
                  No data for this period.
                </div>
              ) : (
                <OverviewTab
                  stats={stats}
                  left={charts[left]}
                  right={charts[right]}
                  rows={rows.slice(0, 4)}
                  helpersSub={helpersSub}
                  onSetBudget={setBudgetFor}
                />
              )}
            </>
          )}
          {!isError && tab === 'helpers' && (
            <HelpersTab list={rows} onSetBudget={setBudgetFor} onAllowJob={allowOneMore} />
          )}
          {tab === 'loops' && <LoopsTab range={rangeKey} />}
          {tab === 'reliability' && (
            <ReliabilityTab range={rangeKey} channelId={channelId} onRaiseBudget={() => setTab('helpers')} />
          )}
          {tab === 'activity' && <ActivityTab helpers={allRows} channelId={channelId} />}
        </div>
      </div>
      <BudgetDrawer helper={budgetFor} onClose={() => setBudgetFor(null)} />
      {reachedRow && !toastDismissed && (
        <BudgetToast
          title="Budget limit reached"
          body={`${reachedRow.name} hit its monthly budget and is paused. Raise the budget or allow one more job.`}
          onClose={() => setToastDismissed(true)}
        />
      )}
    </>
  )
}
