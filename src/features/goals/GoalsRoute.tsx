import { useEffect, useRef, useState } from 'react'
import { Drawer } from '../../ui/ds/Drawer'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'
import { ConfirmDialog } from '../../ui/ds/ConfirmDialog'
import { MenuItemBody, menuItemClass, menuSurface } from '../../ui/ds/Menu'
import { notify } from '../../ui/ds/Toaster'
import { accents } from '../../ui/ds/accents'
import type { HelperArea, Channel, Goal, GoalStatus, Helper } from '../../core/domain/types'
import {
  useArea,
  useAreas,
  useGoals,
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  useGoalDetail,
  useHelpers,
  useOpenGoalSession,
  useReplanGoal,
} from '../../app/queries'
import { useUIStore } from '../../app/store'

const HELPER_AREAS: HelperArea[] = ['brand', 'ops', 'dev', 'support', 'finance', 'marketing', 'sales', 'retro']
const areaOf = (h: Helper | undefined): HelperArea =>
  h && (HELPER_AREAS as string[]).includes(h.area) ? h.area : 'ops'

/** "2026-Q4" → "Q4 2026" */
function periodLabel(period: string): string {
  const m = period.match(/^(\d{4})-Q([1-4])$/)
  return m ? `Q${m[2]} ${m[1]}` : period
}

