/** Onboarding 4 · Check (pen M1ZiO). */
import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Pencil, Plus, TriangleAlert } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { CHECK_NOTES, KNOWLEDGE_NOTES } from './data'
import type { CheckNote } from './data'
import { IconTile, PrimaryButton, QuietButton, Stroke, WizardCard } from './parts'
import { useSession } from '../../app/session'

function NoteCard({
  note,
  content,
  onChange,
}: {
  note: CheckNote
  content: string
  onChange: (content: string) => void
}) {
  const meta = KNOWLEDGE_NOTES.find((k) => k.id === note.id)
  const label = meta?.label ?? note.id
  const [editing, setEditing] = useState(content.trim() === '')
  return (
    <article className="relative flex min-w-0 flex-1 flex-col gap-[8px] self-start rounded-md bg-surface p-[14px]">
      <div className="flex w-full items-center gap-[8px]">
        {meta && <IconTile icon={meta.icon} />}
        <h3 className="text-[14px] font-semibold text-ink">{label}</h3>
        <span className="h-px flex-1" />
        <button
          type="button"
          aria-label={editing ? `Save ${label}` : `Edit ${label}`}
          className="text-muted hover:text-ink"
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? <Check size={14} aria-hidden /> : <Pencil size={14} aria-hidden />}
        </button>
      </div>
      {editing ? (
        <textarea
          aria-label={`${label} note`}
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Add a note…"
          className="min-h-[72px] w-full resize-none rounded-base bg-surface px-[10px] py-[8px] text-[13px] leading-[1.5] text-ink outline-1 -outline-offset-1 outline-line-strong"
        />
      ) : (
        <p className="w-full text-[13px] leading-[1.5] whitespace-pre-line text-ink-2">{content}</p>
      )}
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
  // Editable copy of each note's content, keyed by id, plus any added notes.
  const [notes, setNotes] = useState<CheckNote[]>(CHECK_NOTES)
  const [contents, setContents] = useState<Record<string, string>>(() =>
    Object.fromEntries(CHECK_NOTES.map((n) => [n.id, n.content])),
  )
  const setContent = (id: string, content: string) =>
    setContents((prev) => ({ ...prev, [id]: content }))
  const addNote = () => {
    const id = `custom-${notes.length}`
    setNotes((prev) => [...prev, { id, content: '' }])
    setContent(id, '')
  }
  const rows = [notes.slice(0, 4), notes.slice(4)]
  return (
    <WizardCard className="flex-col gap-[18px] px-[20px] py-[24px] sm:px-[40px] sm:py-[32px] lg:overflow-y-auto">
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
              <NoteCard
                key={n.id}
                note={n}
                content={contents[n.id] ?? n.content}
                onChange={(c) => setContent(n.id, c)}
              />
            ))}
            {i === 1 && (
              <button
                type="button"
                onClick={addNote}
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
