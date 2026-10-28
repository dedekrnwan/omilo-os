import { useRef, useState } from 'react'
import { Drawer } from '../../ui/ds/Drawer'
import {
  CalendarDays,
  Layers,
  MessageCircle,
  MessageSquare,
  Plus,
  Target,
  UserPlus,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'
import { notify } from '../../ui/ds/Toaster'
import { accents } from '../../ui/ds/accents'
import type { HelperArea, Channel, Goal } from '../../core/domain/types'
import { useArea, useAreas, useGoals } from '../../app/queries'
import { useUIStore } from '../../app/store'

// ── Helper-picker popover ─────────────────────────────────────────────────────

const ALL_HELPERS: Array<{ label: string; area: HelperArea }> = [
  { label: 'Chief', area: 'brand' },
  { label: 'Builder', area: 'dev' },
  { label: 'Growth', area: 'marketing' },
  { label: 'Sales', area: 'sales' },
  { label: 'Finance', area: 'finance' },
]

function HelperPickerPopover({
  anchor,
  current,
  onSelect,
  onClose,
}: {
  anchor: DOMRect | null
  current: string[]
  onSelect: (label: string) => void
  onClose: () => void
}) {
  if (!anchor) return null
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        className="fixed z-50 w-[180px] rounded-lg bg-surface py-[4px] shadow-[0_12px_32px_#0C0A0924] outline-1 -outline-offset-1 outline-line-strong"
        style={{ top: anchor.bottom + 6, left: anchor.left }}
      >
        <p className="px-[10px] py-[4px] text-[10.5px] font-medium tracking-[0.6px] text-faint uppercase">Add helper</p>
        {ALL_HELPERS.map(({ label, area }) => (
          <button
            key={label}
            type="button"
            disabled={current.includes(label)}
            onClick={() => { onSelect(label); onClose() }}
            className="flex w-full items-center gap-[8px] px-[10px] py-[6px] text-[13px] text-ink-2 hover:bg-hover disabled:opacity-40 disabled:pointer-events-none"
          >
            <Mascot size={16} radius={4} area={area} />
            {label}
          </button>
        ))}
      </div>
    </>
  )
}

// ── Live-shaped GoalRow ───────────────────────────────────────────────────────
// NOTE (defaulted fields): The Goal domain type only has {id, channelId, title,
// progress}. The following fields have no backend equivalent and are defaulted
// locally until the backend adds them:
//   • status  → always 'On track' (no status field on Goal)
//   • tasks   → '' (no tasks field)
//   • due     → '' (no due date field)
//   • badge   → never shown (no "Needs you" signal)
//   • subItems → [] (no sub-items from the API)

type GoalStatus = 'On track' | 'At risk' | 'Blocked' | 'Needs you'

const RING_COLOR: Record<GoalStatus, string> = {
  'On track': 'var(--color-ok)',
  'At risk':  'var(--color-warn)',
  'Blocked':  'var(--color-bad)',
  'Needs you': '#EB6834',
}

// ── StatusRing ────────────────────────────────────────────────────────────────

