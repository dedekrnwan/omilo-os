/**
 * InboxReviewDialog — "Review one by one" stepped modal (pen PuFIB).
 * Back · Skip · Reject · Approve & next walk through the proposals one at a time.
 */

import { useState } from 'react'
import { ArrowLeft, Calendar, Check, GitBranch, Link, ListChecks, Timer, UserRound, X } from 'lucide-react'
import type { InboxItem } from '../../core/domain/types'
import { Mascot } from '../../ui/ds/Mascot'
import { PROPOSAL_DETAILS } from './data'
import { Btn32, OfficeDialog } from './ui'

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
          <Btn32 variant="quiet" icon={Calendar}>
            Change due date
          </Btn32>
          <Btn32 variant="quiet" icon={UserRound}>
            Assign to someone else
          </Btn32>
        </div>
      </div>
    </OfficeDialog>
  )
}
