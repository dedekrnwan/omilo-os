import type { ReactNode } from 'react'
import { Activity, Check, ChevronDown, LayoutDashboard, Repeat, ShieldCheck, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { HelperArea } from '../../core/domain/types'
import { Mascot } from '../../ui/ds/Mascot'
import { DAYS, UPDATED_AT } from './data'
import type { BarChart, ChipTone, HelperStat, HelperStatus, Stat } from './data'

// ── Small primitives (pen Chip/*, Status Dot/*, Switch/*, Checkbox/*, Radio/*) ──

const CHIP: Record<ChipTone, string> = {
  up: 'bg-ok-tint outline-ok-line text-ok',
  warn: 'bg-warn-tint outline-warn-line text-warn',
  neutral: 'bg-soft outline-line-strong text-ink-2',
  down: 'bg-bad-tint outline-bad-line text-bad',
  run: 'bg-info-tint outline-info-line text-info',
}

/** pen `Chip/Up|Warn|Neutral|Down|Run`: h-22 · r-sm · px-8 · 12/500. */
export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center rounded-sm px-[8px] text-[12px] font-medium whitespace-nowrap outline-1 -outline-offset-1 ${CHIP[tone]}`}
    >
      {children}
    </span>
  )
}

/** pen `Status Dot/Running|Idle|Queued`: 14 frame with an 8px dot. */
export function StatusDot({ kind }: { kind: 'running' | 'idle' | 'queued' }) {
  const bg = kind === 'running' ? 'bg-info-tint' : ''
  const dot = kind === 'running' ? 'bg-info' : kind === 'queued' ? 'bg-warn' : 'bg-faint'
  return (
    <span className={`inline-flex size-[14px] shrink-0 items-center justify-center rounded-full ${bg}`}>
      <span className={`size-[8px] rounded-full ${dot}`} />
    </span>
  )
}

const STATUS: Record<HelperStatus, { dot: 'running' | 'idle' | 'queued'; label: string; warn?: boolean }> = {
  working: { dot: 'running', label: 'Working' },
  idle: { dot: 'idle', label: 'Idle' },
  needs: { dot: 'queued', label: 'Needs you', warn: true },
  paused: { dot: 'idle', label: 'Paused' },
}

export function HelperStatusLabel({ status, reached }: { status: HelperStatus; reached?: boolean }) {
  const s = reached ? { dot: 'queued' as const, label: 'Paused', warn: true } : STATUS[status]
  return (
    <span className="flex items-center gap-[6px]">
      <StatusDot kind={s.dot} />
      <span className={`text-[12px] font-medium whitespace-nowrap ${s.warn ? 'text-warn' : 'text-ink-2'}`}>
        {s.label}
      </span>
    </span>
  )
}

/** pen `Switch/On|Off`: 32×18 · r-9 · p-2 · knob 14. */
export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange?: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange?.(!on)}
      className={`flex h-[18px] w-[32px] shrink-0 rounded-[9px] p-[2px] ${on ? 'justify-end bg-primary' : 'bg-line-strong'}`}
    >
      <span className="size-[14px] rounded-full bg-white shadow-[0_1px_2px_#0000002E]" />
    </button>
  )
}

/** pen `Checkbox/On|Off`: 16 · r-4. */
export function Checkbox({ on, label, onChange }: { on: boolean; label: string; onChange?: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange?.(!on)}
      className={`inline-flex size-[16px] shrink-0 items-center justify-center rounded-xs ${
        on ? 'bg-primary' : 'bg-surface outline-1 -outline-offset-1 outline-faint'
      }`}
    >
      {on && <Check size={12} strokeWidth={3.5} className="text-primary-ink" aria-hidden />}
    </button>
  )
}

/** pen `Mini/*` helper avatar (24 · r-7) — always the live Mascot. */
export function Mini({ area, size = 24 }: { area: HelperArea; size?: number }) {
  return <Mascot helper area={area} size={size} radius={7} />
}

/** pen `Button/Primary|Secondary|Quiet` (h-32 · px-14 · 14/500). */
export function BigButton({
  kind,
  children,
  onClick,
}: {
  kind: 'primary' | 'secondary' | 'quiet'
  children: ReactNode
  onClick?: () => void
}) {
  const look =
    kind === 'primary'
      ? 'bg-primary text-primary-ink font-medium hover:bg-primary-hover'
      : kind === 'secondary'
        ? 'bg-surface text-ink font-medium outline-1 -outline-offset-1 outline-line-strong hover:bg-soft'
        : 'text-muted hover:bg-hover'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-[32px] shrink-0 items-center justify-center rounded-btn px-[14px] text-[14px] whitespace-nowrap transition-colors ${look}`}
    >
      {children}
    </button>
  )
}

/** Card shell: surface · r-lg · 1px line-strong (drawn inside, like pen strokes). */
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong ${className}`}>
      {children}
    </section>
  )
}

