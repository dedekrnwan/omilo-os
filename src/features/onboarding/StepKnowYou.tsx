/** Onboarding 3 · Get to know you (pen sG2L3). */
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CircleCheck, Globe, Paperclip, Pause, Pencil, SkipForward, Sparkles } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { IconButton } from '../../ui/ds/Button'
import { Composer } from '../../ui/ChatSession/Composer'
import { DEFAULT_MODEL } from '../../ui/ChatSession/ModelMenu'
import { INTERVIEW, KNOWLEDGE_NOTES, LEARNED } from './data'
import { Pill, QuietButton, Stroke } from './parts'
import { useSession } from '../../app/session'
import { useUpdateCompanySettings } from '../../app/queries'
import { isMockMode } from '../../app/useAuth'
import { notify } from '../../ui/ds/Toaster'

function ChiefSays({ text, ideas, children }: { text: string; ideas: string[]; children?: React.ReactNode }) {
  return (
    <div className="flex w-full gap-[10px]">
      <Mascot helper area="brand" size={24} radius={7} title="Chief of Staff" />
      <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
        <p className="w-full text-[16px] leading-[1.55] text-ink">{text}</p>
        <div className="flex w-full flex-wrap gap-[8px]">
          {ideas.map((i) => (
            <Pill key={i} icon={Sparkles}>
              {i}
            </Pill>
          ))}
        </div>
        {children}
      </div>
    </div>
  )
}

