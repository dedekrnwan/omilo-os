/**
 * InboxReviewDialog — "Review one by one" stepped modal.
 * Matches design ref PuFIB.png.
 *
 * Each call presents one proposal at a time. The user can:
 *   Back → go to previous step
 *   Skip → skip this proposal
 *   Reject → reject this proposal
 *   Approve & next → approve and advance (or finish)
 *
 * Visual-only; no network calls. Parent controls `open` + `onClose`.
 */

import { useState, useEffect, useRef } from 'react'
import { X, Calendar, UserPlus, Check } from 'lucide-react'
import type { InboxItem, InboxProposal } from '../../core/domain/types'
import { Button } from '../../ui/ds/Button'
import { Mascot } from '../../ui/ds/Mascot'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReviewResult {
  proposalIndex: number
  decision: 'approved' | 'rejected' | 'skipped'
}

export interface InboxReviewDialogProps {
  open: boolean
  item: InboxItem
  /** Called when the user finishes reviewing all proposals (or closes). */
  onClose: (results: ReviewResult[]) => void
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center gap-[4px]">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-[4px] rounded-pill transition-all ${
            i < current
              ? 'w-[8px] bg-ok'
              : i === current
                ? 'w-[20px] bg-ink'
                : 'w-[8px] bg-line-strong'
          }`}
        />
      ))}
    </div>
  )
}

function ProposalDetail({ proposal }: { proposal: InboxProposal }) {
  return (
    <div className="flex flex-col gap-[10px]">
      {/* Proposal identity */}
      <div className="flex items-center gap-[8px]">
        <Mascot size={20} radius={6} area={proposal.area} />
        <span className="text-[13px] font-medium text-ink">{proposal.who}</span>
        <span className="text-[12.5px] text-muted">·</span>
        <span className="text-[12.5px] text-muted capitalize">{proposal.area}</span>
        <span className="ml-auto text-[12px] text-muted">{proposal.due}</span>
      </div>

      {/* Task name */}
      <h4 className="m-0 text-[15px] font-semibold text-ink leading-snug">{proposal.text}</h4>

      {/* Brief details (static visual-only) */}
      <p className="m-0 text-[13px] leading-[1.55] text-ink-2">
        Keep password + OTP for {proposal.area} &middot; ~&thinsp;80% of users. Show a one-time banner
        explaining why, and log who stays on passwords so we can nudge them later.
      </p>

      {/* Attribute list */}
      <ul className="m-0 flex list-none flex-col gap-[5px] p-0 text-[12.5px] text-ink-2">
        <li className="flex items-center gap-[6px]">
          <span className="text-ok">✓</span>
          New branch: {proposal.area}/{proposal.text.toLowerCase().replace(/\s+/g, '-').slice(0, 28)}
        </li>
        <li className="flex items-center gap-[6px]">
          <span className="text-warn">○</span>
          ~3 days of Dev time · Rp 80–1k AI spend
        </li>
        <li className="flex items-center gap-[6px]">
          <span className="text-muted">□</span>
          Blocks: 10% → 100% rollout
        </li>
      </ul>

      {/* Secondary actions */}
      <div className="flex items-center gap-[16px] pt-[2px]">
        <button
          type="button"
          className="flex items-center gap-[5px] text-[12.5px] text-muted hover:text-ink transition-colors"
        >
          <Calendar size={13} aria-hidden />
          Change due date
        </button>
        <button
          type="button"
          className="flex items-center gap-[5px] text-[12.5px] text-muted hover:text-ink transition-colors"
        >
          <UserPlus size={13} aria-hidden />
          Assign to someone else
        </button>
      </div>
    </div>
  )
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export function InboxReviewDialog({ open, item, onClose }: InboxReviewDialogProps) {
  const proposals = item.proposals ?? []
  const [step, setStep] = useState(0)
  const [results, setResults] = useState<ReviewResult[]>([])

  // Reset when re-opened — guard so we only reset on false→true transition
  const prevOpen = useRef(open)
  useEffect(() => {
    if (open && !prevOpen.current) {
      setStep(0)
      setResults([])
    }
    prevOpen.current = open
  }, [open])

  if (!open || proposals.length === 0) return null

  const current = proposals[step]
  const isLast = step === proposals.length - 1

  function record(decision: ReviewResult['decision']) {
    const next = [...results, { proposalIndex: step, decision }]
    setResults(next)
    if (isLast) {
      onClose(next)
    } else {
      setStep((s) => s + 1)
    }
  }

  function back() {
    if (step > 0) setStep((s) => s - 1)
  }

  function handleClose() {
    onClose(results)
  }

  return (
    /* Backdrop */
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Review ${item.title}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0A0940] backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      {/* Panel */}
      <div className="relative flex w-[480px] flex-col gap-[20px] rounded-dialog bg-surface p-[24px] shadow-[0_20px_60px_#0C0A0933]">
        {/* Header */}
        <div className="flex items-start gap-[10px]">
          <div className="flex flex-1 flex-col gap-[2px]">
            <p className="m-0 text-[12px] text-muted">
              Task {step + 1} of {proposals.length} · from &ldquo;{item.title}&rdquo;
            </p>
            <h3 className="m-0 text-[16px] font-semibold text-ink">Review {item.asker}&rsquo;s {proposals.length} tasks</h3>
          </div>
          <ProgressDots total={proposals.length} current={step} />
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close review"
            className="inline-flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Divider */}
        <div className="h-px w-full bg-line-strong" />

        {/* Proposal body */}
        <ProposalDetail proposal={current} />

        {/* Divider */}
        <div className="h-px w-full bg-line-strong" />

        {/* Footer actions */}
        <div className="flex items-center gap-[8px]">
          <Button
            variant="secondary"
            height={30}
            onClick={back}
            disabled={step === 0}
            className="disabled:opacity-40"
          >
            ← Back
          </Button>
          <span className="flex-1" />
          <Button variant="secondary" height={30} onClick={() => record('skipped')}>
            Skip
          </Button>
          <Button
            variant="secondary"
            height={30}
            className="text-bad! outline-bad/30!"
            onClick={() => record('rejected')}
          >
            ✕ Reject
          </Button>
          <Button variant="primary" height={30} icon={Check} onClick={() => record('approved')}>
            {isLast ? 'Approve & finish' : 'Approve & next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
