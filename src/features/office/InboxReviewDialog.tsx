/**
 * InboxReviewDialog — "Review one by one" stepped modal (pen PuFIB).
 * Back · Skip · Reject · Approve & next walk through the proposals one at a time.
 */

import { useRef, useState } from 'react'
import { ArrowLeft, Calendar, Check, GitBranch, Link, ListChecks, Timer, UserRound, X } from 'lucide-react'
import type { InboxItem } from '../../core/domain/types'
import { Mascot } from '../../ui/ds/Mascot'
import { notify } from '../../ui/ds/Toaster'
import { PROPOSAL_DETAILS } from './data'
import { Btn32, OfficeDialog } from './ui'

// ── Mock helpers ───────────────────────────────────────────────────────────────

const MOCK_MEMBERS = ['Dede', 'Ari', 'Budi', 'Sari', 'Chief']

/** Tiny inline date-picker popover anchored to the "Change due date" button. */
function DueDatePopover({
  anchor,
  current,
  onConfirm,
  onClose,
}: {
  anchor: DOMRect | null
  current: string
  onConfirm: (d: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(current)
  if (!anchor) return null
  return (
    <>
      {/* backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        className="fixed z-50 w-[220px] rounded-lg bg-surface p-[12px] shadow-[0_12px_32px_#0C0A0924] outline-1 -outline-offset-1 outline-line-strong"
        style={{ top: anchor.bottom + 6, left: anchor.left }}
      >
        <p className="m-0 mb-[8px] text-[12px] font-medium text-ink">Change due date</p>
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-base bg-soft px-[8px] py-[6px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong"
        />
        <div className="mt-[8px] flex justify-end gap-[6px]">
          <button type="button" onClick={onClose} className="h-[26px] rounded-btn px-[10px] text-[12px] text-muted hover:text-ink">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(value); onClose() }}
            className="h-[26px] rounded-btn bg-primary px-[10px] text-[12px] font-medium text-primary-ink hover:bg-primary-hover"
          >
            Save
          </button>
        </div>
      </div>
    </>
  )
}

/** Tiny inline assignee-picker popover. */
function AssigneePopover({
  anchor,
  onSelect,
  onClose,
}: {
  anchor: DOMRect | null
  onSelect: (name: string) => void
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
        <p className="px-[10px] py-[4px] text-[10.5px] font-medium tracking-[0.6px] text-faint uppercase">Assign to</p>
        {MOCK_MEMBERS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => { onSelect(name); onClose() }}
            className="flex w-full items-center gap-[8px] px-[10px] py-[6px] text-[13px] text-ink-2 hover:bg-hover"
          >
            {name}
          </button>
        ))}
      </div>
    </>
  )
}

export interface ReviewResult {
  proposalIndex: number
  decision: 'approved' | 'rejected' | 'skipped'
}

export interface InboxReviewDialogProps {
  open: boolean
  item: InboxItem
  /** Start on this proposal (0-based). */
  initialStep?: number
  /** Called when the user finishes reviewing all proposals (or closes). */
  onClose: (results: ReviewResult[]) => void
}

const DETAIL_ICON = { 'git-branch': GitBranch, timer: Timer, link: Link }

/** "Passkey rollout plan" from the item summary’s “…” quote, if any. */
function sourceOf(item: InboxItem) {
  const m = /“([^”]+)”/.exec(item.summary)
  return m ? m[1] : item.title
}

export function InboxReviewDialog({ open, item, initialStep = 0, onClose }: InboxReviewDialogProps) {
  const proposals = item.proposals ?? []
  const [step, setStep] = useState(initialStep)
  const [results, setResults] = useState<ReviewResult[]>(() =>
    Array.from({ length: initialStep }, (_, i) => ({ proposalIndex: i, decision: 'approved' as const })),
  )
  // date-picker popover
  const [dateAnchor, setDateAnchor] = useState<DOMRect | null>(null)
  const [dueDate, setDueDate] = useState('')
  const calendarWrapRef = useRef<HTMLSpanElement>(null)
  // assignee popover
  const [assigneeAnchor, setAssigneeAnchor] = useState<DOMRect | null>(null)
  const assigneeWrapRef = useRef<HTMLSpanElement>(null)

  if (proposals.length === 0) return null
  const current = proposals[step]
  const detail = PROPOSAL_DETAILS[current.text]
  const isLast = step === proposals.length - 1

  function record(decision: ReviewResult['decision']) {
    const next = [...results.filter((r) => r.proposalIndex !== step), { proposalIndex: step, decision }]
    setResults(next)
    if (isLast) onClose(next)
    else setStep((s) => s + 1)
  }

  return (
    <OfficeDialog
      open={open}
      onOpenChange={(o) => !o && onClose(results)}
      width={600}
      icon={ListChecks}
      title={`Review ${item.asker}'s ${proposals.length} tasks`}
      sub={`Task ${step + 1} of ${proposals.length} · from “${sourceOf(item)}”`}
      footer={
        <>
          <Btn32 variant="secondary" icon={ArrowLeft} disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            Back
          </Btn32>
          <span className="h-px flex-1" />
          <Btn32 variant="quiet" onClick={() => record('skipped')}>
            Skip
          </Btn32>
          <Btn32 variant="danger" icon={X} onClick={() => record('rejected')}>
            Reject
          </Btn32>
          <Btn32 variant="primary" icon={Check} onClick={() => record('approved')}>
            {isLast ? 'Approve & finish' : 'Approve & next'}
          </Btn32>
        </>
      }
    >
      <div className="flex w-full gap-[6px]" aria-label={`Step ${step + 1} of ${proposals.length}`}>
        {proposals.map((p, i) => (
          <span
            key={p.text}
            className={`h-[4px] flex-1 rounded-pill ${i < step ? 'bg-ok' : i === step ? 'bg-ink' : 'bg-line'}`}
          />
        ))}
      </div>

      <div className="flex w-full flex-col gap-[12px] rounded-lg p-[16px] outline-1 -outline-offset-1 outline-line-strong">
        <div className="flex w-full items-center gap-[10px]">
          <Mascot size={28} radius={7} area={current.area} helper />
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            <h3 className="m-0 text-[15px] font-semibold text-ink">{current.text}</h3>
            <span className="text-[12.5px] text-muted">
              {current.who}
              {detail ? ` · ${detail.areaName}` : ''} · due {current.due}
            </span>
          </div>
        </div>
        {detail && (
          <>
            <p className="m-0 text-[13.5px] leading-[1.55] text-ink-2">{detail.desc}</p>
            <ul className="m-0 flex list-none flex-col gap-[6px] rounded-base bg-soft px-[12px] py-[10px]">
              {detail.details.map((d) => {
                const Icon = DETAIL_ICON[d.icon]
                return (
                  <li key={d.text} className="flex items-center gap-[8px]">
                    <Icon size={13} aria-hidden className="text-muted" />
                    <span className="text-[12.5px] text-ink-2">{d.text}</span>
                  </li>
                )
              })}
            </ul>
          </>
        )}
        <div className="flex w-full gap-[8px]">
          <span ref={calendarWrapRef}>
            <Btn32
              variant="quiet"
              icon={Calendar}
              onClick={() => {
                const rect = calendarWrapRef.current?.getBoundingClientRect() ?? null
                setDateAnchor(rect)
              }}
            >
              Change due date
            </Btn32>
          </span>
          <span ref={assigneeWrapRef}>
            <Btn32
              variant="quiet"
              icon={UserRound}
              onClick={() => {
                const rect = assigneeWrapRef.current?.getBoundingClientRect() ?? null
                setAssigneeAnchor(rect)
              }}
            >
              Assign to someone else
            </Btn32>
          </span>
        </div>
      </div>

      {/* Popovers */}
      <DueDatePopover
        anchor={dateAnchor}
        current={dueDate || current.due}
        onConfirm={(d) => {
          setDueDate(d)
          notify('Due date updated')
        }}
        onClose={() => setDateAnchor(null)}
      />
      <AssigneePopover
        anchor={assigneeAnchor}
        onSelect={(name) => notify(`Assigned to ${name}`)}
        onClose={() => setAssigneeAnchor(null)}
      />
    </OfficeDialog>
  )
}
