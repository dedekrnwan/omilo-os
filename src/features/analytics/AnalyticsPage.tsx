import { useState } from 'react'
import { ChartLine, Download } from 'lucide-react'
import { Button } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { BudgetDrawer, BudgetToast } from './BudgetDrawer'
import { builderReached, helpers } from './data'
import type { BarChart, HelperStat, Stat } from './data'
import { PageHeader, Tabs, Toolbar } from './parts'
import type { TabId } from './parts'
import { ActivityTab, HelpersTab, LoopsTab, OverviewTab, ReliabilityTab } from './tabs'

const TAB_IDS: TabId[] = ['overview', 'helpers', 'loops', 'reliability', 'activity']

/**
 * Screenshot-able states via the query string (states are not routes):
 *   ?tab=helpers|loops|reliability|activity
 *   ?state=budget          → Set budget drawer for Support (pen b10Wfq)
 *   ?state=budget-reached  → Builder hit its budget + toast (pen EIxIX)
 */
function readQuery() {
  if (typeof window === 'undefined') return { tab: 'overview' as TabId, state: null as string | null }
  const q = new URLSearchParams(window.location.search)
  const state = q.get('state')
  const t = q.get('tab') as TabId | null
  const tab = t && TAB_IDS.includes(t) ? t : state ? 'helpers' : 'overview'
  return { tab, state }
}

export interface AnalyticsScope {
  meta: string
  title: string
  sub: string
  stats: Stat[]
  left: BarChart
  right: BarChart
  helpersSub: string
}

export function AnalyticsPage({ scope }: { scope: AnalyticsScope }) {
  const [{ tab: initialTab, state }] = useState(readQuery)
  const [tab, setTab] = useState<TabId>(initialTab)
  const [range, setRange] = useState('7 days')
  const [reached, setReached] = useState(state === 'budget-reached')
  const [toast, setToast] = useState(state === 'budget-reached')
  const [budgetFor, setBudgetFor] = useState<HelperStat | null>(() =>
    state === 'budget' ? (helpers.find((h) => h.id === 'support') ?? null) : null,
  )
  const list = reached ? helpers.map((h) => (h.id === builderReached.id ? builderReached : h)) : helpers

  return (
    <>
      <Topbar
        icon={ChartLine}
        title="Analytics"
        meta={scope.meta}
        actions={
          <Button height={28} icon={Download}>
            Export
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-[16px] px-[24px] py-[20px]">
          <PageHeader title={scope.title} sub={scope.sub} />
          <Tabs value={tab} onChange={setTab} />
          <Toolbar range={range} onRange={setRange} />
          {tab === 'overview' && (
            <OverviewTab
              stats={scope.stats}
              left={scope.left}
              right={scope.right}
              rows={list.slice(0, 4)}
              helpersSub={scope.helpersSub}
              onSetBudget={setBudgetFor}
            />
          )}
          {tab === 'helpers' && (
            <HelpersTab list={list} reachedId={reached ? builderReached.id : undefined} onSetBudget={setBudgetFor} />
          )}
          {tab === 'loops' && <LoopsTab />}
          {tab === 'reliability' && <ReliabilityTab />}
          {tab === 'activity' && <ActivityTab />}
        </div>
      </div>
      <BudgetDrawer
        helper={budgetFor}
        onClose={() => {
          if (budgetFor?.id === builderReached.id) setReached(false)
          setBudgetFor(null)
        }}
      />
      {toast && (
        <BudgetToast
          title={`Builder hit its $${builderReached.budget?.limit} budget`}
          body="Paused before Fix OTP retry limit. Raise the budget or allow this one job."
          onClose={() => setToast(false)}
        />
      )}
    </>
  )
}
