/** Onboarding 4 · Check (pen M1ZiO). */
import { useState } from 'react'
import { ArrowLeft, ArrowRight, Pencil, Plus, TriangleAlert } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { notify } from '../../ui/ds/Toaster'
import { CHECK_NOTES, KNOWLEDGE_NOTES } from './data'
import type { CheckNote } from './data'
import { IconTile, PrimaryButton, QuietButton, Stroke, WizardCard } from './parts'
import { useSession } from '../../app/session'

function NoteCard({ note }: { note: CheckNote }) {
  const meta = KNOWLEDGE_NOTES.find((k) => k.id === note.id)!
  return (
    <article className="relative flex min-w-0 flex-1 flex-col gap-[8px] self-start rounded-md bg-surface p-[14px]">
      <div className="flex w-full items-center gap-[8px]">
        <IconTile icon={meta.icon} />
        <h3 className="text-[14px] font-semibold text-ink">{meta.label}</h3>
        <span className="h-px flex-1" />
        <button type="button" aria-label={`Edit ${meta.label}`} className="text-muted hover:text-ink" onClick={() => notify(`Editing ${meta.label}`)}>
          <Pencil size={14} aria-hidden />
        </button>
      </div>
      <p className="w-full text-[13px] leading-[1.5] whitespace-pre-line text-ink-2">{note.content}</p>
      {note.kpi && (
        <div className="flex w-full gap-[8px] pt-[2px]">
          <span aria-hidden className="mt-[4px] size-[7px] shrink-0 rounded-full bg-helper-brand" />
          <span className="min-w-0 flex-1 text-[12px] text-muted">{note.kpi}</span>
        </div>
      )}
      {note.suggested && (
        <div className="flex items-center gap-[6px]">
          <TriangleAlert size={12} aria-hidden className="text-warn" />
          <span className="text-[11px] font-medium text-warn">{note.suggested}</span>
        </div>
      )}
      <Stroke />
    </article>
  )
}

export function StepCheck({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const [, setAdded] = useState(0)
  const rows = [CHECK_NOTES.slice(0, 4), CHECK_NOTES.slice(4)]
  return (
    <WizardCard className="flex-col gap-[18px] px-[40px] py-[32px]">
      <div className="flex w-full items-center gap-[14px]">
        <Mascot helper area="brand" size={44} radius={12} title="Chief of Staff" />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.4px] text-ink">
            Here's what I understood about {companyName}
          </h1>
          <p className="text-[14px] text-muted">
            Fix anything that's off. Helpers read these 7 notes before every job, and you can edit them later in
            Company.
          </p>
        </div>
      </div>
      <div className="flex w-full flex-col gap-[12px]">
        {rows.map((row, i) => (
          <div key={i} className="flex w-full gap-[12px]">
            {row.map((n) => (
              <NoteCard key={n.id} note={n} />
            ))}
            {i === 1 && (
              <button
                type="button"
                onClick={() => { setAdded((n) => n + 1); notify('Add a topic — coming soon') }}
                className="relative flex h-[128px] min-w-0 flex-1 flex-col items-center justify-center gap-[6px] rounded-md p-[14px] text-muted hover:bg-soft"
              >
                <Plus size={18} aria-hidden />
                <span className="text-[13px]">Add something I missed</span>
                <Stroke color="var(--color-wire-strong)" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="w-full flex-1" />
      <div className="flex w-full items-center gap-[10px]">
        <QuietButton icon={ArrowLeft} onClick={onBack}>
          Back to our chat
        </QuietButton>
        <span className="h-px flex-1" />
        <span className="text-[12px] text-muted">Took 9 minutes · 23 answers</span>
        <PrimaryButton icon={ArrowRight} onClick={onNext}>
          Looks right, build my team
        </PrimaryButton>
      </div>
    </WizardCard>
  )
}
