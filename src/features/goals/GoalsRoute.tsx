import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { drawerOverlayClass, drawerContentClass } from '../../ui/ds/Drawer'
import {
  CalendarDays,
  Layers,
  MessageCircle,
  MessageSquare,
  Plus,
  Target,
  UserPlus,
  X,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'
import { notify } from '../../ui/ds/Toaster'
import { helperColor } from '../../ui/tokens'
import type { HelperArea } from '../../core/domain/types'
import { useArea } from '../../app/queries'
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

// ── Static data (matching qDPJo.png) ─────────────────────────────────────────

type GoalStatus = 'On track' | 'At risk' | 'Blocked' | 'Needs you'

interface OfficeGoalRow {
  id: string
  title: string
  status: GoalStatus
  /** 0-100 */
  progress: number
  tasks: string
  due: string
  ownerArea: HelperArea
  ownerLabel: string
  area: OfficeArea
  /** Optional badge shown alongside status */
  badge?: 'Needs you'
  /** Sub-items for expanded view */
  subItems?: OfficeSubItem[]
}

interface OfficeSubItem {
  id: string
  title: string
  meta: string
  statusLabel: string
  statusKind: 'review' | 'slipping' | 'todo'
  date: string
}

type OfficeArea = 'Engineering' | 'Marketing' | 'Business'

interface AreaGroup {
  area: OfficeArea
  accentColor: string
  goals: OfficeGoalRow[]
}

const RING_COLOR: Record<GoalStatus, string> = {
  'On track': 'var(--color-ok)',
  'At risk':  'var(--color-warn)',
  'Blocked':  'var(--color-bad)',
  'Needs you': '#EB6834',
}

const AREA_COLOR: Record<OfficeArea, string> = {
  Engineering: helperColor.dev,
  Marketing:   helperColor.marketing,
  Business:    helperColor.sales,
}

const SUB_ITEM_STATUS: Record<'review' | 'slipping' | 'todo', { label: string; ink: string }> = {
  review:   { label: 'In review',   ink: 'var(--color-info)' },
  slipping: { label: 'Slipping 2d', ink: 'var(--color-warn)' },
  todo:     { label: 'To do',       ink: 'var(--color-muted)' },
}

const AREA_GROUPS: AreaGroup[] = [
  {
    area: 'Engineering',
    accentColor: AREA_COLOR.Engineering,
    goals: [
      {
        id: 'g-passkeys',
        title: 'Passwordless login by Q4',
        status: 'On track',
        progress: 40,
        tasks: '3/8 tasks',
        due: 'Nov 28',
        ownerArea: 'brand',
        ownerLabel: 'Chief',
        area: 'Engineering',
        badge: 'Needs you',
        subItems: [
          { id: 's1', title: 'Ship passkeys on web + iOS', meta: '', statusLabel: 'In review', statusKind: 'review', date: 'Nov 14' },
          { id: 's2', title: 'Android password fallback flow', meta: '', statusLabel: 'Slipping 2d', statusKind: 'slipping', date: 'Nov 23' },
          { id: 's3', title: 'Launch comms to all users', meta: '', statusLabel: 'To do', statusKind: 'todo', date: 'Nov 26' },
          { id: 's4', title: 'Open goal session · Chief asked you something 2h ago', meta: '', statusLabel: '', statusKind: 'todo', date: '' },
        ],
      },
      {
        id: 'g-p95',
        title: 'Cut p95 API latency to 250ms',
        status: 'On track',
        progress: 65,
        tasks: '8/12 tasks',
        due: 'Dec 12',
        ownerArea: 'dev',
        ownerLabel: 'Dev',
        area: 'Engineering',
      },
      {
        id: 'g-pg16',
        title: 'Postgres 16 upgrade',
        status: 'At risk',
        progress: 20,
        tasks: '2/10 tasks',
        due: 'Nov 30',
        ownerArea: 'dev',
        ownerLabel: 'Dev',
        area: 'Engineering',
      },
    ],
  },
  {
    area: 'Marketing',
    accentColor: AREA_COLOR.Marketing,
    goals: [
      {
        id: 'g-referral',
        title: 'Launch referral program',
        status: 'At risk',
        progress: 35,
        tasks: '4/11 tasks',
        due: 'Nov 20',
        ownerArea: 'marketing',
        ownerLabel: 'Growth',
        area: 'Marketing',
        badge: 'Needs you',
      },
      {
        id: 'g-casestudies',
        title: '3 case studies published',
        status: 'On track',
        progress: 66,
        tasks: '2/3 tasks',
        due: 'Dec 5',
        ownerArea: 'marketing',
        ownerLabel: 'Growth',
        area: 'Marketing',
      },
    ],
  },
  {
    area: 'Business',
    accentColor: AREA_COLOR.Business,
    goals: [
      {
        id: 'g-pilots',
        title: 'Close 5 enterprise pilots',
        status: 'Blocked',
        progress: 0,
        tasks: '1/5 tasks',
        due: 'Dec 19',
        ownerArea: 'sales',
        ownerLabel: 'Sales',
        area: 'Business',
        badge: 'Needs you',
      },
      {
        id: 'g-octbooks',
        title: 'Close October books',
        status: 'On track',
        progress: 70,
        tasks: '7/10 tasks',
        due: 'Nov 7',
        ownerArea: 'finance',
        ownerLabel: 'Finance',
        area: 'Business',
      },
    ],
  },
]

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

// ── NeedsYouBadge ─────────────────────────────────────────────────────────────

function NeedsYouBadge() {
  return (
    <span className="inline-flex h-[20px] shrink-0 items-center rounded-pill px-[7px] text-[11px] font-semibold"
      style={{ background: '#EB68341A', color: '#C2410C' }}>
      Needs you
    </span>
  )
}

// ── SubItemRow ────────────────────────────────────────────────────────────────

function SubItemRow({ item }: { item: OfficeSubItem }) {
  const st = item.statusKind !== 'todo' || item.statusLabel
    ? SUB_ITEM_STATUS[item.statusKind]
    : null

  return (
    <div className="flex items-center gap-[10px] py-[5px] pr-[12px]">
      <span className="size-[5px] shrink-0 rounded-full bg-faint" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{item.title}</span>
      {st && item.statusLabel && (
        <span className="text-[11.5px] shrink-0 whitespace-nowrap" style={{ color: st.ink }}>
          {item.statusLabel}
        </span>
      )}
      {item.date && (
        <span className="text-[11.5px] text-faint shrink-0 whitespace-nowrap">{item.date}</span>
      )}
    </div>
  )
}

// ── GoalRow ───────────────────────────────────────────────────────────────────

function GoalRow({
  goal,
  expanded,
  onToggle,
}: {
  goal: OfficeGoalRow
  expanded: boolean
  onToggle: () => void
}) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col">
      {/* Main row */}
      <div className="flex w-full items-center gap-[10px] py-[10px]">
        {/* Left clickable: ring + title (+ Needs you) + inline status meta */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-[12px] rounded-base px-[2px] py-0 text-left transition-colors hover:bg-soft"
        >
          <StatusRing value={goal.progress} status={goal.status} />
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="flex min-w-0 items-center gap-[8px]">
              <span className="truncate text-[13.5px] font-medium text-ink">{goal.title}</span>
              {goal.badge && <NeedsYouBadge />}
            </span>
            <span className="text-[11.5px] text-muted">
              <span className="font-medium" style={{ color: RING_COLOR[goal.status] }}>{goal.status}</span>
              {' · '}{goal.progress}% · {goal.tasks} · due {goal.due}
            </span>
          </span>
        </button>

        {/* Owner avatar + name */}
        <span className="flex shrink-0 items-center gap-[6px]">
          <Mascot size={18} radius={5} area={goal.ownerArea} title={goal.ownerLabel} />
          <span className="text-[12px] text-ink-2">{goal.ownerLabel}</span>
        </span>

        {/* Session action */}
        <Button variant="secondary" height={28} icon={MessageCircle} onClick={() => navigate({ to: '/chat' })}>
          Session
        </Button>
      </div>

      {/* Expanded sub-items */}
      {expanded && goal.subItems && goal.subItems.length > 0 && (
        <div className="flex flex-col gap-px pb-[6px] pl-[56px]">
          <div className="flex flex-col gap-px border-l border-line-strong pl-[12px]">
            {goal.subItems.map((sub) => (
              <SubItemRow key={sub.id} item={sub} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── AreaGroupSection ──────────────────────────────────────────────────────────

function AreaGroupSection({
  group,
  expandedId,
  onToggle,
}: {
  group: AreaGroup
  expandedId: string | null
  onToggle: (id: string) => void
}) {
  return (
    <section aria-label={group.area}>
      {/* Area heading row */}
      <div className="flex items-center gap-[6px] pb-[4px] pt-[16px]">
        <span
          aria-hidden
          className="size-[8px] shrink-0 rounded-full"
          style={{ background: group.accentColor }}
        />
        <span className="text-[12.5px] font-semibold" style={{ color: group.accentColor }}>
          {group.area}
        </span>
        <span className="text-[12px] text-muted">{group.goals.length} goals</span>
      </div>

      <div className="flex flex-col divide-y divide-line">
        {group.goals.map((goal) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            expanded={expandedId === goal.id}
            onToggle={() => onToggle(goal.id)}
          />
        ))}
      </div>
    </section>
  )
}

const ALL_GOALS_COUNT = AREA_GROUPS.reduce((n, g) => n + g.goals.length, 0)

// ── StatusFilter tabs ─────────────────────────────────────────────────────────

type StatusFilter = 'All' | 'Needs you' | 'At risk' | 'Blocked' | 'On track'

const STATUS_FILTERS: StatusFilter[] = ['All', 'Needs you', 'At risk', 'Blocked', 'On track']

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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={drawerOverlayClass} />

        <Dialog.Content
          aria-describedby="new-goal-desc"
          style={{ width: 440 }}
          className={drawerContentClass}
        >
          {/* Header */}
          <div className="flex items-start gap-[8px] px-[22px] pt-[22px] pb-[14px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <Dialog.Title className="m-0 text-[15px] font-semibold text-ink">
                New goal
              </Dialog.Title>
              <p id="new-goal-desc" className="m-0 text-[12.5px] leading-[1.4] text-muted">
                Say what you want to move. Chief turns it into key results and assigns helpers.
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close dialog"
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm text-faint transition-colors hover:bg-hover hover:text-muted"
              >
                <X size={15} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {/* Scrollable body */}
          <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto px-[22px] pb-[4px]">
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
                    style={{ background: AREA_COLOR.Engineering }}
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
          </div>

          {/* Footer */}
          <div className="flex items-center gap-[8px] border-t border-line px-[22px] py-[14px]">
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
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── OfficeGoalsPage ───────────────────────────────────────────────────────────

/**
 * Shared Goals board for both modes. `areaId === null` → all areas, grouped
 * by area (company view); a specific area → just that area's goals.
 */
function GoalsBoard({ areaId }: { areaId: string | null }) {
  const { data: area } = useArea(areaId ?? '')
  const areaName = areaId ? area?.name ?? '' : null
  const [expandedId, setExpandedId] = useState<string | null>(AREA_GROUPS[0].goals[0].id)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [dialogOpen, setDialogOpen] = useState(false)

  // Scope to the selected area (matched by name), or all areas when null.
  const scopedGroups = areaName ? AREA_GROUPS.filter((g) => g.area === areaName) : AREA_GROUPS
  const allGoals = scopedGroups.flatMap((g) => g.goals)
  const statusCounts: Record<StatusFilter, number> = {
    All: allGoals.length,
    'Needs you': allGoals.filter((g) => g.badge === 'Needs you').length,
    'At risk': allGoals.filter((g) => g.status === 'At risk').length,
    Blocked: allGoals.filter((g) => g.status === 'Blocked').length,
    'On track': allGoals.filter((g) => g.status === 'On track').length,
  }

  const filteredGroups = scopedGroups
    .map((g) => ({
      ...g,
      goals:
        statusFilter === 'All'
          ? g.goals
          : statusFilter === 'Needs you'
            ? g.goals.filter((goal) => goal.badge === 'Needs you')
            : g.goals.filter((goal) => goal.status === statusFilter),
    }))
    .filter((g) => g.goals.length > 0)

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
              ? `${allGoals.length} goals this quarter. Open a goal to jump into its session, tasks and decisions.`
              : `${ALL_GOALS_COUNT} goals this quarter across every area. Open a goal to jump into its session, tasks and decisions.`}
          </p>
        </header>

        {/* Filter bar — status only */}
        <div className="mt-[14px] mb-[6px]">
          <StatusFilterTabs active={statusFilter} onChange={setStatusFilter} counts={statusCounts} />
        </div>

        {/* Goal groups */}
        {filteredGroups.length === 0 ? (
          <p className="mt-[24px] text-[13px] text-muted">
            {allGoals.length === 0 ? 'No goals in this area yet.' : 'No goals match the selected filter.'}
          </p>
        ) : (
          filteredGroups.map((group) => (
            <AreaGroupSection
              key={group.area}
              group={group}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId((prev) => (prev === id ? null : id))}
            />
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