function StatusRing({ value, status }: { value: number; status: GoalStatus }) {
  const size = 32
  const outer = size / 2
  const width = outer * 0.26
  const r = outer - width / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value)) / 100
  const color = RING_COLOR[status]
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      <circle
        cx={outer} cy={outer} r={r}
        fill="none" stroke="var(--color-line-strong)" strokeWidth={width}
      />
      <circle
        cx={outer} cy={outer} r={r}
        fill="none" stroke={color} strokeWidth={width}
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${outer} ${outer})`}
      />
    </svg>
  )
}

// ── GoalRow (live-shaped) ─────────────────────────────────────────────────────

function GoalRow({ goal }: { goal: Goal }) {
  const navigate = useNavigate()
  // NOTE: status/tasks/due defaulted locally — no backend equivalent yet
  const status: GoalStatus = 'On track'
  return (
    <div className="flex flex-col">
      <div className="flex w-full items-center gap-[10px] py-[10px]">
        <button
          type="button"
          aria-label={goal.title}
          className="flex min-w-0 flex-1 items-center gap-[12px] rounded-base px-[2px] py-0 text-left transition-colors hover:bg-soft"
        >
          <StatusRing value={goal.progress} status={status} />
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="truncate text-[13.5px] font-medium text-ink">{goal.title}</span>
            <span className="text-[11.5px] text-muted">
              <span className="font-medium" style={{ color: RING_COLOR[status] }}>{status}</span>
              {' · '}{goal.progress}%
            </span>
          </span>
        </button>

        {/* Session action */}
        <Button variant="secondary" height={28} icon={MessageCircle} onClick={() => navigate({ to: '/chat' })}>
          Session
        </Button>
      </div>
    </div>
  )
}

// ── AreaGroupSection ──────────────────────────────────────────────────────────

interface LiveAreaGroup {
  channel: Channel
  accentColor: string
  goals: Goal[]
}

function AreaGroupSection({ group }: { group: LiveAreaGroup }) {
  return (
    <section aria-label={group.channel.name}>
      {/* Area heading row */}
      <div className="flex items-center gap-[6px] pb-[4px] pt-[16px]">
        <span
          aria-hidden
          className="size-[8px] shrink-0 rounded-full"
          style={{ background: group.accentColor }}
        />
        <span className="text-[12.5px] font-semibold" style={{ color: group.accentColor }}>
          {group.channel.name}
        </span>
        <span className="text-[12px] text-muted">{group.goals.length} goals</span>
      </div>

      <div className="flex flex-col divide-y divide-line">
        {group.goals.map((goal) => (
          <GoalRow key={goal.id} goal={goal} />
        ))}
      </div>
    </section>
  )
}

// ── StatusFilter tabs ─────────────────────────────────────────────────────────

type StatusFilter = 'All' | 'On track'

const STATUS_FILTERS: StatusFilter[] = ['All', 'On track']

function StatusFilterTabs({
  active,
  onChange,
  counts,
}: {
  active: StatusFilter
  onChange: (f: StatusFilter) => void
  counts: Record<StatusFilter, number>
}) {
  return (
    <div className="flex items-center gap-[2px]">
      {STATUS_FILTERS.map((f) => {
        const isActive = active === f
        return (
          <button
            key={f}
            type="button"
            onClick={() => onChange(f)}
            className={`inline-flex h-[28px] items-center gap-[5px] rounded-sm px-[8px] text-[12.5px] transition-colors ${
              isActive
                ? 'bg-hover font-medium text-ink'
                : 'text-muted hover:bg-hover hover:text-ink-2'
            }`}
          >
            {f}
            <span className={`text-[11.5px] ${isActive ? 'text-muted' : 'text-faint'}`}>
              {counts[f]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── NewGoalDialog ─────────────────────────────────────────────────────────────

interface NewGoalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Toggle switch used inside the dialog. */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-[18px] w-[30px] shrink-0 rounded-pill transition-colors ${
        on ? 'bg-primary' : 'bg-line-strong'
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-surface shadow-[0_1px_3px_#0C0A0929] transition-transform ${
          on ? 'left-[14px]' : 'left-[2px]'
        }`}
      />
    </button>
  )
}

/** Helper avatar chip used in "Helpers on it" row */
function HelperAvatar({ label, area }: { label: string; area: HelperArea }) {
  return (
    <span className="inline-flex items-center gap-[5px] rounded-pill bg-soft px-[8px] py-[4px] text-[12px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-strong">
      <Mascot size={16} radius={4} area={area} />
      {label}
    </span>
  )
}

/**
 * "New goal" dialog — visual-only, matches DlkiJ.png.
 */
