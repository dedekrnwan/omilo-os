/**
 * GoalContext — "From Office (Goal)" session state (pen refs AQW5x / E8dtI / aUAIu).
 *
 * Renders a goal-context banner that wraps/sits above the session thread when the
 * session was opened from an Office goal. The banner holds:
 *   - Goal title, status, breadcrumb
 *   - Progress bar
 *   - "Add agent" popover  (aUAIu) — real helpers; picking one asks them in the chat
 *   - "Edit goal" dialog   (E8dtI) — saves through PATCH /v1/goals/{id}
 *
 * IMPORTANT: No nested interactive elements — every clickable leaf is a standalone
 * <button> or <input>; none wraps another interactive element.
 */

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Drawer } from '../ds/Drawer'
import * as Popover from '@radix-ui/react-popover'
import { Check, Pause, Play, Search, Trash2, UserPlus, X } from 'lucide-react'
import { Mascot } from '../ds/Mascot'
import type { HelperArea, SessionParticipant } from '../../core/domain/types'
import { menuSurface } from '../ds/Menu'
import { notify } from '../ds/Toaster'
import { useDeleteGoal, useGoals, useHelpers, useUpdateGoal } from '../../app/queries'

// ── Types ────────────────────────────────────────────────────────────────────

interface GoalContextProps {
  /** Goal id (the banner reads title / progress from the goals list). */
  goalId?: string
  /** Fallback title when the goal isn't loaded, e.g. "Passwordless login by Q4" */
  goalTitle: string
  /** Area / channel name, e.g. "Engineering" */
  area?: string
  /** Helpers already in the chat (shown on the goal, excluded from Add agent). */
  helpers?: SessionParticipant[]
  /** Called when a helper is picked from "Add agent" (e.g. ask them in the chat). */
  onAddHelper?: (name: string, area: HelperArea) => void
}

// ── EditGoalDialog (E8dtI) ───────────────────────────────────────────────────

interface EditGoalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Goal to save. Without it the dialog only closes (nothing to persist). */
  goalId?: string
  goalTitle: string
  /** "Done means" — the goal's target outcome. */
  target?: string
  area?: string
  helpers?: SessionParticipant[]
  onAddHelper?: (name: string, area: HelperArea) => void
}

