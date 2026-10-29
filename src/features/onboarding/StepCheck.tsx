/** Onboarding 4 · Check (pen M1ZiO). */
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Pencil, Plus, TriangleAlert } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { KNOWLEDGE_NOTES } from './data'
import { getInterview, saveNote, TOPIC_IDS } from './interviewApi'
import type { InterviewView, TopicId } from './interviewApi'
import { notify } from '../../ui/ds/Toaster'
import { IconTile, PrimaryButton, QuietButton, Stroke, WizardCard } from './parts'
import { useSession } from '../../app/session'

function NoteCard({
  id,
  content,
  onSave,
}: {
  id: TopicId | 'extra'
  content: string
  onSave: (content: string) => Promise<void>
}) {
  const meta = KNOWLEDGE_NOTES.find((k) => k.id === id)
  const label = meta?.label ?? 'Something I missed'
  const [editing, setEditing] = useState(content.trim() === '')
  const [draft, setDraft] = useState(content)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(content)
  }, [content, editing])
  const toggle = async () => {
    if (!editing) {
      setEditing(true)
      return
    }
    if (draft.trim() !== content.trim()) {
      setSaving(true)
      try {
        await onSave(draft)
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Couldn’t save the note')
        setSaving(false)
        return
      }
      setSaving(false)
    }
    setEditing(draft.trim() === '')
  }
  return (
    <article className="relative flex min-w-0 flex-1 flex-col gap-[8px] self-start rounded-md bg-surface p-[14px]">
      <div className="flex w-full items-center gap-[8px]">
        {meta && <IconTile icon={meta.icon} />}
        <h3 className="text-[14px] font-semibold text-ink">{label}</h3>
        <span className="h-px flex-1" />
        <button
          type="button"
          aria-label={editing ? `Save ${label}` : `Edit ${label}`}
          className="text-muted hover:text-ink disabled:opacity-50"
          disabled={saving}
          onClick={() => void toggle()}
        >
          {editing ? <Check size={14} aria-hidden /> : <Pencil size={14} aria-hidden />}
        </button>
      </div>
      {editing ? (
        <textarea
          aria-label={`${label} note`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft.trim() !== content.trim()) void toggle()
          }}
          placeholder={meta ? `Add a note about ${meta.meta}…` : 'Add a note…'}
          className="min-h-[72px] w-full resize-none rounded-base bg-surface px-[10px] py-[8px] text-[13px] leading-[1.5] text-ink outline-1 -outline-offset-1 outline-line-strong"
        />
      ) : (
        <p className="w-full text-[13px] leading-[1.5] whitespace-pre-line text-ink-2">{content}</p>
      )}
      {!content.trim() && !editing && (
        <div className="flex items-center gap-[6px]">
          <TriangleAlert size={12} aria-hidden className="text-warn" />
          <span className="text-[11px] font-medium text-warn">We didn't get to this yet</span>
        </div>
      )}
      <Stroke />
    </article>
  )
}

export function StepCheck({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const [view, setView] = useState<InterviewView | null>(null)
  const [showExtra, setShowExtra] = useState(false)
  useEffect(() => {
    getInterview()
      .then((v) => {
        setView(v)
        if (v.notes.extra?.trim()) setShowExtra(true)
      })
      .catch((e) => notify(e instanceof Error ? e.message : 'Couldn’t load the notes'))
  }, [])
  const save = (id: TopicId | 'extra') => async (content: string) => {
    setView(await saveNote(id, content))
  }
  const ids: (TopicId | 'extra')[] = [...TOPIC_IDS, ...(showExtra ? (['extra'] as const) : [])]
  const rows = [ids.slice(0, 4), ids.slice(4)]
  const answers = view?.history.filter((h) => h.role === 'owner').length ?? 0
  const filled = view ? TOPIC_IDS.filter((t) => view.notes[t]?.trim()).length : 0
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
      {view === null ? (
        <p className="text-[13px] text-muted">Loading your notes…</p>
      ) : (
        <div className="flex w-full flex-col gap-[12px]">
          {rows.map((row, i) => (
            <div key={i} className="flex w-full flex-col gap-[12px] sm:flex-row">
              {row.map((id) => (
                <NoteCard key={id} id={id} content={view.notes[id] ?? ''} onSave={save(id)} />
              ))}
              {i === 1 && !showExtra && (
                <button
                  type="button"
                  onClick={() => setShowExtra(true)}
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
      )}
      <div className="w-full flex-1" />
      <div className="flex w-full items-center gap-[10px]">
        <QuietButton icon={ArrowLeft} onClick={onBack}>
          Back to our chat
        </QuietButton>
        <span className="h-px flex-1" />
        <span className="text-[12px] text-muted">
          {filled} of 7 notes · {answers} {answers === 1 ? 'answer' : 'answers'}
        </span>
        <PrimaryButton icon={ArrowRight} onClick={onNext}>
          Looks right, build my team
        </PrimaryButton>
      </div>
    </WizardCard>
  )
}