export function NewGoalDialog({ open, onOpenChange }: NewGoalDialogProps) {
  const navigate = useNavigate()
  const [goalText, setGoalText] = useState('Passwordless login for 80% of users by Q4')
  const [channel, setChannel] = useState('Engineering')
  const [due, setDue] = useState('31 Dec 2026')
  const [measured, setMeasured] = useState('% of logins using passkey')
  const [target, setTarget] = useState('80%')
  const [chiefDraft, setChiefDraft] = useState(true)
  const [helpers, setHelpers] = useState<string[]>(['Chief', 'Builder'])
  const [helperAnchor, setHelperAnchor] = useState<DOMRect | null>(null)
  const addHelperRef = useRef<HTMLButtonElement>(null)

  if (!open) return null

  return (
    <Drawer
      title="New goal"
      subtitle="Say what you want to move. Chief turns it into key results and assigns helpers."
      onClose={() => onOpenChange(false)}
      width={440}
      bodyClass="gap-[16px] px-[22px] py-[18px]"
      footer={
        <>
          <button
            type="button"
            aria-label="Describe it in chat"
            onClick={() => { onOpenChange(false); navigate({ to: '/chat' }) }}
            className="flex items-center gap-[5px] text-[12px] text-muted transition-colors hover:text-ink-2"
          >
            <MessageSquare size={13} aria-hidden />
            or describe it in chat
          </button>
          <span className="flex-1" />
          <Button variant="secondary" height={30} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" height={30} icon={Target} onClick={() => onOpenChange(false)}>
            Create goal
          </Button>
        </>
      }
    >
      {/* Goal text */}
            <div className="flex flex-col gap-[6px]">
              <label className="text-[12px] font-medium text-ink-2" htmlFor="goal-input">
                Goal
              </label>
              <textarea
                id="goal-input"
                rows={2}
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                placeholder="One outcome, in plain words. You can refine it with Chief later."
                className="w-full resize-none rounded-base bg-soft px-[10px] py-[8px] text-[13px] leading-[1.45] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary placeholder:text-faint"
              />
              <p className="m-0 text-[11.5px] text-faint">
                One outcome, in plain words. You can refine it with Chief later.
              </p>
            </div>

            {/* Channel + Due row */}
            <div className="grid grid-cols-2 gap-[10px]">
              <div className="flex flex-col gap-[6px]">
                <label className="text-[12px] font-medium text-ink-2" htmlFor="goal-channel">
                  Channel
                </label>
                <div className="flex items-center gap-[6px] rounded-base bg-soft px-[10px] py-[7px] outline-1 -outline-offset-1 outline-line-strong">
                  <span
                    aria-hidden
                    className="size-[8px] shrink-0 rounded-full"
                    style={{ background: accents.dev.color }}
                  />
                  <select
                    id="goal-channel"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
                  >
                    <option>Engineering</option>
                    <option>Marketing</option>
                    <option>Business</option>
                    <option>General</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-[6px]">
                <label className="text-[12px] font-medium text-ink-2" htmlFor="goal-due">
                  Due
                </label>
                <div className="flex items-center gap-[6px] rounded-base bg-soft px-[10px] py-[7px] outline-1 -outline-offset-1 outline-line-strong">
                  <CalendarDays size={13} aria-hidden className="shrink-0 text-muted" />
                  <input
                    id="goal-due"
                    type="text"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
                  />
                </div>
              </div>
            </div>

            {/* Measured by + Target row */}
            <div className="grid grid-cols-2 gap-[10px]">
              <div className="flex flex-col gap-[6px]">
                <label className="text-[12px] font-medium text-ink-2" htmlFor="goal-measured">
                  Measured by
                </label>
                <input
                  id="goal-measured"
                  type="text"
                  value={measured}
                  onChange={(e) => setMeasured(e.target.value)}
                  className="rounded-base bg-soft px-[10px] py-[7px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary"
                />
              </div>

              <div className="flex flex-col gap-[6px]">
                <label className="text-[12px] font-medium text-ink-2" htmlFor="goal-target">
                  Target
                </label>
                <input
                  id="goal-target"
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="rounded-base bg-soft px-[10px] py-[7px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary"
                />
              </div>
            </div>

            {/* Helpers on it */}
            <div className="flex flex-col gap-[6px]">
              <span className="text-[12px] font-medium text-ink-2">Helpers on it</span>
              <div className="flex flex-wrap items-center gap-[6px]">
                {helpers.map((h) => {
                  const found = ALL_HELPERS.find((x) => x.label === h)
                  return <HelperAvatar key={h} label={h} area={found?.area ?? 'brand'} />
                })}
                <button
                  ref={addHelperRef}
                  type="button"
                  aria-label="Add helper"
                  onClick={() => {
                    const rect = addHelperRef.current?.getBoundingClientRect() ?? null
                    setHelperAnchor(rect)
                  }}
                  className="inline-flex items-center gap-[4px] rounded-pill bg-soft px-[8px] py-[4px] text-[12px] text-muted outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-hover hover:text-ink-2"
                >
                  <UserPlus size={12} aria-hidden />
                  Add helper
                </button>
              </div>
              <HelperPickerPopover
                anchor={helperAnchor}
                current={helpers}
                onSelect={(label) => {
                  setHelpers((prev) => [...prev, label])
                  notify(`${label} added as helper`)
                }}
                onClose={() => setHelperAnchor(null)}
              />
            </div>

            {/* Chief draft key results */}
            <div className="flex items-start gap-[10px] rounded-base bg-soft p-[12px] outline-1 -outline-offset-1 outline-line-strong">
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="text-[12.5px] font-medium text-ink">
                  Let Chief draft key results
                </span>
                <span className="text-[11.5px] leading-[1.4] text-muted">
                  Chief proposes 3–5 key results from your docs and Monitor data. You approve before anything starts.
                </span>
              </div>
              <Toggle
                on={chiefDraft}
                onChange={setChiefDraft}
                label="Let Chief draft key results"
              />
            </div>
    </Drawer>
  )
}

// ── GoalsBoard (live-wired) ───────────────────────────────────────────────────