export function CardTitle({ title, sub, divider = false }: { title: string; sub: string; divider?: boolean }) {
  return (
    <div
      className={`flex w-full items-center gap-[8px] px-[16px] py-[14px] ${
        divider ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
      }`}
    >
      <h2 className="m-0 text-[14px] font-semibold text-ink">{title}</h2>
      <span className="text-[12px] text-muted">{sub}</span>
    </div>
  )
}

/** pen `Callout` / `Callout/Warn`: r-lg · py-12 px-14 · gap 10 · icon 16 · 14/1.45 ink. */
export function Callout({ icon: Icon, tone, children }: { icon: LucideIcon; tone: 'soft' | 'warn'; children: ReactNode }) {
  const look =
    tone === 'warn' ? 'bg-warn-tint outline-warn-line' : 'bg-soft outline-line'
  return (
    <div className={`flex w-full gap-[10px] rounded-lg px-[14px] py-[12px] outline-1 -outline-offset-1 ${look}`}>
      <Icon size={16} aria-hidden className={`shrink-0 ${tone === 'warn' ? 'text-warn' : 'text-muted'}`} />
      <p className="m-0 min-w-0 flex-1 text-[14px] leading-[1.45] text-ink">{children}</p>
    </div>
  )
}

// ── Page chrome: header, tabs, toolbar ─────────────────────────────────────────

export function PageHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex w-full flex-col gap-[4px]">
      <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">{title}</h2>
      <p className="m-0 text-[13px] text-muted">{sub}</p>
    </div>
  )
}

export type TabId = 'overview' | 'helpers' | 'loops' | 'reliability' | 'activity'

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'helpers', label: 'Helpers', icon: Users },
  { id: 'loops', label: 'Loops', icon: Repeat },
  { id: 'reliability', label: 'Reliability', icon: ShieldCheck },
  { id: 'activity', label: 'Activity', icon: Activity },
]

