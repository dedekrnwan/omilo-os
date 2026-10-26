/**
 * GoalContext — "From Office (Goal)" session state (pen refs AQW5x / E8dtI / aUAIu).
 *
 * Renders a goal-context banner that wraps/sits above the session thread when the
 * session was opened from an Office goal. The banner holds:
 *   - Goal title, status, due date, breadcrumb
 *   - Progress bar + tasks count
 *   - Linked agents (avatar row)
 *   - "Add agent" popover  (aUAIu) — rendered as a *Radix Popover*, no nested interactives
 *   - "Edit goal" dialog   (E8dtI) — rendered as a *Radix Dialog*
 *
 * IMPORTANT: No nested interactive elements — every clickable leaf is a standalone
 * <button> or <input>; none wraps another interactive element.
 */

import { useState } from 'react'
import { Drawer } from '../ds/Drawer'
import * as Popover from '@radix-ui/react-popover'
import {
  CalendarDays,
  Check,
  ChevronDown,
  Pause,
  Plus,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { Mascot } from '../ds/Mascot'
import type { HelperArea } from '../../core/domain/types'
import { menuSurface } from '../ds/Menu'
import { notify } from '../ds/Toaster'

// ── Types ────────────────────────────────────────────────────────────────────

interface GoalContextProps {
  /** Goal title, e.g. "Passwordless login by Q4" */
  goalTitle: string
  /** Optional percent progress 0–100 */
  progress?: number
  /** Status label */
  status?: string
  /** Human-readable due date label */
  due?: string
  /** Area / channel name, e.g. "Engineering" */
  area?: string
}

interface AgentOption {
  name: string
  area: HelperArea
  description: string
  recommended?: boolean
}

// ── Mock agents for "Add agent" popover (aUAIu) ──────────────────────────────

const AGENT_OPTIONS: AgentOption[] = [
  { name: 'Finance',  area: 'finance',   description: 'Tracks ad spend and invoices' },
  { name: 'Support',  area: 'support',   description: 'Answers residents about the change', recommended: true },
  { name: 'Sales',    area: 'sales',     description: 'Not usually needed for this goal' },
]

// ── EditGoalDialog (E8dtI) ───────────────────────────────────────────────────

interface EditGoalDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  goalTitle: string
  due?: string
  area?: string
}

const INITIAL_HELPERS: Array<{ area: HelperArea; name: string }> = [
  { area: 'brand', name: 'Chief' },
  { area: 'dev', name: 'Dev' },
  { area: 'marketing', name: 'Growth' },
]