/**
 * Shared Goals board for both modes. `areaId === null` → all areas, grouped
 * by area (company view); a specific area → just that area's goals.
 */
function GoalsBoard({ areaId }: { areaId: string | null }) {
  const { data: area } = useArea(areaId ?? '')
  const { data: allAreas = [], isLoading: areasLoading, isError: areasError } = useAreas()
  const { data: allGoals = [], isLoading: goalsLoading, isError: goalsError } = useGoals(areaId)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [dialogOpen, setDialogOpen] = useState(false)

  const areaName = areaId ? area?.name ?? '' : null
  const isLoading = areasLoading || goalsLoading
  const isError = areasError || goalsError

  // Build area groups: each Channel that has at least one goal in the current scope.
  // When areaId is set, allAreas/allGoals are already scoped by the hook.
  const liveGroups: LiveAreaGroup[] = (() => {
    // Determine which channels to group by
    const channelsToShow = areaId
      ? allAreas.filter((ch) => ch.id === areaId)
      : allAreas

    return channelsToShow
      .map((ch) => ({
        channel: ch,
        accentColor: accents[ch.accent]?.color ?? '#78716C',
        goals: allGoals.filter((g) => g.channelId === ch.id),
      }))
      .filter((g) => g.goals.length > 0)
  })()

  // Status filter (simplified: only "All" / "On track" since status is defaulted)
  // NOTE: When the backend adds a status field to Goal, this can be expanded.
  const filteredGroups =
    statusFilter === 'All'
      ? liveGroups
      : liveGroups
          .map((g) => ({ ...g, goals: g.goals })) // all are 'On track' when defaulted
          .filter((g) => g.goals.length > 0)

  const totalGoals = allGoals.length
  const counts: Record<StatusFilter, number> = {
    All: totalGoals,
    'On track': totalGoals, // all defaulted to On track
  }

  return (
    <>
      <Topbar
        icon={Target}
        title="Goals"
        meta={areaName ? `in ${areaName}` : 'All areas · Q4 2026'}
        actions={
          <div className="flex items-center gap-[6px]">
            {!areaName && (
              <Button variant="secondary" height={28} icon={Layers}>
                Group: Area
              </Button>
            )}
            <Button icon={Plus} height={28} onClick={() => setDialogOpen(true)}>
              New goal
            </Button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[24px] py-[20px]">
        {/* Heading */}
        <header className="flex flex-col gap-[4px]">
          <h1 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">
            {areaName ? `What ${areaName} is pushing on` : 'What the company is pushing on'}
          </h1>
          <p className="m-0 text-[13px] text-muted">
            {areaName
              ? `${totalGoals} goals this quarter. Open a goal to jump into its session, tasks and decisions.`
              : `${totalGoals} goals this quarter across every area. Open a goal to jump into its session, tasks and decisions.`}
          </p>
        </header>

        {/* Filter bar */}
        <div className="mt-[14px] mb-[6px]">
          <StatusFilterTabs active={statusFilter} onChange={setStatusFilter} counts={counts} />
        </div>

        {/* States */}
        {isError ? (
          <p className="mt-[24px] text-[13px] text-bad" role="alert">
            Failed to load goals. Please try again.
          </p>
        ) : isLoading ? (
          <p className="mt-[24px] text-[13px] text-muted">Loading…</p>
        ) : filteredGroups.length === 0 ? (
          <div className="mt-[40px] flex flex-col items-center gap-[8px] text-center">
            <Target size={32} className="text-faint" aria-hidden />
            <p className="m-0 text-[14px] font-medium text-ink-2">No goals yet</p>
            <p className="m-0 text-[12.5px] text-muted">
              {totalGoals === 0
                ? 'Create your first goal to start tracking what the team is pushing on.'
                : 'No goals match the selected filter.'}
            </p>
            {totalGoals === 0 && (
              <Button icon={Plus} height={30} onClick={() => setDialogOpen(true)} className="mt-[4px]">
                New goal
              </Button>
            )}
          </div>
        ) : (
          filteredGroups.map((group) => (
            <AreaGroupSection key={group.channel.id} group={group} />
          ))
        )}
      </div>

      <NewGoalDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}

// ── Route wrappers (shared board, area from the store) ────────────────────────

/** Office · Goals — company-wide when no area is selected. */
export function OfficeGoalsRoute() {
  const areaId = useUIStore((s) => s.areaId)
  return <GoalsBoard areaId={areaId} />
}

/** Chat · Goals — same board, area-filtered. */
export function ChatGoalsRoute() {
  const areaId = useUIStore((s) => s.areaId)
  return <GoalsBoard areaId={areaId} />
}
