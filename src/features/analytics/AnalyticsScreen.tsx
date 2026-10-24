import { useState } from 'react'
import { Activity, ChartLine, Download, Flame, Repeat, ShieldCheck, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'
import type { HelperArea } from '../../core/domain/types'

// ── Config types ──────────────────────────────────────────────────────────────

interface StatCard {
  label: string
  value: string
  delta: string
  deltaKind: 'up' | 'neutral'
  sub: string
}

interface SeriesStack {
  /** 7 day labels (Wed…Tue). */
  day: string
  /** Stacked segment values, aligned to `legend`. */
  parts: number[]
}

interface LegendItem {
  label: string
  color: string
}

interface HelperStat {
  name: string
  area: HelperArea
  doing: string
  now: 'Working' | 'Idle' | 'Needs you'
  jobs: number
  success: number
  tokens: string
  spend: string
  budgetUsed?: number
  budgetCap?: number
  lastActive: string
}

export interface AnalyticsConfig {
  /** Topbar meta, e.g. "in Engineering" or "All channels". */
  topbarMeta: string
  /** Heading suffix, e.g. "Engineering" or "Sahabat Warga". */
  title: string
  subtitle: string
  stats: StatCard[]
  stackTitle: string
  stackTotal: string
  legend: LegendItem[]
  stack: SeriesStack[]
  jobsTitle: string
  jobs: { day: string; done: number; failed: number }[]
  helpersCaption: string
  helpers: HelperStat[]
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

const TABS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'Overview',    label: 'Overview',    icon: ChartLine },
  { key: 'Helpers',     label: 'Helpers',     icon: Users },
  { key: 'Loops',       label: 'Loops',       icon: Repeat },
  { key: 'Reliability', label: 'Reliability', icon: ShieldCheck },
  { key: 'Activity',    label: 'Activity',    icon: Activity },
]

const RANGES = ['7 days', '30 days', '90 days'] as const

const NOW_DOT: Record<HelperStat['now'], string> = {
  Working: 'var(--color-info)',
  Idle: 'var(--color-faint)',
  'Needs you': '#EB6834',
}

// ── Stat card ───────────────────────────────────────────────────────────────────

function StatCardView({ s }: { s: StatCard }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[6px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[14px]">
      <span className="text-[11.5px] text-muted">{s.label}</span>
      <span className="font-display text-[26px] font-semibold tracking-[-0.6px] text-ink">{s.value}</span>
      <div className="flex items-center gap-[6px] text-[11.5px]">
        <span
          className="rounded-pill px-[6px] py-[1px] font-medium"
          style={
            s.deltaKind === 'up'
              ? { background: 'var(--color-ok-tint)', color: 'var(--color-ok)' }
              : { background: 'var(--color-soft)', color: 'var(--color-muted)' }
          }
        >
          {s.delta}
        </span>
        <span className="text-faint">{s.sub}</span>
      </div>
    </div>
  )
}

// ── Charts ───────────────────────────────────────────────────────────────────────

function StackedBars({ data, legend }: { data: SeriesStack[]; legend: LegendItem[] }) {
  const max = Math.max(...data.map((d) => d.parts.reduce((a, b) => a + b, 0)))
  return (
    <div className="flex h-[150px] items-end gap-[10px]">
      {data.map((d) => {
        const total = d.parts.reduce((a, b) => a + b, 0)
        return (
          <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center gap-[6px]">
            <div className="flex w-full max-w-[34px] flex-1 flex-col-reverse items-stretch justify-start">
              {d.parts.map((v, i) => (
                <span
                  key={i}
                  style={{
                    height: `${(v / max) * 100}%`,
                    background: legend[i]?.color,
                  }}
                  className="first:rounded-b-[3px] last:rounded-t-[3px]"
                />
              ))}
              <span className="sr-only">{total}</span>
            </div>
            <span className="text-[10.5px] text-faint">{d.day}</span>
          </div>
        )
      })}
    </div>
  )
}

function JobsBars({ data }: { data: { day: string; done: number; failed: number }[] }) {
  const max = Math.max(...data.map((d) => d.done + d.failed))
  return (
    <div className="flex h-[150px] items-end gap-[10px]">
      {data.map((d) => (
        <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center gap-[6px]">
          <div className="flex w-full max-w-[34px] flex-1 flex-col-reverse items-stretch">
            <span style={{ height: `${(d.done / max) * 100}%`, background: 'var(--color-ok)' }} className="rounded-b-[3px]" />
            {d.failed > 0 && (
              <span style={{ height: `${(d.failed / max) * 100}%`, background: 'var(--color-bad-solid)' }} className="rounded-t-[3px]" />
            )}
          </div>
          <span className="text-[10.5px] text-faint">{d.day}</span>
        </div>
      ))}
    </div>
  )
}