export function EditGoalDialog({
  open,
  onOpenChange,
  goalId,
  goalTitle,
  target = '',
  area,
  helpers = [],
  onAddHelper,
}: EditGoalDialogProps) {
  const [title, setTitle] = useState(goalTitle)
  const [doneMeans, setDoneMeans] = useState(target)
  const updateGoal = useUpdateGoal()
  const deleteGoal = useDeleteGoal()

  if (!open) return null

  function save() {
    if (goalId && title.trim()) {
      const input: { title?: string; target?: string } = {}
      if (title.trim() !== goalTitle) input.title = title.trim()
      if (doneMeans.trim() !== target) input.target = doneMeans.trim()
      if (Object.keys(input).length) {
        updateGoal.mutate(
          { id: goalId, input },
          { onSuccess: () => notify('Goal saved — Chief will re-plan'), onError: () => notify('Couldn’t save the goal — try again') },
        )
      }
    }
    onOpenChange(false)
  }

  return (
    <Drawer
      title="Edit goal"
      subtitle="Chief re-plans tasks when you change the date or outcome."
      onClose={() => onOpenChange(false)}
      width={480}
      bodyClass="gap-[14px] px-[24px] py-[16px]"
      footer={
        <>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center justify-center rounded-btn px-[14px] py-[7px] text-[12.5px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="inline-flex items-center gap-[5px] rounded-btn bg-primary px-[14px] py-[7px] text-[12.5px] font-medium text-primary-ink transition-colors hover:bg-primary-hover"
          >
            <Check size={13} aria-hidden />
            Save goal
          </button>
        </>
      }
    >
      {/* Goal title field */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[12px] font-medium text-ink-2" htmlFor="eg-title">Goal</label>
        <input
          id="eg-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-base bg-app px-[10px] py-[8px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary"
        />
      </div>

      {/* Done means */}
      <div className="flex flex-col gap-[5px]">
        <label className="text-[12px] font-medium text-ink-2" htmlFor="eg-done">Done means</label>
        <textarea
          id="eg-done"
          value={doneMeans}
          placeholder="What has to be true for this goal to be done?"
          onChange={(e) => setDoneMeans(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-base bg-app px-[10px] py-[8px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary"
        />
      </div>

      {area && (
        <div className="flex flex-col gap-[5px]">
          <span className="text-[12px] font-medium text-ink-2">Area</span>
          <div className="flex items-center gap-[6px] rounded-base bg-app px-[10px] py-[7px] outline-1 -outline-offset-1 outline-line-strong">
            <span className="flex-1 text-[13px] text-ink">{area}</span>
          </div>
        </div>
      )}

      {/* Helpers */}
      <div className="flex flex-col gap-[5px]">
        <span className="text-[12px] font-medium text-ink-2">Helpers on this goal</span>
        <div className="flex flex-wrap items-center gap-[6px]">
          {helpers.map((h) => (
            <div key={h.name} className="flex items-center gap-[4px] rounded-pill bg-soft px-[8px] py-[3px] outline-1 -outline-offset-1 outline-line-strong">
              <Mascot size={16} radius={4.5} area={h.area} />
              <span className="text-[12px] text-ink">{h.name}</span>
            </div>
          ))}
          <AddAgentPopover exclude={helpers.map((h) => h.name)} onAdd={onAddHelper}>
            <button
              type="button"
              aria-label="Add helper"
              className="inline-flex size-[24px] items-center justify-center rounded-full text-muted outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
            >
              <UserPlus size={13} aria-hidden />
            </button>
          </AddAgentPopover>
        </div>
      </div>

      {/* Danger actions */}
      {goalId && (
        <div className="flex items-center gap-[8px]">
          <button
            type="button"
            onClick={() => {
              updateGoal.mutate(
                { id: goalId, input: { status: 'archived' } },
                { onSuccess: () => notify('Goal archived'), onError: () => notify('Couldn’t archive the goal — try again') },
              )
              onOpenChange(false)
            }}
            className="inline-flex items-center gap-[5px] text-[12.5px] text-muted hover:text-ink transition-colors"
          >
            <X size={13} aria-hidden />
            Archive goal
          </button>
          <button
            type="button"
            onClick={() => {
              deleteGoal.mutate(goalId, {
                onSuccess: () => notify('Goal deleted'),
                onError: () => notify('Couldn’t delete the goal — try again'),
              })
              onOpenChange(false)
            }}
            className="inline-flex items-center gap-[5px] text-[12.5px] text-bad hover:underline transition-colors"
          >
            <Trash2 size={13} aria-hidden />
            Delete goal
          </button>
        </div>
      )}
    </Drawer>
  )
}

// ── AddAgentPopover (aUAIu) ──────────────────────────────────────────────────

interface AddAgentPopoverProps {
  children: React.ReactNode
  /** Helper names already involved (hidden from the list). */
  exclude?: string[]
  /** Called when a helper is selected. Close is handled internally. */
  onAdd?: (name: string, area: HelperArea) => void
}

export function AddAgentPopover({ children, exclude = [], onAdd }: AddAgentPopoverProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { data: helpers = [], isLoading } = useHelpers()

  const filtered = helpers
    .filter((h) => !h.isChief && !exclude.includes(h.name) && h.status !== 'paused')
    .filter((h) => h.name.toLowerCase().includes(query.toLowerCase()))

  function handleSelect(name: string, area: HelperArea) {
    onAdd?.(name, area)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className={`${menuSurface} z-50 w-[280px]`}
        >
          {/* Search */}
          <div className="flex items-center gap-[6px] rounded-sm px-[8px] py-[6px] outline-1 -outline-offset-1 outline-line-strong mx-[4px] mb-[4px]">
            <Search size={13} aria-hidden className="text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Add a helper to this goal"
              aria-label="Search agents"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
            />
          </div>

          {/* Agent list */}
          <ul role="listbox" aria-label="Available agents">
            {isLoading && <li className="px-[10px] py-[7px] text-[12px] text-muted">Loading helpers…</li>}
            {!isLoading && filtered.length === 0 && (
              <li className="px-[10px] py-[7px] text-[12px] text-muted">No other helpers to add.</li>
            )}
            {filtered.map((agent) => (
              <li key={agent.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => handleSelect(agent.name, agent.area)}
                  className="flex w-full items-start gap-[8px] rounded-sm px-[10px] py-[7px] text-left transition-colors hover:bg-hover"
                >
                  <Mascot size={24} radius={6.72} area={agent.area} title={agent.name} />
                  <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="text-[12.5px] font-medium text-ink">{agent.name}</span>
                    <span className="truncate text-[11.5px] text-muted">{agent.role ?? agent.jobDescription ?? ''}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* Hire new */}
          <div className="border-t border-line px-[4px] pt-[4px]">
            <button
              type="button"
              onClick={() => { setOpen(false); void navigate({ to: '/team' }) }}
              className="flex w-full items-center gap-[8px] rounded-sm px-[10px] py-[6px] text-left transition-colors hover:bg-hover"
            >
              <UserPlus size={14} aria-hidden className="text-muted" />
              <span className="text-[12.5px] text-muted">Hire a new helper…</span>
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ── GoalContextBanner (AQW5x) ─────────────────────────────────────────────────

export function GoalContextBanner({ goalId, goalTitle, area, helpers = [], onAddHelper }: GoalContextProps) {
  const [editOpen, setEditOpen] = useState(false)
  const { data: goals = [] } = useGoals(null)
  const updateGoal = useUpdateGoal()
  const goal = goalId ? goals.find((g) => g.id === goalId) : undefined
  const title = goal?.title ?? goalTitle
  const progress = goal?.progress ?? 0
  const [paused, setPaused] = useState(false)

  function togglePause() {
    const next = !paused
    setPaused(next)
    if (goalId) {
      updateGoal.mutate(
        { id: goalId, input: { status: next ? 'paused' : 'active' } },
        {
          onSuccess: () => notify(next ? 'Goal paused' : 'Goal resumed'),
          onError: () => { setPaused(!next); notify('Couldn’t update the goal — try again') },
        },
      )
    }
  }

  return (
    <>
      {/* Banner strip — sits above the thread in the split layout */}
      <div
        className="flex shrink-0 flex-col gap-[8px] border-b border-line-strong bg-soft px-[16px] py-[12px]"
        aria-label={`Goal: ${title}`}
        data-testid="goal-context-banner"
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-[6px] text-[11.5px] text-muted">
          <span>Goals</span>
          <span>/</span>
          <span className="text-ink-2">{title}</span>
        </div>

        {/* Title row */}
        <div className="flex items-start gap-[10px]">
          <div className="flex flex-1 flex-col gap-[4px]">
            <h2 className="m-0 text-[15px] font-semibold text-ink">{title}</h2>
            <div className="flex items-center gap-[8px]">
              <span className="inline-flex items-center gap-[4px] rounded-pill bg-ok-tint px-[7px] py-[2px] text-[11.5px] font-medium text-ok">
                {paused ? 'Paused' : progress >= 100 ? 'Done' : 'Active'}
              </span>
              {area && <span className="text-[12px] text-muted">{area}</span>}
            </div>
          </div>

          {/* Controls (AQW5x: Add agent + navigation) */}
          <div className="flex items-center gap-[6px]">
            <AddAgentPopover exclude={helpers.map((h) => h.name)} onAdd={onAddHelper}>
              <button
                type="button"
                aria-label="Add agent to goal"
                className="inline-flex items-center gap-[5px] rounded-btn px-[8px] py-[5px] text-[12px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-hover"
              >
                <UserPlus size={13} aria-hidden />
                Add agent
              </button>
            </AddAgentPopover>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-[8px]">
          <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-line-strong">
            <div
              className="h-full rounded-full bg-ok"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <span className="text-[12px] font-medium text-ink-2">{progress}%</span>
        </div>

        {/* Footer: edit + pause */}
        <div className="flex items-center justify-end gap-[6px]">
          <button
            type="button"
            aria-label="Edit goal"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-[5px] rounded-btn px-[8px] py-[4px] text-[12px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-hover"
          >
            Edit goal
          </button>
          <button
            type="button"
            aria-label={paused ? 'Resume goal' : 'Pause goal'}
            onClick={togglePause}
            className="inline-flex items-center gap-[5px] rounded-btn px-[8px] py-[4px] text-[12px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-hover"
          >
            {paused ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>

      {/* Edit goal dialog */}
      <EditGoalDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        goalId={goalId}
        goalTitle={title}
        area={area}
        helpers={helpers}
        onAddHelper={onAddHelper}
      />
    </>
  )
}