function currentPeriod(now = new Date()): string {
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`
}

/** "2026-11-30" → "Nov 30"; free-form labels pass through. */
function dueLabel(due: string): string {
  const m = due.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return due
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Helper-picker popover ─────────────────────────────────────────────────────

function HelperPickerPopover({
  anchor,
  helpers,
  current,
  onSelect,
  onClose,
}: {
  anchor: DOMRect | null
  helpers: Helper[]
  current: string[]
  onSelect: (helper: Helper) => void
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
        {helpers.length === 0 && <p className="px-[10px] py-[6px] text-[12.5px] text-muted">No helpers yet</p>}
        {helpers.map((h) => (
          <button
            key={h.id}
            type="button"
            disabled={current.includes(h.id)}
            onClick={() => { onSelect(h); onClose() }}
            className="flex w-full items-center gap-[8px] px-[10px] py-[6px] text-[13px] text-ink-2 hover:bg-hover disabled:opacity-40 disabled:pointer-events-none"
          >
            <Mascot size={16} radius={4} area={areaOf(h)} />
            {h.name}
          </button>
        ))}
      </div>
    </>
  )
}

// ── Status ────────────────────────────────────────────────────────────────────
// Status is derived server-side (Chief/system) unless the user overrode it.

const STATUS_LABEL: Record<GoalStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  blocked: 'Blocked',
  needs_you: 'Needs you',
  done: 'Done',
}

const RING_COLOR: Record<GoalStatus, string> = {
  on_track: 'var(--color-ok)',
  at_risk: 'var(--color-warn)',
  blocked: 'var(--color-bad)',
  needs_you: '#EB6834',
  done: 'var(--color-ok)',
}

const statusOf = (g: Goal): GoalStatus => g.status ?? 'on_track'

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

// ── GoalRow ───────────────────────────────────────────────────────────────────

const JOB_STATUS_LABEL: Record<string, string> = {
  done: 'Done',
  running: 'Running',
  queued: 'Queued',
  waiting: 'Waiting on you',
  failed: 'Failed',
  blocked: 'Blocked',
  cancelled: 'Stopped',
}

/** Key results = the work Chief planned for the goal (GET /v1/goals/{id}). */
function GoalWork({ goalId }: { goalId: string }) {
  const { data, isLoading, isError } = useGoalDetail(goalId)
  const { data: helpers = [] } = useHelpers()
  if (isLoading) return <p className="m-0 py-[6px] pl-[30px] text-[12px] text-muted">Loading…</p>
  if (isError) return <p className="m-0 py-[6px] pl-[30px] text-[12px] text-bad">Couldn’t load the goal’s work.</p>
  const work = (data?.jobs ?? []).filter((j) => j.origin === 'delegation')
  const pending = (data?.proposals ?? []).filter((p) => p.status === 'pending')
  if (work.length === 0 && pending.length === 0) {
    return (
      <p className="m-0 py-[6px] pl-[30px] text-[12px] text-muted">
        No key results yet — use Replan to let Chief draft them.
      </p>
    )
  }
  return (
    <ul aria-label="Key results" className="m-0 flex list-none flex-col gap-[4px] p-0 pb-[8px] pl-[30px]">
      {work.map((j) => {
        const h = helpers.find((x) => x.id === j.helperId)
        return (
          <li key={j.id} className="flex items-center gap-[8px] text-[12.5px]">
            <Mascot size={16} radius={4} area={areaOf(h)} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{j.brief}</span>
            <span className="text-[11.5px] text-muted">{JOB_STATUS_LABEL[j.status] ?? j.status}</span>
          </li>
        )
      })}
      {pending.map((p) => (
        <li key={p.id} className="flex items-center gap-[8px] text-[12.5px]">
          <span aria-hidden className="size-[8px] shrink-0 rounded-full" style={{ background: RING_COLOR.needs_you }} />
          <span className="min-w-0 flex-1 truncate text-ink-2">{p.title}</span>
          <span className="text-[11.5px] font-medium" style={{ color: RING_COLOR.needs_you }}>Needs you</span>
        </li>
      ))}
    </ul>
  )
}

function GoalRow({ goal, onEdit }: { goal: Goal; onEdit: (goal: Goal) => void }) {
  const navigate = useNavigate()
  const openGoalSession = useOpenGoalSession()
  const replanGoal = useReplanGoal()
  const deleteGoal = useDeleteGoal()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const status = statusOf(goal)

  // The goal's home is its chat session — created once server-side, then reused.
  function openSession() {
    if (goal.sessionId) {
      void navigate({ to: '/chat/$sessionId', params: { sessionId: goal.sessionId } })
      return
    }
    openGoalSession.mutate(goal.id, {
      onSuccess: (session) => void navigate({ to: '/chat/$sessionId', params: { sessionId: session.id } }),
      onError: () => notify('Couldn’t open the goal’s session'),
    })
  }

  function replan() {
    replanGoal.mutate(goal.id, {
      onSuccess: () => {
        notify('Chief is replanning this goal')
        setExpanded(true)
      },
      onError: () => notify('Couldn’t replan the goal'),
    })
  }

  const meta = [
    goal.due ? `Due ${dueLabel(goal.due)}` : null,
    goal.measuredBy ? `${goal.measuredBy}${goal.target ? ` → ${goal.target}` : ''}` : null,
  ].filter(Boolean)

  return (
    <div className="flex flex-col">
      <div className="flex w-full items-center gap-[10px] py-[10px]">
        <button
          type="button"
          aria-label={expanded ? `Hide work for ${goal.title}` : `Show work for ${goal.title}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className="-mr-[6px] inline-flex size-[20px] shrink-0 items-center justify-center rounded-sm text-faint hover:bg-hover hover:text-ink-2"
        >
          {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        </button>
        <button
          type="button"
          aria-label={goal.title}
          onClick={openSession}
          className="flex min-w-0 flex-1 items-center gap-[12px] rounded-base px-[2px] py-0 text-left transition-colors hover:bg-soft"
        >
          <StatusRing value={goal.progress} status={status} />
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="truncate text-[13.5px] font-medium text-ink">{goal.title}</span>
            <span className="truncate text-[11.5px] text-muted">
              <span className="font-medium" style={{ color: RING_COLOR[status] }}>{STATUS_LABEL[status]}</span>
              {' · '}{goal.progress}%
              {meta.length > 0 && ` · ${meta.join(' · ')}`}
            </span>
          </span>
        </button>

        {/* Session action */}
        <Button variant="secondary" height={28} icon={MessageCircle} onClick={openSession}>
          Session
        </Button>

        {/* Row menu: edit / replan / delete */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={`Goal options for ${goal.title}`}
              className="inline-flex size-[28px] shrink-0 items-center justify-center rounded-base text-muted transition-colors hover:bg-hover hover:text-ink-2 data-[state=open]:bg-hover"
            >
              <MoreHorizontal size={16} aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content side="bottom" align="end" sideOffset={6} className={`z-50 w-[160px] ${menuSurface}`}>
              <DropdownMenu.Item className={menuItemClass} onSelect={() => onEdit(goal)}>
                <MenuItemBody icon={Pencil} label="Edit goal" />
              </DropdownMenu.Item>
              <DropdownMenu.Item className={menuItemClass} onSelect={replan}>
                <MenuItemBody icon={RefreshCw} label="Replan" />
              </DropdownMenu.Item>
              <DropdownMenu.Item className={menuItemClass} onSelect={() => setConfirmOpen(true)}>
                <MenuItemBody icon={Trash2} label="Delete goal" />
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {expanded && <GoalWork goalId={goal.id} />}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete "${goal.title}"?`}
        message="This goal and its progress will be removed. This can't be undone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          deleteGoal.mutate(goal.id, {
            onSuccess: () => notify('Goal deleted'),
          })
        }}
      />
    </div>
  )
}

// ── AreaGroupSection ──────────────────────────────────────────────────────────

interface LiveAreaGroup {
  channel: Channel
  accentColor: string
  goals: Goal[]
}

function AreaGroupSection({ group, onEdit }: { group: LiveAreaGroup; onEdit: (goal: Goal) => void }) {
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
          <GoalRow key={goal.id} goal={goal} onEdit={onEdit} />
        ))}
      </div>
    </section>
  )
}

// ── StatusFilter tabs ─────────────────────────────────────────────────────────

type StatusFilter = 'all' | GoalStatus

const STATUS_FILTERS: StatusFilter[] = ['all', 'on_track', 'at_risk', 'blocked', 'needs_you', 'done']

function StatusFilterTabs({
  active,
  onChange,
  counts,
}: {
  active: StatusFilter
  onChange: (f: StatusFilter) => void
  counts: Record<StatusFilter, number>
}) {
  // Always show All + On track; the other statuses only when some goal has them.
  const shown = STATUS_FILTERS.filter((f) => f === 'all' || f === 'on_track' || counts[f] > 0 || f === active)
  return (
    <div className="flex items-center gap-[2px]">
      {shown.map((f) => {
        const isActive = active === f
        return (
          <button
            key={f}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(f)}
            className={`inline-flex h-[28px] items-center gap-[5px] rounded-sm px-[8px] text-[12.5px] transition-colors ${
              isActive
                ? 'bg-hover font-medium text-ink'
                : 'text-muted hover:bg-hover hover:text-ink-2'
            }`}
          >
            {f === 'all' ? 'All' : STATUS_LABEL[f]}
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
  /** Areas available for the Channel select (id + name). */
  areas: Channel[]
  /** When set, the dialog edits this goal instead of creating a new one. */
  editing?: Goal | null
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
function HelperAvatar({ label, area, onRemove }: { label: string; area: HelperArea; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-[5px] rounded-pill bg-soft px-[8px] py-[4px] text-[12px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-strong">
      <Mascot size={16} radius={4} area={area} />
      {label}
      {onRemove && (
        <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className="text-faint hover:text-ink-2">
          <X size={11} aria-hidden />
        </button>
      )}
    </span>
  )
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * New / edit goal dialog. Creates via useCreateGoal or (when `editing` is set)
 * patches via useUpdateGoal, reading the bound fields. Channel is chosen from
 * the real areas list so a channelId is sent to the backend.
 */
export function NewGoalDialog({ open, onOpenChange, areas, editing = null }: NewGoalDialogProps) {
  const navigate = useNavigate()
  const createGoal = useCreateGoal()
  const updateGoal = useUpdateGoal()
  const { data: allHelpers = [] } = useHelpers()
  const isEditing = editing !== null
  const firstChannelId = areas[0]?.id ?? ''

  const [goalText, setGoalText] = useState('')
  const [channelId, setChannelId] = useState('')
  const [due, setDue] = useState('')
  const [measured, setMeasured] = useState('')
  const [target, setTarget] = useState('')
  const [statusChoice, setStatusChoice] = useState<'auto' | GoalStatus>('auto')
  const [chiefDraft, setChiefDraft] = useState(true)
  const [helperIds, setHelperIds] = useState<string[]>([])
  const [helperAnchor, setHelperAnchor] = useState<DOMRect | null>(null)
  const addHelperRef = useRef<HTMLButtonElement>(null)

  // Seed the form whenever the dialog opens (either blank for create or from the
  // goal being edited).
  useEffect(() => {
    if (!open) return
    setGoalText(editing?.title ?? '')
    setChannelId(editing?.channelId ?? firstChannelId)
    setDue(editing?.due ?? '')
    setMeasured(editing?.measuredBy ?? '')
    setTarget(editing?.target ?? '')
    setHelperIds(editing?.helperIds ?? [])
    setStatusChoice(editing?.statusSetBy === 'user' && editing.status ? editing.status : 'auto')
    setChiefDraft(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  if (!open) return null

  const canSubmit = goalText.trim().length > 0 && channelId !== ''
  const channel = areas.find((a) => a.id === channelId)
  const channelColor = channel ? (accents[channel.accent]?.color ?? accents.general.color) : accents.general.color

  function submit() {
    if (!canSubmit) return
    if (isEditing && editing) {
      const wasOverride = editing.statusSetBy === 'user'
      updateGoal.mutate(
        {
          id: editing.id,
          input: {
            title: goalText.trim(),
            target: target.trim(),
            channelId,
            due: due.trim(),
            measuredBy: measured.trim(),
            helperIds,
            ...(statusChoice !== 'auto'
              ? { status: statusChoice }
              : wasOverride
                ? { status: 'auto' }
                : {}),
          },
        },
        {
          onSuccess: () => notify('Goal updated'),
          onError: () => notify('Couldn’t update the goal'),
        },
      )
    } else {
      createGoal.mutate(
        {
          channelId,
          title: goalText.trim(),
          target: target.trim(),
          due: due.trim() || undefined,
          measuredBy: measured.trim() || undefined,
          helperIds,
          period: ISO_DATE.test(due) ? currentPeriod(new Date(`${due}T00:00:00`)) : undefined,
          draftKeyResults: chiefDraft,
        },
        {
          onSuccess: () => notify(chiefDraft ? 'Goal created — Chief is drafting key results' : 'Goal created'),
          onError: () => notify('Couldn’t create the goal'),
        },
      )
    }
    onOpenChange(false)
  }

  const helperById = (id: string) => allHelpers.find((h) => h.id === id)

  return (
    <Drawer
      title={isEditing ? 'Edit goal' : 'New goal'}
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
          <Button
            variant="primary"
            height={30}
            icon={Target}
            disabled={!canSubmit}
            onClick={submit}
          >
            {isEditing ? 'Save goal' : 'Create goal'}
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
                    data-testid="goal-channel-dot"
                    className="size-[8px] shrink-0 rounded-full"
                    style={{ background: channelColor }}
                  />
                  <select
                    id="goal-channel"
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
                  >
                    {areas.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.name}</option>
                    ))}
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
                    type={due === '' || ISO_DATE.test(due) ? 'date' : 'text'}
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

            {/* Status override (edit only) */}
            {isEditing && (
              <div className="flex flex-col gap-[6px]">
                <label className="text-[12px] font-medium text-ink-2" htmlFor="goal-status">
                  Status
                </label>
                <select
                  id="goal-status"
                  value={statusChoice}
                  onChange={(e) => setStatusChoice(e.target.value as 'auto' | GoalStatus)}
                  className="rounded-base bg-soft px-[10px] py-[7px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary"
                >
                  <option value="auto">Let Chief decide{editing?.status && editing.statusSetBy !== 'user' ? ` (now: ${STATUS_LABEL[editing.status]})` : ''}</option>
                  {(Object.keys(STATUS_LABEL) as GoalStatus[]).map((st) => (
                    <option key={st} value={st}>{STATUS_LABEL[st]}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Helpers on it */}
            <div className="flex flex-col gap-[6px]">
              <span className="text-[12px] font-medium text-ink-2">Helpers on it</span>
              <div className="flex flex-wrap items-center gap-[6px]">
                {helperIds.length === 0 && (
                  <span className="text-[12px] text-faint">Chief picks helpers if you don’t.</span>
                )}
                {helperIds.map((id) => {
                  const h = helperById(id)
                  return (
                    <HelperAvatar
                      key={id}
                      label={h?.name ?? 'Helper'}
                      area={areaOf(h)}
                      onRemove={() => setHelperIds((prev) => prev.filter((x) => x !== id))}
                    />
                  )
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
                helpers={allHelpers}
                current={helperIds}
                onSelect={(h) => setHelperIds((prev) => [...prev, h.id])}
                onClose={() => setHelperAnchor(null)}
              />
            </div>

            {/* Chief draft key results (create only — Replan covers existing goals) */}
            {!isEditing && (
              <div className="flex items-start gap-[10px] rounded-base bg-soft p-[12px] outline-1 -outline-offset-1 outline-line-strong">
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="text-[12.5px] font-medium text-ink">
                    Let Chief draft key results
                  </span>
                  <span className="text-[11.5px] leading-[1.4] text-muted">
                    Chief proposes key results and assigns the helpers. Turn off to just track the goal.
                  </span>
                </div>
                <Toggle
                  on={chiefDraft}
                  onChange={setChiefDraft}
                  label="Let Chief draft key results"
                />
              </div>
            )}
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

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)

  function openNewGoal() {
    setEditingGoal(null)
    setDialogOpen(true)
  }
  function openEditGoal(goal: Goal) {
    setEditingGoal(goal)
    setDialogOpen(true)
  }

  const areaName = areaId ? area?.name ?? '' : null
  const isLoading = areasLoading || goalsLoading
  const isError = areasError || goalsError

  // Build area groups: each Channel that has at least one goal in the current scope.
  const groupsFor = (goals: Goal[]): LiveAreaGroup[] =>
    (areaId ? allAreas.filter((ch) => ch.id === areaId) : allAreas)
      .map((ch) => ({
        channel: ch,
        accentColor: accents[ch.accent]?.color ?? '#78716C',
        goals: goals.filter((g) => g.channelId === ch.id),
      }))
      .filter((g) => g.goals.length > 0)

  const filteredGoals = statusFilter === 'all' ? allGoals : allGoals.filter((g) => statusOf(g) === statusFilter)
  const filteredGroups = groupsFor(filteredGoals)

  const totalGoals = allGoals.length
  const counts = STATUS_FILTERS.reduce(
    (acc, f) => ({ ...acc, [f]: f === 'all' ? totalGoals : allGoals.filter((g) => statusOf(g) === f).length }),
    {} as Record<StatusFilter, number>,
  )

  // Reporting period: the most common period among the goals (else this quarter).
  const periodCounts = new Map<string, number>()
  for (const g of allGoals) if (g.period) periodCounts.set(g.period, (periodCounts.get(g.period) ?? 0) + 1)
  const period = [...periodCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? currentPeriod()
  const periodText = periodLabel(period)
  const inPeriod = periodCounts.size <= 1

  return (
    <>
      <Topbar
        icon={Target}
        title="Goals"
        meta={areaName ? `in ${areaName} · ${periodText}` : `All areas · ${periodText}`}
        actions={
          <div className="flex items-center gap-[6px]">
            <Button icon={Plus} height={28} onClick={openNewGoal}>
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
            {`${totalGoals} goal${totalGoals === 1 ? '' : 's'} ${inPeriod ? `in ${periodText}` : 'across several periods'}${areaName ? '' : ' across every area'}. Open a goal to jump into its session, tasks and decisions.`}
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
            <p className="m-0 text-[14px] font-medium text-ink-2">{totalGoals === 0 ? 'No goals yet' : 'Nothing here'}</p>
            <p className="m-0 text-[12.5px] text-muted">
              {totalGoals === 0
                ? 'Create your first goal to start tracking what the team is pushing on.'
                : 'No goals match the selected filter.'}
            </p>
            {totalGoals === 0 && (
              <Button icon={Plus} height={30} onClick={openNewGoal} className="mt-[4px]">
                New goal
              </Button>
            )}
          </div>
        ) : (
          filteredGroups.map((group) => (
            <AreaGroupSection key={group.channel.id} group={group} onEdit={openEditGoal} />
          ))
        )}
      </div>

      <NewGoalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        areas={allAreas}
        editing={editingGoal}
      />
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