export function EditGoalDialog({ open, onOpenChange, goalTitle, due = 'Nov 24, 2026', area = 'Engineering' }: EditGoalDialogProps) {
  const [title, setTitle] = useState(goalTitle)
  const [doneMeans, setDoneMeans] = useState(
    '80% of weekly active users sign in with a passkey. Legacy Android keeps password + OTP.',
  )
  const [helpers, setHelpers] = useState(INITIAL_HELPERS)

  if (!open) return null

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
            onClick={() => onOpenChange(false)}
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
                onChange={(e) => setDoneMeans(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-base bg-app px-[10px] py-[8px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary"
              />
            </div>

            {/* Due + Area row */}
            <div className="flex items-center gap-[12px]">
              <div className="flex flex-col gap-[5px]">
                <label className="text-[12px] font-medium text-ink-2" htmlFor="eg-due">Due</label>
                <div className="flex items-center gap-[6px] rounded-base bg-app px-[10px] py-[7px] outline-1 -outline-offset-1 outline-line-strong">
                  <CalendarDays size={13} aria-hidden className="text-muted" />
                  <span className="text-[13px] text-ink">{due}</span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-[5px]">
                <label className="text-[12px] font-medium text-ink-2" htmlFor="eg-area">Area</label>
                <div className="flex items-center gap-[6px] rounded-base bg-app px-[10px] py-[7px] outline-1 -outline-offset-1 outline-line-strong">
                  <span className="flex-1 text-[13px] text-ink">{area}</span>
                  <ChevronDown size={13} aria-hidden className="text-muted" />
                </div>
              </div>
            </div>

            {/* Owner */}
            <div className="flex flex-col gap-[5px]">
              <span className="text-[12px] font-medium text-ink-2">Owner</span>
              <div className="flex items-center gap-[6px] rounded-base bg-app px-[10px] py-[7px] outline-1 -outline-offset-1 outline-line-strong">
                <Mascot size={18} radius={5} area="brand" />
                <span className="flex-1 text-[13px] text-ink">Chief of Staff</span>
                <ChevronDown size={13} aria-hidden className="text-muted" />
              </div>
            </div>

            {/* Helpers */}
            <div className="flex flex-col gap-[5px]">
              <span className="text-[12px] font-medium text-ink-2">Helpers on this goal</span>
              <div className="flex flex-wrap items-center gap-[6px]">
                {helpers.map((h) => (
                  <div key={h.name} className="flex items-center gap-[4px] rounded-pill bg-soft px-[8px] py-[3px] outline-1 -outline-offset-1 outline-line-strong">
                    <Mascot size={16} radius={4.5} area={h.area} />
                    <span className="text-[12px] text-ink">{h.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${h.name}`}
                      onClick={() => setHelpers((prev) => prev.filter((x) => x.name !== h.name))}
                      className="inline-flex items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
                    >
                      <X size={11} aria-hidden />
                    </button>
                  </div>
                ))}
                <AddAgentPopover onAdd={(name, area) => setHelpers((prev) => prev.some(h => h.name === name) ? prev : [...prev, { name, area }])}>
                  <button
                    type="button"
                    aria-label="Add helper"
                    className="inline-flex size-[24px] items-center justify-center rounded-full text-muted outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
                  >
                    <Plus size={13} aria-hidden />
                  </button>
                </AddAgentPopover>
              </div>
            </div>

            {/* Re-plan notice */}
            <div className="flex items-start gap-[8px] rounded-base bg-warn-tint px-[10px] py-[8px] outline-1 -outline-offset-1 outline-warn-line">
              <span className="mt-[1px] text-[12.5px] text-warn">
                Moving the date to Nov 24 shifts 2 tasks. Chief will tell Dev and Growth.
              </span>
            </div>

            {/* Danger actions */}
            <div className="flex items-center gap-[8px]">
              <button
                type="button"
                className="inline-flex items-center gap-[5px] text-[12.5px] text-muted hover:text-ink transition-colors"
              >
                <X size={13} aria-hidden />
                Archive goal
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-[5px] text-[12.5px] text-bad hover:underline transition-colors"
              >
                <Trash2 size={13} aria-hidden />
                Delete goal
              </button>
            </div>
    </Drawer>
  )
}

// ── AddAgentPopover (aUAIu) ──────────────────────────────────────────────────

interface AddAgentPopoverProps {
  children: React.ReactNode
  /** Called when an agent is selected. Close is handled internally. */
  onAdd?: (name: string, area: HelperArea) => void
}

export function AddAgentPopover({ children, onAdd }: AddAgentPopoverProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = AGENT_OPTIONS.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase()),
  )

  function handleSelect(agent: AgentOption) {
    onAdd?.(agent.name, agent.area)
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
            {filtered.map((agent) => (
              <li key={agent.name} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => handleSelect(agent)}
                  className="flex w-full items-start gap-[8px] rounded-sm px-[10px] py-[7px] text-left transition-colors hover:bg-hover"
                >
                  <Mascot size={24} radius={6.72} area={agent.area} title={agent.name} />
                  <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <div className="flex items-center gap-[6px]">
                      <span className="text-[12.5px] font-medium text-ink">{agent.name}</span>
                      {agent.recommended && (
                        <span className="rounded-pill bg-info-tint px-[5px] py-[1px] text-[10.5px] font-medium text-info">
                          +
                        </span>
                      )}
                    </div>
                    <span className="text-[11.5px] text-muted">{agent.description}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {/* Hire new */}
          <div className="border-t border-line px-[4px] pt-[4px]">
            <button
              type="button"
              onClick={() => setOpen(false)}
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

export function GoalContextBanner({
  goalTitle,
  progress = 40,
  status = 'On track',
  due = 'due Nov 28',
  area = 'Engineering',
}: GoalContextProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [paused, setPaused] = useState(false)

  return (
    <>
      {/* Banner strip — sits above the thread in the split layout */}
      <div
        className="flex shrink-0 flex-col gap-[8px] border-b border-line-strong bg-soft px-[16px] py-[12px]"
        aria-label={`Goal: ${goalTitle}`}
        data-testid="goal-context-banner"
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-[6px] text-[11.5px] text-muted">
          <span>Goals</span>
          <span>/</span>
          <span className="text-ink-2">{goalTitle}</span>
        </div>

        {/* Title row */}
        <div className="flex items-start gap-[10px]">
          <div className="flex flex-1 flex-col gap-[4px]">
            <h2 className="m-0 text-[15px] font-semibold text-ink">{goalTitle}</h2>
            <div className="flex items-center gap-[8px]">
              <span className="inline-flex items-center gap-[4px] rounded-pill bg-ok-tint px-[7px] py-[2px] text-[11.5px] font-medium text-ok">
                {status}
              </span>
              <span className="text-[12px] text-muted">{due}</span>
              <span className="text-[12px] text-muted">·</span>
              <span className="text-[12px] text-muted">{area}</span>
            </div>
          </div>

          {/* Controls (AQW5x: Add agent + navigation) */}
          <div className="flex items-center gap-[6px]">
            <AddAgentPopover>
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
            onClick={() => { setPaused((v) => !v); notify(paused ? 'Goal resumed' : 'Goal paused') }}
            className="inline-flex items-center gap-[5px] rounded-btn px-[8px] py-[4px] text-[12px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-hover"
          >
            <Pause size={12} aria-hidden />
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>

      {/* Edit goal dialog */}
      <EditGoalDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        goalTitle={goalTitle}
        due={due}
        area={area}
      />
    </>
  )
}
