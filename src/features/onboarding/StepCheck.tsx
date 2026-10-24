import { ArrowLeft, ArrowRight, Pencil, Plus, AlertTriangle } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { Button } from '../../ui/ds/Button'
import { COMPANY_NAME, CHECK_NOTES } from './data'

interface StepCheckProps {
  onBack: () => void
  onNext: () => void
}

export function StepCheck({ onBack, onNext }: StepCheckProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col gap-[24px] overflow-y-auto px-[40px] py-[32px]">
        {/* Heading */}
        <div className="flex items-center gap-[14px]">
          <Mascot size={44} radius={12} area="brand" />
          <div className="flex flex-col gap-[4px]">
            <h2
              className="m-0 font-display text-[26px] font-semibold leading-tight tracking-[-0.4px] text-ink"
              style={{ fontVariationSettings: '"opsz" 96' }}
            >
              Here&apos;s what I understood about {COMPANY_NAME}
            </h2>
            <p className="m-0 text-[13px] text-muted">
              Fix anything that&apos;s off. Helpers read these 7 notes before every job, and you can
              edit them later in Company.
            </p>
          </div>
        </div>

        {/* Grid of notes */}
        <div className="grid grid-cols-4 gap-[8px]">
          {CHECK_NOTES.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
          {/* Add something I missed */}
          <button
            type="button"
            className="flex flex-col items-center justify-center gap-[6px] rounded-lg p-[16px] text-muted transition-colors hover:bg-soft"
            style={{
              border: '1px dashed var(--color-line-strong)',
              minHeight: 120,
            }}
          >
            <Plus size={18} aria-hidden />
            <span className="text-[12.5px]">Add something I missed</span>
          </button>
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex h-[56px] shrink-0 items-center gap-[12px] px-[40px]"
        style={{ borderTop: '1px solid var(--color-line-strong)' }}
      >
        <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
          Back to our chat
        </Button>
        <span className="flex-1 text-[12px] text-muted">Took 9 minutes · 23 answers</span>
        <Button variant="primary" icon={ArrowRight} onClick={onNext}>
          Looks right, build my team
        </Button>
      </div>
    </div>
  )
}

function NoteCard({ note }: { note: (typeof CHECK_NOTES)[0] }) {
  return (
    <div
      className="flex flex-col gap-[10px] rounded-lg p-[14px]"
      style={{
        border: '1px solid var(--color-line-strong)',
        background: 'var(--color-surface)',
        minHeight: 120,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-ink">{note.label}</span>
        <button
          type="button"
          className="flex size-[22px] shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
        >
          <Pencil size={12} aria-hidden />
        </button>
      </div>

      <p className="m-0 flex-1 text-[12.5px] leading-[1.5] text-ink-2 whitespace-pre-line">
        {note.content}
      </p>

      {note.extra && (
        <p className="m-0 text-[11.5px] leading-[1.4] text-muted">{note.extra}</p>
      )}

      {note.suggested && (
        <div className="flex items-center gap-[5px] text-[11.5px] text-warn">
          <AlertTriangle size={11} aria-hidden />
          <span>I suggested these two. Check them.</span>
        </div>
      )}
    </div>
  )
}
