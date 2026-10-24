import { useState } from 'react'
import { Plug, Repeat, TriangleAlert, UserPlus } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import {
  activity,
  activityKinds,
  causes,
  causesTip,
  failures,
  helpers,
  loops,
  loopsSub,
  loopsTip,
  reliabilityStats,
} from './data'
import type { BarChart, HelperStat, Stat } from './data'
import {
  BarChartCard,
  BigButton,
  Callout,
  Card,
  CardTitle,
  Checkbox,
  Chip,
  HelperStatusLabel,
  HelpersTable,
  Mini,
  StatRow,
  Switch,
  Track,
} from './parts'

// ── Overview (pen fqQP5 / gcqA2) ──────────────────────────────────────────────

export function OverviewTab({
  stats,
  left,
  right,
  rows,
  helpersSub,
  onSetBudget,
}: {
  stats: Stat[]
  left: BarChart
  right: BarChart
  rows: HelperStat[]
  helpersSub: string
  onSetBudget?: (h: HelperStat) => void
}) {
  return (
    <>
      <StatRow stats={stats} />
      <div className="flex w-full gap-[12px]">
        <BarChartCard chart={left} className="min-w-0 flex-1" />
        <BarChartCard chart={right} className="w-[460px] shrink-0" />
      </div>
      <HelpersTable rows={rows} sub={helpersSub} onSetBudget={onSetBudget} />
    </>
  )
}

// ── Helpers (pen MLPUB; budget reached = EIxIX) ───────────────────────────────

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[2px] rounded-base bg-soft px-[10px] py-[8px]">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="font-mono text-[15px] text-ink">{value}</span>
    </div>
  )
}

function HelperCard({
  h,
  reached,
  onSetBudget,
}: {
  h: HelperStat
  reached?: boolean
  onSetBudget: (h: HelperStat) => void
}) {
  const b = h.budget
  return (
    <section
      aria-label={h.name}
      className={`flex min-w-0 flex-1 flex-col gap-[14px] rounded-lg p-[16px] outline-1 -outline-offset-1 ${
        reached ? 'bg-warn-tint outline-warn-line' : 'bg-surface outline-line-strong'
      }`}
    >
      <div className="flex w-full items-center gap-[12px]">
        <Mascot helper area={h.area} size={40} radius={11} working={h.status === 'working' && !reached} />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <h3 className="m-0 text-[14px] font-semibold text-ink">{h.name}</h3>
          <span className="text-[12px] text-muted">{h.role}</span>
        </div>
        <HelperStatusLabel status={h.status} reached={reached} />
      </div>
      <div className="flex w-full gap-[8px]">
        <Metric label="Jobs" value={h.jobs} />
        <Metric label="Success" value={h.success} />
        <Metric label="Tokens" value={h.tokens} />
        <Metric label="Spend" value={h.spend} />
      </div>
      <div className="flex w-full flex-col gap-[6px]">
        <div className="flex w-full items-center">
          <span className="min-w-0 flex-1 text-[11px] text-muted">Budget this month</span>
          {b ? (
            <span className={`font-mono text-[11px] ${reached ? 'text-warn' : 'text-ink-2'}`}>
              ${b.spent} / ${b.limit}
              {reached && ' · reached'}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onSetBudget(h)}
              className="text-[11px] font-medium text-link hover:underline"
            >
              Set budget
            </button>
          )}
        </div>
        <Track
          pct={b ? b.spent / b.limit : 0}
          color={reached ? 'var(--color-bad-solid)' : b?.warn ? 'var(--color-warn)' : 'var(--color-ink)'}
        />
      </div>
      {reached && (
        <div className="flex w-full items-center gap-[6px]">
          <BigButton kind="primary" onClick={() => onSetBudget(h)}>
            Raise budget
          </BigButton>
          <BigButton kind="secondary">Allow this job</BigButton>
        </div>
      )}
    </section>
  )
}

