import { useState } from 'react'
import { Plug, Repeat, TriangleAlert, UserPlus } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Mascot } from '../../ui/ds/Mascot'
import { notify } from '../../ui/ds/Toaster'
import {
  useActivity,
  useAnalyticsFailures,
  useAnalyticsLoops,
  useAnalyticsReliability,
  useRetryJob,
  useUpdateFlow,
  useUpdateRoutine,
} from '../../app/queries'
import type { ActivityEntry, AnalyticsFailure, AnalyticsLoop } from '../../core/domain/types'
import {
  ACTIVITY_KINDS,
  ACTIVITY_STATUS,
  FAILURE_ACTION,
  FAILURE_STATUS,
  asArea,
  resultChip,
  toDisplayStat,
} from './data'
import type { BarChart, Stat } from './data'
import type { LocalHelperRow } from './AnalyticsPage'
import { formatTokens, nextRunLabel } from './format'
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
import { EmptyState } from '../../ui/ds/EmptyState'

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
  rows: LocalHelperRow[]
  helpersSub: string
  onSetBudget?: (h: LocalHelperRow) => void
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
  onSetBudget,
  onAllowJob,
}: {
  h: LocalHelperRow
  onSetBudget: (h: LocalHelperRow) => void
  onAllowJob?: (h: LocalHelperRow) => void
}) {
  const b = h.budget
  const reached = !!h.budgetReached
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
      </div>
      <div className="flex w-full flex-col gap-[6px]">
        <div className="flex w-full items-center">
          <span className="min-w-0 flex-1 text-[11px] text-muted">Token budget this month</span>
          {b ? (
            <button
              type="button"
              onClick={() => onSetBudget(h)}
              className={`font-mono text-[11px] hover:underline ${reached ? 'text-warn' : 'text-ink-2'}`}
            >
              {formatTokens(b.spent)} / {formatTokens(b.limit)} tokens
              {reached && ' · reached'}
            </button>
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
          pct={b && b.limit > 0 ? b.spent / b.limit : 0}
          color={reached ? 'var(--color-bad-solid)' : b?.warn ? 'var(--color-warn)' : 'var(--color-ink)'}
        />
      </div>
      {reached && (
        <div className="flex w-full items-center gap-[6px]">
          <BigButton kind="primary" onClick={() => onSetBudget(h)}>
            Raise budget
          </BigButton>
          <BigButton kind="secondary" onClick={() => onAllowJob?.(h)}>
            Allow this job
          </BigButton>
        </div>
      )}
    </section>
  )
}

export function HelpersTab({
  list = [],
  onSetBudget,
  onAllowJob,
}: {
  list?: LocalHelperRow[]
  onSetBudget: (h: LocalHelperRow) => void
  onAllowJob?: (h: LocalHelperRow) => void
}) {
  const navigate = useNavigate()
  // Three cards per row; the "Hire a helper" tile closes the last row.
  const cells: (LocalHelperRow | 'hire')[] = [...list, 'hire']
  const rows: (LocalHelperRow | 'hire')[][] = []
  for (let i = 0; i < cells.length; i += 3) rows.push(cells.slice(i, i + 3))
  return (
    <div className="flex w-full flex-col gap-[12px]">
      {rows.map((row, i) => (
        <div key={i} className="flex w-full items-start gap-[12px]">
          {row.map((h) =>
            h === 'hire' ? (
              <button
                key="hire"
                type="button"
                onClick={() => void navigate({ to: '/team' })}
                className="flex h-[174px] min-w-0 flex-1 flex-col items-center justify-center gap-[6px] rounded-lg p-[16px] outline-[1.5px] -outline-offset-[1.5px] outline-wire-strong hover:bg-soft"
              >
                <UserPlus size={20} aria-hidden className="text-muted" />
                <span className="text-[13px] font-semibold text-ink">Hire a helper</span>
                <span className="text-[12px] text-muted">Pick from roles or Personas</span>
              </button>
            ) : (
              <HelperCard key={h.id} h={h} onSetBudget={onSetBudget} onAllowJob={onAllowJob} />
            ),
          )}
          {row.length < 3 && Array.from({ length: 3 - row.length }, (_, k) => <span key={k} className="min-w-0 flex-1" />)}
        </div>
      ))}
    </div>
  )
}

// ── Loops (pen BcTka) ─────────────────────────────────────────────────────────

export function LoopsTab({ range = 'week' }: { range?: string }) {
  const navigate = useNavigate()
  const { data: loops = [], isLoading, isError } = useAnalyticsLoops(range)
  const updateRoutine = useUpdateRoutine()
  const updateFlow = useUpdateFlow()
  // Optimistic on/off overlay so the switch flips immediately.
  const [override, setOverride] = useState<Record<string, boolean>>({})
  const isOn = (l: AnalyticsLoop) => override[l.id] ?? l.on

  const toggle = (l: AnalyticsLoop, v: boolean) => {
    setOverride((s) => ({ ...s, [l.id]: v }))
    const done = {
      onSuccess: () => notify(`${l.name} ${v ? 'resumed' : 'paused'}`),
      onError: () => {
        setOverride((s) => ({ ...s, [l.id]: !v }))
        notify(`Couldn't update ${l.name}`)
      },
    }
    if (l.kind === 'routine') updateRoutine.mutate({ id: l.id, input: { paused: !v } }, done)
    else updateFlow.mutate({ id: l.id, input: { enabled: v } }, done)
  }

  const active = loops.filter(isOn).length
  const failed = loops.find((l) => isOn(l) && l.lastResult === 'failed')

  return (
    <>
      <Card className="flex flex-col overflow-hidden">
        <CardTitle title="Loops" sub={`Jobs your helpers repeat on a schedule · ${active} active`} />
        <div className="flex w-full gap-[12px] bg-soft px-[16px] py-[8px] shadow-[inset_0_1px_0_var(--color-line),inset_0_-1px_0_var(--color-line)]">
          {[
            ['Loop', 'min-w-0 flex-1'],
            ['Schedule', 'w-[150px]'],
            ['Next run', 'w-[120px]'],
            ['Last result', 'w-[110px]'],
            ['Runs', 'w-[80px]'],
            ['Avg tokens', 'w-[70px]'],
            ['On', 'w-[40px]'],
          ].map(([l, w]) => (
            <span key={l} className={`${w} shrink-0 text-[11px] font-medium text-muted`}>
              {l}
            </span>
          ))}
        </div>
        {isLoading && <p className="m-0 px-[16px] py-[20px] text-[13px] text-muted">Loading loops…</p>}
        {isError && (
          <EmptyState
            mood="worried"
            title="Couldn't load loops"
            description="Check your connection and try again."
            primary={{ label: 'Try again', onClick: () => window.location.reload() }}
          />
        )}
        {!isLoading && !isError && loops.length === 0 && (
          <EmptyState
            title="No loops yet"
            description="Loops are the work that repeats — add a routine or a scheduled flow and its runs, cost and success rate show up here."
          />
        )}
        {loops.map((l, i) => {
          const on = isOn(l)
          const result = resultChip(l.lastResult, on)
          return (
            <div
              key={l.id}
              className={`flex w-full items-center gap-[12px] px-[16px] py-[10px] ${
                i < loops.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
              } ${on ? '' : 'opacity-60'}`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-[10px]">
                <Mini area={asArea(l.area)} />
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="text-[13px] font-semibold text-ink">{l.name}</span>
                  <span className="text-[12px] text-muted">{l.helperName ?? 'Flow'}</span>
                </div>
              </div>
              <span className="flex w-[150px] shrink-0 items-center gap-[6px]">
                <Repeat size={13} aria-hidden className="text-muted" />
                <span className="text-[12px] text-ink-2">{l.schedule}</span>
              </span>
              <span className="w-[120px] shrink-0 font-mono text-[11px] text-ink-2">{on ? nextRunLabel(l.nextAt) : '—'}</span>
              <span className="w-[110px] shrink-0">
                <Chip tone={result.tone}>{result.label}</Chip>
              </span>
              <span className="w-[80px] shrink-0 font-mono text-[12px] text-ink">{l.runs}</span>
              <span className="w-[70px] shrink-0 font-mono text-[12px] text-ink">{formatTokens(l.avgTokens)}</span>
              <span className="w-[40px] shrink-0">
                <Switch on={on} label={`${l.name} on`} onChange={(v) => toggle(l, v)} />
              </span>
            </div>
          )
        })}
      </Card>
      {failed && (
        <Callout icon={TriangleAlert} tone="warn">
          {failed.name} failed on its last run.{' '}
          <button
            type="button"
            className="font-medium text-link hover:underline"
            onClick={() => void navigate({ to: failed.kind === 'routine' ? '/routines' : '/flows' })}
          >
            Open it
          </button>{' '}
          or retry it from Reliability.
        </Callout>
      )}
    </>
  )
}

// ── Reliability (pen Q7dBso) ──────────────────────────────────────────────────

const WHEN = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

export function ReliabilityTab({
  range = 'week',
  channelId,
  onRaiseBudget,
}: {
  range?: string
  channelId?: string
  onRaiseBudget?: () => void
}) {
  const navigate = useNavigate()
  const rel = useAnalyticsReliability(range, channelId)
  const fails = useAnalyticsFailures(range, channelId)
  const retry = useRetryJob()
  const stats = (rel.data?.stats ?? []).map((s) => toDisplayStat(s, range))
  const causes = rel.data?.causes ?? []
  const failures = fails.data ?? []
  const max = Math.max(1, ...causes.map((c) => c.count))
  const failedCount = failures.filter((f) => f.status !== 'recovered').length

  const runFailureAction = (f: AnalyticsFailure) => {
    switch (f.action) {
      case 'connect':
        return void navigate({ to: '/control-panel/$section', params: { section: 'connectors' } })
      case 'budget':
        return onRaiseBudget?.()
      case 'retry':
        notify(`Retrying “${f.title}”`)
        retry.mutate(f.jobId, {
          onSuccess: (r) =>
            notify(r.status === 'done' ? `“${f.title}” finished on retry` : `“${f.title}”: ${r.status}`),
          onError: (e) => notify(`Couldn't retry “${f.title}”${e instanceof Error && e.message ? ` — ${e.message}` : ''}`),
        })
        return
      case 'view':
      default:
        return void navigate({ to: '/inbox' })
    }
  }
  return (
    <>
      {stats.length > 0 && <StatRow stats={stats} />}
      <div className="flex w-full items-start gap-[12px]">
        <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <CardTitle title="Recent failures" sub={`${failedCount} still failing`} divider />
          {(rel.isLoading || fails.isLoading) && (
            <p className="m-0 px-[16px] py-[20px] text-[13px] text-muted">Loading…</p>
          )}
          {fails.isError && <p className="m-0 px-[16px] py-[20px] text-[13px] text-bad">Couldn't load failures.</p>}
          {!fails.isLoading && !fails.isError && failures.length === 0 && (
            <p className="m-0 px-[16px] py-[20px] text-[13px] text-muted">No failures in this period.</p>
          )}
          {failures.map((f, i) => {
            const st = FAILURE_STATUS[f.status] ?? FAILURE_STATUS.failed
            const act = FAILURE_ACTION[f.action] ?? FAILURE_ACTION.view
            const cause = [f.error || f.cause, f.attempts > 1 ? `Tried ${f.attempts}×` : ''].filter(Boolean).join(' · ')
            return (
              <div
                key={f.jobId}
                className={`flex w-full items-center gap-[12px] px-[16px] py-[12px] ${
                  i < failures.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
                }`}
              >
                <Mini area={asArea(f.area)} />
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="text-[13px] font-semibold text-ink">{f.title}</span>
                  <span className="truncate text-[12px] text-muted">{cause}</span>
                </div>
                <span className="font-mono text-[11px] text-muted">{f.at ? WHEN.format(new Date(f.at)) : '—'}</span>
                <Chip tone={st.tone}>{st.label}</Chip>
                <BigButton kind={act.kind} onClick={() => runFailureAction(f)}>
                  {act.label}
                </BigButton>
              </div>
            )
          })}
        </Card>
        <Card className="flex w-[360px] shrink-0 flex-col overflow-hidden">
          <CardTitle title="Top causes" sub="last 30 days" divider />
          <div className="flex w-full flex-col gap-[12px] p-[16px]">
            {causes.length === 0 && <span className="text-[12px] text-muted">Nothing has failed in 30 days.</span>}
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
          {rel.data?.causesTip && (
            <div className="w-full px-[16px] pb-[16px]">
              <Callout icon={Plug} tone="soft">
                {rel.data.causesTip}
              </Callout>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

// ── Activity (pen Ui79T) ──────────────────────────────────────────────────────

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

function dayGroup(isoStr: string, now = new Date()): string {
  const d = new Date(isoStr)
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayN = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day0 - dayN) / 86_400_000)
  if (diff === 0) return 'TODAY'
  if (diff === 1) return 'YESTERDAY'
  return DAY.format(d).toUpperCase()
}

export function ActivityTab({ helpers = [], channelId }: { helpers?: LocalHelperRow[]; channelId?: string }) {
  const [kinds, setKinds] = useState(() => ACTIVITY_KINDS.map((k) => k.on))
  // Helper ids the user unchecked (default: everyone shown).
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [older, setOlder] = useState<ActivityEntry[]>([])

  const activeKinds = ACTIVITY_KINDS.filter((_, i) => kinds[i]).map((k) => k.kind)
  const shownHelpers = helpers.filter((h) => !hidden.has(h.id)).map((h) => h.id)
  const noneSelected = activeKinds.length === 0 || (helpers.length > 0 && shownHelpers.length === 0)
  const q = useActivity({
    kinds: activeKinds,
    helperIds: hidden.size ? shownHelpers : undefined,
    cursor,
    channelId,
  })
  const items = noneSelected ? [] : [...older, ...(q.data?.items ?? [])]
  const counts = q.data?.counts

  const groups: { group: string; items: ActivityEntry[] }[] = []
  for (const a of items) {
    const g = dayGroup(a.at)
    const last = groups[groups.length - 1]
    if (last && last.group === g) last.items.push(a)
    else groups.push({ group: g, items: [a] })
  }

  const resetPaging = () => {
    setCursor(undefined)
    setOlder([])
  }

  return (
    <div className="flex w-full items-start gap-[12px]">
      <Card className="flex min-w-0 flex-1 flex-col py-[6px]">
        {q.isLoading && !noneSelected && <p className="px-[16px] py-[20px] text-[13px] text-muted">Loading activity…</p>}
        {q.isError && <p className="px-[16px] py-[20px] text-[13px] text-bad">Couldn't load activity.</p>}
        {!q.isLoading && !q.isError && groups.length === 0 && (
          <p className="px-[16px] py-[20px] text-[13px] text-muted">No activity matches these filters.</p>
        )}
        {groups.map((g) => (
          <div key={g.group} className="flex flex-col">
            <h3 className="m-0 px-[16px] pt-[10px] pb-[4px] text-[11px] font-semibold tracking-[1px] text-faint">
              {g.group}
            </h3>
            {g.items.map((a) => {
              const st = ACTIVITY_STATUS[a.kind] ?? ACTIVITY_STATUS.started
              return (
                <div key={a.id} className="flex w-full gap-[12px] px-[16px] py-[8px]">
                  <span className="w-[44px] shrink-0 font-mono text-[11px] text-muted">{TIME.format(new Date(a.at))}</span>
                  <Mini area={asArea(a.area)} />
                  <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="flex items-center gap-[6px] text-[13px]">
                      <span className="font-semibold text-ink">{a.who}</span>
                      <span className="text-ink-2">{a.what}</span>
                    </span>
                    <span className="text-[12px] text-muted">{a.meta}</span>
                  </div>
                  <Chip tone={st.tone}>{st.label}</Chip>
                </div>
              )
            })}
          </div>
        ))}
        {!noneSelected && q.data?.nextCursor && (
          <div className="px-[16px] py-[8px]">
            <BigButton
              kind="quiet"
              onClick={() => {
                setOlder(items)
                setCursor(q.data?.nextCursor ?? undefined)
              }}
            >
              Show older
            </BigButton>
          </div>
        )}
      </Card>
      <Card className="flex w-[260px] shrink-0 flex-col gap-[14px] p-[16px]">
        <h3 className="m-0 text-[13px] font-semibold text-ink">Show</h3>
        {ACTIVITY_KINDS.map((k, i) => (
          <label key={k.kind} className="flex w-full items-center gap-[8px]">
            <Checkbox
              on={kinds[i]}
              label={k.label}
              onChange={(v) => {
                resetPaging()
                setKinds((s) => s.map((x, j) => (j === i ? v : x)))
              }}
            />
            <span className="min-w-0 flex-1 text-[13px] text-ink-2">{k.label}</span>
            <span className="font-mono text-[11px] text-muted">{counts ? counts[k.kind] : '—'}</span>
          </label>
        ))}
        {helpers.length > 0 && (
          <>
            <div className="h-px w-full bg-line" />
            <h3 className="m-0 text-[13px] font-semibold text-ink">Helpers</h3>
            {helpers.map((h) => (
              <label key={h.id} className="flex w-full items-center gap-[8px]">
                <Checkbox
                  on={!hidden.has(h.id)}
                  label={h.name}
                  onChange={(v) => {
                    resetPaging()
                    setHidden((s) => {
                      const n = new Set(s)
                      if (v) n.delete(h.id)
                      else n.add(h.id)
                      return n
                    })
                  }}
                />
                <Mini area={h.area} size={20} />
                <span className="text-[13px] text-ink-2">{h.name}</span>
              </label>
            ))}
          </>
        )}
      </Card>
    </div>
  )
}