function LearnedPanel({
  website,
  onWebsiteChange,
}: {
  website: string
  onWebsiteChange: (v: string) => void
}) {
  const done = LEARNED.filter((n) => n.state === 'done').length
  return (
    <aside
      aria-label="What I've learned"
      className="relative flex w-full shrink-0 flex-col overflow-hidden rounded-lg bg-surface lg:h-full lg:w-[400px]"
    >
      <div className="flex w-full items-center gap-[8px] px-[18px] py-[14px]" style={{ boxShadow: 'inset 0 -1px 0 var(--color-line)' }}>
        <h2 className="text-[14px] font-semibold text-ink">What I've learned</h2>
        <span className="h-px flex-1" />
        <span className="text-[12px] text-muted">{done} of 7 done</span>
      </div>
      <ul className="flex min-h-0 w-full flex-1 flex-col gap-[6px] px-[12px] py-[10px]">
        {LEARNED.map((n) => {
          const note = KNOWLEDGE_NOTES.find((k) => k.id === n.id)!
          const Icon = note.icon
          const active = n.state === 'done' || n.state === 'writing'
          return (
            <li
              key={n.id}
              className="relative flex w-full flex-col gap-[4px] rounded-md px-[12px] py-[10px]"
              style={n.state === 'writing' ? { background: '#6366F10D' } : undefined}
            >
              <div className="flex w-full items-center gap-[8px]">
                <Icon size={14} aria-hidden className={active ? 'text-ink-2' : 'text-faint'} />
                <span className={`text-[13px] font-semibold ${active ? 'text-ink' : 'text-muted'}`}>{note.label}</span>
                <span className="h-px flex-1" />
                {n.state === 'done' && (
                  <>
                    <CircleCheck size={14} aria-label="done" className="text-ok" />
                    <Pencil size={13} aria-label="edit" className="text-muted" />
                  </>
                )}
                {n.state === 'writing' && <span className="text-[11px] font-medium text-helper-brand">writing…</span>}
              </div>
              {n.text && (
                <p className={`w-full text-[12px] leading-[1.45] ${n.state === 'next' ? 'text-muted' : 'text-ink-2'}`}>
                  {n.text}
                </p>
              )}
              {n.state === 'done' && <Stroke color="var(--color-line)" />}
              {n.state === 'writing' && <Stroke color="#6366F14D" />}
            </li>
          )
        })}
      </ul>
      <div className="flex w-full flex-col gap-[8px] bg-soft px-[16px] py-[12px]" style={{ boxShadow: 'inset 0 1px 0 var(--color-line)' }}>
        <p className="w-full text-[12px] text-ink-2">Skip questions: let me read your website or a doc first.</p>
        <div className="flex w-full items-center gap-[6px]">
          <label className="flex h-[32px] min-w-0 flex-1 items-center gap-[6px] rounded-btn bg-surface px-[10px] outline-1 -outline-offset-1 outline-line-strong">
            <Globe size={13} aria-hidden className="shrink-0 text-muted" />
            <input
              aria-label="Website"
              placeholder="yourcompany.com"
              value={website}
              onChange={(e) => onWebsiteChange(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
            />
          </label>
          <IconButton icon={Paperclip} aria-label="Upload a doc" />
        </div>
      </div>
      <Stroke />
    </aside>
  )
}

export function StepKnowYou({ onNext }: { onNext: () => void }) {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const [answers, setAnswers] = useState<string[]>([])
  const [website, setWebsite] = useState('')
  const updateSettings = useUpdateCompanySettings()
  const navigate = useNavigate()

  // Append the answer to the thread and persist the running set into the
  // company's "about" knowledge note. Nothing is pre-filled — a fresh workspace
  // starts empty and fills only from what the owner actually types.
  const handleSend = (text: string) => {
    const answer = text.trim()
    if (!answer) return
    const next = [...answers, answer]
    setAnswers(next)
    if (!isMockMode()) {
      updateSettings.mutate({
        about: next.join('\n\n'),
        ...(website.trim() ? { website: website.trim() } : {}),
      })
    }
    notify('Saved to your company knowledge')
  }
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-[16px] overflow-y-auto px-[16px] pt-[8px] pb-[16px] sm:px-[24px] sm:pb-[24px] lg:flex-row lg:overflow-hidden">
      <section aria-label="Interview" className="relative flex min-h-[460px] min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface lg:h-full lg:min-h-0">
        <div className="flex w-full items-center gap-[12px] px-[24px] py-[14px]" style={{ boxShadow: 'inset 0 -1px 0 var(--color-line)' }}>
          <h2 className="text-[14px] font-semibold text-ink">Getting to know you</h2>
          <span
            role="progressbar"
            aria-valuenow={answers.length}
            aria-valuemin={0}
            aria-valuemax={7}
            className="relative hidden h-[6px] w-[160px] overflow-hidden rounded-[3px] bg-soft sm:block"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-[3px] bg-helper-brand transition-[width]"
              style={{ width: `${Math.min(answers.length / 7, 1) * 100}%` }}
            />
            <Stroke color="var(--color-line)" />
          </span>
          <span className="text-[12px] text-muted">{answers.length} of 7</span>
          <span className="h-px flex-1" />
          <QuietButton icon={SkipForward} onClick={onNext}>
            Skip this topic
          </QuietButton>
          <QuietButton icon={Pause} onClick={() => void navigate({ to: '/inbox' })}>Finish later</QuietButton>
        </div>

        <div className="flex min-h-0 w-full flex-1 flex-col justify-end gap-[16px] px-[20px] py-[16px] sm:px-[48px] sm:py-[20px]">
          <ChiefSays text={INTERVIEW.q1.replace('{company}', companyName)} ideas={INTERVIEW.ideas1}>
            <p className="text-[12px] text-muted">{INTERVIEW.hint1}</p>
          </ChiefSays>
          {answers.map((a, i) => (
            <div key={i} className="flex w-full justify-end">
              <div className="relative max-w-[460px] rounded-[14px_14px_4px_14px] bg-soft px-[14px] py-[10px]">
                <p className="w-full text-[14px] leading-[1.55] text-ink">{a}</p>
                <Stroke color="var(--color-line)" />
              </div>
            </div>
          ))}
        </div>

        <div className="w-full px-[20px] pb-[16px] sm:px-[48px] sm:pb-[20px]">
          {/* Reuse the real chat Composer (compact) instead of a bespoke input. */}
          <Composer
            sessionId="onboarding-interview"
            selectedModel={DEFAULT_MODEL}
            onModelChange={() => {}}
            onSend={handleSend}
            compact
            hideModelControls
            placeholder="Type your answer…"
          />
        </div>
        <Stroke />
      </section>
      <LearnedPanel website={website} onWebsiteChange={setWebsite} />
    </div>
  )
}