export function HelpersTab({
  list = helpers,
  reachedId,
  onSetBudget,
}: {
  list?: HelperStat[]
  reachedId?: string
  onSetBudget: (h: HelperStat) => void
}) {
  const rows = [list.slice(0, 3), list.slice(3, 5)]
  return (
    <div className="flex w-full flex-col gap-[12px]">
      {rows.map((row, i) => (
        <div key={i} className="flex w-full items-start gap-[12px]">
          {row.map((h) => (
            <HelperCard key={h.id} h={h} reached={h.id === reachedId} onSetBudget={onSetBudget} />
          ))}
          {i === 1 && (
            <button
              type="button"
              className="flex h-[174px] min-w-0 flex-1 flex-col items-center justify-center gap-[6px] rounded-lg p-[16px] outline-[1.5px] -outline-offset-[1.5px] outline-wire-strong hover:bg-soft"
            >
              <UserPlus size={20} aria-hidden className="text-muted" />
              <span className="text-[13px] font-semibold text-ink">Hire a helper</span>
              <span className="text-[12px] text-muted">Pick from roles or Personas</span>
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Loops (pen BcTka) ─────────────────────────────────────────────────────────

export function LoopsTab() {
  const [on, setOn] = useState(() => Object.fromEntries(loops.map((l) => [l.id, l.on])))
  return (
    <>
      <Card className="flex flex-col overflow-hidden">
        <CardTitle title="Loops" sub={loopsSub} />
        <div className="flex w-full gap-[12px] bg-soft px-[16px] py-[8px] shadow-[inset_0_1px_0_var(--color-line),inset_0_-1px_0_var(--color-line)]">
          {[
            ['Loop', 'min-w-0 flex-1'],
            ['Schedule', 'w-[150px]'],
            ['Next run', 'w-[120px]'],
            ['Last result', 'w-[110px]'],
            ['Runs · 7d', 'w-[80px]'],
            ['Avg cost', 'w-[70px]'],
            ['On', 'w-[40px]'],
          ].map(([l, w]) => (
            <span key={l} className={`${w} shrink-0 text-[11px] font-medium text-muted`}>
              {l}
            </span>
          ))}
        </div>
        {loops.map((l, i) => (
          <div
            key={l.id}
            className={`flex w-full items-center gap-[12px] px-[16px] py-[10px] ${
              i < loops.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
            } ${on[l.id] ? '' : 'opacity-60'}`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-[10px]">
              <Mini area={l.area} />
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="text-[13px] font-semibold text-ink">{l.name}</span>
                <span className="text-[12px] text-muted">{l.helper}</span>
              </div>
            </div>
            <span className="flex w-[150px] shrink-0 items-center gap-[6px]">
              <Repeat size={13} aria-hidden className="text-muted" />
              <span className="text-[12px] text-ink-2">{l.schedule}</span>
            </span>
            <span className="w-[120px] shrink-0 font-mono text-[11px] text-ink-2">{l.next}</span>
            <span className="w-[110px] shrink-0">
              <Chip tone={l.result.tone}>{l.result.label}</Chip>
            </span>
            <span className="w-[80px] shrink-0 font-mono text-[12px] text-ink">{l.runs}</span>
            <span className="w-[70px] shrink-0 font-mono text-[12px] text-ink">{l.cost}</span>
            <span className="w-[40px] shrink-0">
              <Switch on={on[l.id]} label={`${l.name} on`} onChange={(v) => setOn((s) => ({ ...s, [l.id]: v }))} />
            </span>
          </div>
        ))}
      </Card>
      <Callout icon={TriangleAlert} tone="warn">
        {loopsTip}
      </Callout>
    </>
  )
}

// ── Reliability (pen Q7dBso) ──────────────────────────────────────────────────

export function ReliabilityTab() {
  const max = Math.max(...causes.map((c) => c.count))
  return (
    <>
      <StatRow stats={reliabilityStats} />
      <div className="flex w-full items-start gap-[12px]">
        <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <CardTitle title="Recent failures" sub="6 this week" divider />
          {failures.map((f, i) => (
            <div
              key={f.id}
              className={`flex w-full items-center gap-[12px] px-[16px] py-[12px] ${
                i < failures.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
              }`}
            >
              <Mini area={f.area} />
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="text-[13px] font-semibold text-ink">{f.job}</span>
                <span className="truncate text-[12px] text-muted">{f.cause}</span>
              </div>
              <span className="font-mono text-[11px] text-muted">{f.when}</span>
              <Chip tone={f.status.tone}>{f.status.label}</Chip>
              <BigButton kind={f.action.kind}>{f.action.label}</BigButton>
            </div>
          ))}
        </Card>
        <Card className="flex w-[360px] shrink-0 flex-col overflow-hidden">
          <CardTitle title="Top causes" sub="last 30 days" divider />
          <div className="flex w-full flex-col gap-[12px] p-[16px]">
            {causes.map((c) => (
              <div key={c.label} className="flex w-full flex-col gap-[6px]">
                <div className="flex w-full items-center">
                  <span className="min-w-0 flex-1 text-[12px] text-ink-2">{c.label}</span>
                  <span className="font-mono text-[11px] text-muted">{c.count}</span>
                </div>
                <Track pct={c.count / max} color="var(--color-bad-solid)" height={6} />
              </div>
            ))}
          </div>
          <div className="w-full px-[16px] pb-[16px]">
            <Callout icon={Plug} tone="soft">
              {causesTip}
            </Callout>
          </div>
        </Card>
      </div>
    </>
  )
}

// ── Activity (pen Ui79T) ──────────────────────────────────────────────────────

const FILTER_HELPERS = helpers.slice(0, 4)

export function ActivityTab() {
  const [kinds, setKinds] = useState(() => activityKinds.map((k) => k.on))
  const [who, setWho] = useState(() => FILTER_HELPERS.map(() => true))
  return (
    <div className="flex w-full items-start gap-[12px]">
      <Card className="flex min-w-0 flex-1 flex-col py-[6px]">
        {activity.map((g) => (
          <div key={g.group} className="flex flex-col">
            <h3 className="m-0 px-[16px] pt-[10px] pb-[4px] text-[11px] font-semibold tracking-[1px] text-faint">
              {g.group}
            </h3>
            {g.items.map((a) => (
              <div key={a.id} className="flex w-full gap-[12px] px-[16px] py-[8px]">
                <span className="w-[44px] shrink-0 font-mono text-[11px] text-muted">{a.time}</span>
                <Mini area={a.area} />
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="flex items-center gap-[6px] text-[13px]">
                    <span className="font-semibold text-ink">{a.who}</span>
                    <span className="text-ink-2">{a.what}</span>
                  </span>
                  <span className="text-[12px] text-muted">{a.meta}</span>
                </div>
                <Chip tone={a.status.tone}>{a.status.label}</Chip>
              </div>
            ))}
          </div>
        ))}
      </Card>
      <Card className="flex w-[260px] shrink-0 flex-col gap-[14px] p-[16px]">
        <h3 className="m-0 text-[13px] font-semibold text-ink">Show</h3>
        {activityKinds.map((k, i) => (
          <label key={k.label} className="flex w-full items-center gap-[8px]">
            <Checkbox on={kinds[i]} label={k.label} onChange={(v) => setKinds((s) => s.map((x, j) => (j === i ? v : x)))} />
            <span className="min-w-0 flex-1 text-[13px] text-ink-2">{k.label}</span>
            <span className="font-mono text-[11px] text-muted">{k.count}</span>
          </label>
        ))}
        <div className="h-px w-full bg-line" />
        <h3 className="m-0 text-[13px] font-semibold text-ink">Helpers</h3>
        {FILTER_HELPERS.map((h, i) => (
          <label key={h.id} className="flex w-full items-center gap-[8px]">
            <Checkbox on={who[i]} label={h.name} onChange={(v) => setWho((s) => s.map((x, j) => (j === i ? v : x)))} />
            <Mini area={h.area} size={20} />
            <span className="text-[13px] text-ink-2">{h.name}</span>
          </label>
        ))}
      </Card>
    </div>
  )
}