export function Tabs({ value, onChange }: { value: TabId; onChange: (t: TabId) => void }) {
  return (
    <div role="tablist" className="flex w-full gap-[16px] shadow-[inset_0_-1px_0_var(--color-line-strong)]">
      {TABS.map(({ id, label, icon: Icon }) => {
        const on = id === value
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(id)}
            className={`flex items-center gap-[6px] pt-[6px] pb-[9px] text-[13px] ${
              on ? 'font-medium text-ink shadow-[inset_0_-2px_0_#171717]' : 'text-muted hover:text-ink-2'
            }`}
          >
            <Icon size={14} aria-hidden className={on ? 'text-ink' : 'text-muted'} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

const RANGES = ['7 days', '30 days', '90 days'] as const

export function Toolbar({ range, onRange }: { range: string; onRange: (r: string) => void }) {
  return (
    <div className="flex w-full items-center gap-[8px]">
      {RANGES.map((r) => {
        const on = r === range
        return (
          <button
            key={r}
            type="button"
            aria-pressed={on}
            onClick={() => onRange(r)}
            className={`flex h-[28px] items-center rounded-pill px-[12px] text-[12px] font-medium outline-1 -outline-offset-1 ${
              on ? 'bg-ink text-primary-ink outline-ink' : 'bg-surface text-ink-2 outline-line-strong hover:bg-soft'
            }`}
          >
            {r}
          </button>
        )
      })}
      <button
        type="button"
        className="flex h-[28px] items-center gap-[6px] rounded-pill bg-surface px-[10px] text-[12px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
      >
        All helpers
        <ChevronDown size={12} aria-hidden className="text-muted" />
      </button>
      <div className="h-px min-w-0 flex-1" />
      <span className="flex items-center gap-[6px]">
        <span className="size-[7px] rounded-full bg-ok" />
        <span className="font-mono text-[11px] text-muted">Updated {UPDATED_AT}</span>
      </span>
    </div>
  )
}

// ── Stat card (pen `Stat` phESb) ───────────────────────────────────────────────

export function StatCard({ stat }: { stat: Stat }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-lg bg-surface px-[16px] py-[14px] outline-1 -outline-offset-1 outline-line">
      <span className="text-[13px] text-muted">{stat.label}</span>
      <span className="font-mono text-[28px] leading-[1.29] text-ink">{stat.value}</span>
      <span className="flex items-center gap-[6px]">
        <Chip tone={stat.tone}>{stat.delta}</Chip>
        <span className="text-[12px] text-muted">{stat.note}</span>
      </span>
    </div>
  )
}

export function StatRow({ stats }: { stats: Stat[] }) {
  return (
    <div className="flex w-full gap-[12px]">
      {stats.map((s) => (
        <StatCard key={s.label} stat={s} />
      ))}
    </div>
  )
}

// ── Stacked bar chart (plain divs, exactly as drawn in pen) ───────────────────

export function BarChartCard({ chart, className = '' }: { chart: BarChart; className?: string }) {
  return (
    <Card className={`flex flex-col gap-[14px] p-[16px] ${className}`}>
      <div className="flex w-full items-center gap-[8px]">
        <h2 className="m-0 text-[14px] font-semibold text-ink">{chart.title}</h2>
        <span className="text-[12px] text-muted">{chart.sub}</span>
        <div className="h-px min-w-0 flex-1" />
        <ul className="m-0 flex list-none items-center gap-[12px] p-0">
          {chart.legend.map((l) => (
            <li key={l.label} className="flex items-center gap-[5px]">
              <span className="size-[8px] rounded-[2px]" style={{ background: l.color }} />
              <span className="text-[11px] text-muted">{l.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <div
        role="img"
        aria-label={`${chart.title} per day`}
        className="relative flex h-[110px] w-full items-end gap-[10px] px-[4px]"
      >
        {DAYS.map((d, i) => {
          const segs = chart.stack.filter((s) => s.values[i] > 0)
          return (
            <div key={d} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              <div className="flex w-[28px] flex-col gap-px overflow-hidden rounded-t-[3px]">
                {segs.map((s) => (
                  <div key={s.label} style={{ height: s.values[i], background: s.color }} />
                ))}
              </div>
            </div>
          )
        })}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line" />
      </div>
      <div className="flex w-full gap-[10px] px-[4px]">
        {DAYS.map((d) => (
          <span key={d} className="min-w-0 flex-1 text-center font-mono text-[10px] text-faint">
            {d}
          </span>
        ))}
      </div>
    </Card>
  )
}

// ── Budget track ──────────────────────────────────────────────────────────────

export function Track({ pct, color, height = 4 }: { pct: number; color: string; height?: number }) {
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ height, borderRadius: height / 2, background: height === 6 ? 'var(--color-soft)' : 'var(--color-line-strong)' }}
    >
      {pct > 0 && (
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${Math.min(100, pct * 100)}%`, background: color, borderRadius: height / 2 }}
        />
      )}
    </div>
  )
}

// ── Helpers table (overview) ──────────────────────────────────────────────────

const COLS = 'w-[110px] w-[60px] w-[70px] w-[80px] w-[70px] w-[170px] w-[90px]'.split(' ')

export function HelpersTable({
  rows,
  sub,
  onSetBudget,
}: {
  rows: HelperStat[]
  sub: string
  onSetBudget?: (h: HelperStat) => void
}) {
  const head = ['Now', 'Jobs', 'Success', 'Tokens', 'Spend', 'Budget (month)', 'Last active']
  return (
    <Card className="flex flex-col overflow-hidden">
      <CardTitle title="Helpers" sub={sub} />
      <div
        role="row"
        className="flex w-full gap-[12px] bg-soft px-[16px] py-[8px] shadow-[inset_0_1px_0_var(--color-line),inset_0_-1px_0_var(--color-line)]"
      >
        <span className="min-w-0 flex-1 text-[11px] font-medium text-muted">Helper</span>
        {head.map((h, i) => (
          <span key={h} className={`${COLS[i]} shrink-0 text-[11px] font-medium text-muted`}>
            {h}
          </span>
        ))}
      </div>
      {rows.map((h, idx) => (
        <div
          key={h.id}
          role="row"
          className={`flex w-full items-center gap-[12px] px-[16px] py-[10px] ${
            idx < rows.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
          }`}
        >
          <div className="flex min-w-0 flex-1 items-center gap-[10px]">
            <Mini area={h.area} />
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[13px] font-semibold text-ink">{h.name}</span>
              <span className="truncate text-[12px] text-muted">{h.doing}</span>
            </div>
          </div>
          <span className="w-[110px] shrink-0">
            <HelperStatusLabel status={h.status} />
          </span>
          <span className="w-[60px] shrink-0 font-mono text-[12px] text-ink">{h.jobs}</span>
          <span className={`w-[70px] shrink-0 font-mono text-[12px] ${h.successWarn ? 'text-warn' : 'text-ink'}`}>
            {h.success}
          </span>
          <span className="w-[80px] shrink-0 font-mono text-[12px] text-ink">{h.tokens}</span>
          <span className="w-[70px] shrink-0 font-mono text-[12px] text-ink">{h.spend}</span>
          <div className="flex w-[170px] shrink-0 flex-col gap-[5px]">
            {h.budget ? (
              <>
                <Track pct={h.budget.spent / h.budget.limit} color={h.budget.warn ? 'var(--color-warn)' : 'var(--color-ink)'} />
                <span className="font-mono text-[11px] text-muted">
                  ${h.budget.spent} / ${h.budget.limit}
                </span>
              </>
            ) : (
              <span className="flex items-center gap-[6px]">
                <span className="font-mono text-[11px] text-muted">No budget</span>
                <button
                  type="button"
                  onClick={() => onSetBudget?.(h)}
                  className="text-[11px] font-medium text-link hover:underline"
                >
                  Set
                </button>
              </span>
            )}
          </div>
          <span className="w-[90px] shrink-0 text-[12px] text-muted">{h.lastActive}</span>
        </div>
      ))}
    </Card>
  )
}