function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="flex items-center gap-[12px]">
      {items.map((l) => (
        <span key={l.label} className="flex items-center gap-[5px] text-[11px] text-muted">
          <span className="size-[8px] rounded-[2px]" style={{ background: l.color }} />
          {l.label}
        </span>
      ))}
    </div>
  )
}

function ChartCard({
  title,
  total,
  legend,
  children,
}: {
  title: string
  total?: string
  legend: LegendItem[]
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[14px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[16px]">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-ink">
          {title}
          {total && <span className="ml-[6px] text-[11.5px] font-normal text-faint">{total}</span>}
        </span>
        <Legend items={legend} />
      </div>
      {children}
    </div>
  )
}

// ── Helpers table ────────────────────────────────────────────────────────────────

function BudgetBar({ used, cap }: { used?: number; cap?: number }) {
  if (used === undefined || cap === undefined) {
    return (
      <span className="flex items-center gap-[6px]">
        <span className="text-[11.5px] text-faint">No budget</span>
        <button type="button" className="text-[11.5px] font-medium text-link hover:underline">Set</button>
      </span>
    )
  }
  const pct = Math.min(100, Math.round((used / cap) * 100))
  const over = used / cap >= 0.85
  return (
    <span className="flex items-center gap-[8px]">
      <span className="text-[11.5px] text-muted whitespace-nowrap">${used} / ${cap}</span>
      <span className="h-[4px] w-[60px] overflow-hidden rounded-pill bg-line-strong">
        <span
          className="block h-full rounded-pill"
          style={{ width: `${pct}%`, background: over ? 'var(--color-warn)' : 'var(--color-ok)' }}
        />
      </span>
    </span>
  )
}

function HelpersTable({ caption, helpers }: { caption: string; helpers: HelperStat[] }) {
  return (
    <div className="flex flex-col gap-[12px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[16px]">
      <span className="text-[12.5px] font-medium text-ink">{caption}</span>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-left text-[11px] text-muted">
            <th className="pb-[8px] font-medium">Helper</th>
            <th className="pb-[8px] font-medium">Now</th>
            <th className="pb-[8px] font-medium">Jobs</th>
            <th className="pb-[8px] font-medium">Success</th>
            <th className="pb-[8px] font-medium">Tokens</th>
            <th className="pb-[8px] font-medium">Spend</th>
            <th className="pb-[8px] font-medium">Budget (month)</th>
            <th className="pb-[8px] font-medium">Last active</th>
          </tr>
        </thead>
        <tbody>
          {helpers.map((h) => (
            <tr key={h.name} className="border-t border-line">
              <td className="py-[9px]">
                <span className="flex items-center gap-[9px]">
                  <Mascot size={24} radius={7} area={h.area} title={h.name} />
                  <span className="flex flex-col gap-px">
                    <span className="text-[12.5px] font-medium text-ink">{h.name}</span>
                    <span className="text-[11px] text-muted">{h.doing}</span>
                  </span>
                </span>
              </td>
              <td className="py-[9px]">
                <span className="flex items-center gap-[5px] whitespace-nowrap" style={{ color: h.now === 'Needs you' ? '#C2410C' : 'var(--color-ink-2)' }}>
                  <span className="size-[6px] rounded-full" style={{ background: NOW_DOT[h.now] }} />
                  {h.now}
                </span>
              </td>
              <td className="py-[9px] text-ink-2">{h.jobs}</td>
              <td className="py-[9px]">
                <span style={{ color: h.success < 90 ? 'var(--color-warn)' : 'var(--color-ink-2)', fontWeight: h.success < 90 ? 600 : 400 }}>
                  {h.success}%
                </span>
              </td>
              <td className="py-[9px] text-ink-2">{h.tokens}</td>
              <td className="py-[9px] text-ink-2">{h.spend}</td>
              <td className="py-[9px]"><BudgetBar used={h.budgetUsed} cap={h.budgetCap} /></td>
              <td className="py-[9px] text-muted whitespace-nowrap">{h.lastActive}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Screen ───────────────────────────────────────────────────────────────────────

export function AnalyticsScreen({ config }: { config: AnalyticsConfig }) {
  const [tab, setTab] = useState('Overview')
  const [range, setRange] = useState<(typeof RANGES)[number]>('7 days')

  return (
    <>
      <Topbar
        icon={ChartLine}
        title="Analytics"
        meta={config.topbarMeta}
        actions={
          <Button variant="secondary" height={28} icon={Download}>
            Export
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[24px] py-[20px]">
        {/* Heading */}
        <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">
          Analytics · {config.title}
        </h2>
        <p className="mt-[4px] mb-[16px] text-[13px] text-muted">{config.subtitle}</p>

        {/* Tabs */}
        <div className="mb-[16px] flex items-center gap-[2px] border-b border-line">
          {TABS.map(({ key, label, icon: Icon }) => {
            const on = tab === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={on ? 'true' : undefined}
                className="relative flex h-[36px] items-center gap-[5px] px-[10px] text-[12.5px] font-medium transition-colors"
                style={{
                  color: on ? 'var(--color-ink)' : 'var(--color-muted)',
                  borderBottom: on ? '2px solid var(--color-ink)' : '2px solid transparent',
                }}
              >
                <Icon size={13} aria-hidden />
                {label}
              </button>
            )
          })}
        </div>

        {/* Range filter */}
        <div className="mb-[16px] flex items-center gap-[10px]">
          <div className="flex gap-[2px] rounded-base bg-soft p-[2px]">
            {RANGES.map((r) => {
              const on = range === r
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`flex h-[24px] items-center rounded-sm px-[10px] text-[12px] font-medium transition-colors ${
                    on ? 'bg-surface text-ink shadow-[0_1px_2px_#00000014]' : 'text-muted hover:text-ink-2'
                  }`}
                >
                  {r}
                </button>
              )
            })}
          </div>
          <button type="button" className="flex h-[28px] items-center gap-[5px] rounded-btn outline-1 -outline-offset-1 outline-line-strong px-[10px] text-[12px] text-ink-2 transition-colors hover:bg-soft">
            All helpers
          </button>
          <span className="ml-auto flex items-center gap-[5px] text-[11.5px] text-faint">
            <span className="size-[6px] rounded-full bg-ok" />
            Updated 12:57
          </span>
        </div>

        {tab === 'Overview' && (
          <div className="flex flex-col gap-[16px]">
            {/* Stat cards */}
            <div className="flex gap-[12px]">
              {config.stats.map((s) => (
                <StatCardView key={s.label} s={s} />
              ))}
            </div>

            {/* Charts */}
            <div className="flex gap-[12px]">
              <ChartCard title={config.stackTitle} total={config.stackTotal} legend={config.legend}>
                <StackedBars data={config.stack} legend={config.legend} />
              </ChartCard>
              <ChartCard
                title={config.jobsTitle}
                legend={[
                  { label: 'Done', color: 'var(--color-ok)' },
                  { label: 'Failed', color: 'var(--color-bad-solid)' },
                ]}
              >
                <JobsBars data={config.jobs} />
              </ChartCard>
            </div>

            {/* Helpers table */}
            <HelpersTable caption={config.helpersCaption} helpers={config.helpers} />
          </div>
        )}

        {tab === 'Helpers' && <HelpersTable caption={config.helpersCaption} helpers={config.helpers} />}

        {tab === 'Reliability' && (
          <div className="flex flex-col gap-[16px]">
            <div className="flex gap-[12px]">
              {config.stats
                .filter((s) => s.label === 'Success rate' || s.label === 'Jobs done')
                .map((s) => (
                  <StatCardView key={s.label} s={s} />
                ))}
            </div>
            <ChartCard
              title={config.jobsTitle}
              legend={[
                { label: 'Done', color: 'var(--color-ok)' },
                { label: 'Failed', color: 'var(--color-bad-solid)' },
              ]}
            >
              <JobsBars data={config.jobs} />
            </ChartCard>
          </div>
        )}

        {(tab === 'Loops' || tab === 'Activity') && (
          <div className="flex flex-col items-center gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface px-[6px] py-[48px] text-center">
            {tab === 'Loops' ? (
              <Flame size={20} aria-hidden className="text-faint" />
            ) : (
              <Activity size={20} aria-hidden className="text-faint" />
            )}
            <span className="text-[13px] font-medium text-ink">
              {tab === 'Loops' ? 'No runaway loops this week' : 'Activity timeline'}
            </span>
            <span className="text-[12px] text-muted">
              {tab === 'Loops'
                ? 'Chief flags helpers that retry the same step too often.'
                : 'A live feed of every job as it runs, retries, and finishes.'}
            </span>
          </div>
        )}
      </div>
    </>
  )
}
