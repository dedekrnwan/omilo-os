/** Onboarding 3 · Get to know you (pen sG2L3).
 *
 * A real interview with Chief, streamed over SSE (POST /v1/onboarding/interview/stream)
 * on the AI connected in "Your AI". Chief asks one thing at a time, reads a website
 * you give it, and writes what it learns into the seven notes on the right
 * ("What I've learned"), which the next step lets you check.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, CircleCheck, FileText, Globe, Loader2, Paperclip, Pause, Pencil, SkipForward, Sparkles } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { IconButton } from '../../ui/ds/Button'
import { Composer } from '../../ui/ChatSession/Composer'
import { DEFAULT_MODEL } from '../../ui/ChatSession/ModelMenu'
import { KNOWLEDGE_NOTES } from './data'
import { Pill, QuietButton, Stroke } from './parts'
import { getAiStatus, getInterview, interviewTurn, readFileBase64, TOPIC_IDS } from './interviewApi'
import type { AiStatus, AttachmentMeta, FilePayload, InterviewEntry, InterviewView, TopicId } from './interviewApi'

function ChiefSays({ text, ideas, onIdea, children }: {
  text: string
  ideas?: string[]
  onIdea?: (idea: string) => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex w-full gap-[10px]">
      <Mascot helper area="brand" size={24} radius={7} title="Chief of Staff" />
      <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
        <p className="w-full text-[16px] leading-[1.55] whitespace-pre-wrap text-ink">{text}</p>
        {ideas && ideas.length > 0 && (
          <div className="flex w-full flex-wrap gap-[8px]">
            {ideas.map((i) => (
              <Pill key={i} icon={Sparkles} onClick={onIdea ? () => onIdea(i) : undefined}>
                {i}
              </Pill>
            ))}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentChip({ name, size }: { name: string; size?: number }) {
  return (
    <div className="flex items-center gap-[6px] rounded-[8px] bg-surface px-[10px] py-[6px]">
      <FileText size={14} aria-hidden className="shrink-0 text-ink-2" />
      <span className="min-w-0 truncate text-[13px] font-medium text-ink">{name}</span>
      {size !== undefined && (
        <span className="shrink-0 text-[11px] text-muted">{humanSize(size)}</span>
      )}
    </div>
  )
}

const INJECTED_BLOCK_RE = /\n?<(file|website)>[\s\S]*?<\/\1>/g

export function OwnerSays({ text, attachment }: { text: string; attachment?: AttachmentMeta }) {
  return (
    <div className="flex w-full justify-end">
      <div className="relative max-w-[460px] rounded-[14px_14px_4px_14px] bg-soft px-[14px] py-[10px]">
        {attachment ? (
          <AttachmentChip name={attachment.name} size={attachment.size} />
        ) : (
          <p className="w-full text-[14px] leading-[1.55] whitespace-pre-wrap text-ink">
            {text.replace(INJECTED_BLOCK_RE, '')}
          </p>
        )}
        <Stroke color="var(--color-line)" />
      </div>
    </div>
  )
}

type NoteState = 'done' | 'writing' | 'next' | 'todo'

function LearnedPanel({
  view,
  writing,
  website,
  onWebsiteChange,
  onReadWebsite,
  onFile,
  busy,
}: {
  view: InterviewView | null
  writing: TopicId | null
  website: string
  onWebsiteChange: (v: string) => void
  onReadWebsite: () => void
  onFile: (file: File) => void
  busy: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const notes = view?.notes ?? {}
  const done = TOPIC_IDS.filter((t) => notes[t]?.trim()).length
  const current = view?.topic && view.topic !== 'finish' ? view.topic : null
  const stateOf = (id: TopicId): NoteState =>
    writing === id ? 'writing' : notes[id]?.trim() ? 'done' : current === id ? 'next' : 'todo'
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
      <ul className="flex min-h-0 w-full flex-1 flex-col gap-[6px] overflow-y-auto px-[12px] py-[10px]">
        {KNOWLEDGE_NOTES.map((note) => {
          const id = note.id as TopicId
          const st = stateOf(id)
          const Icon = note.icon
          const active = st === 'done' || st === 'writing'
          const text = notes[id]?.trim() || (st === 'next' ? `Up next: ${note.meta}` : '')
          return (
            <li
              key={id}
              className="relative flex w-full flex-col gap-[4px] rounded-md px-[12px] py-[10px]"
              style={st === 'writing' ? { background: '#6366F10D' } : undefined}
            >
              <div className="flex w-full items-center gap-[8px]">
                <Icon size={14} aria-hidden className={active ? 'text-ink-2' : 'text-faint'} />
                <span className={`text-[13px] font-semibold ${active ? 'text-ink' : 'text-muted'}`}>{note.label}</span>
                <span className="h-px flex-1" />
                {st === 'done' && (
                  <>
                    <CircleCheck size={14} aria-label="done" className="text-ok" />
                    <Pencil size={13} aria-label="edit in the next step" className="text-muted" />
                  </>
                )}
                {st === 'writing' && <span className="text-[11px] font-medium text-helper-brand">writing…</span>}
              </div>
              {text && (
                <p className={`line-clamp-3 w-full text-[12px] leading-[1.45] whitespace-pre-line ${st === 'next' ? 'text-muted' : 'text-ink-2'}`}>
                  {text}
                </p>
              )}
              {st === 'done' && <Stroke color="var(--color-line)" />}
              {st === 'writing' && <Stroke color="#6366F14D" />}
            </li>
          )
        })}
      </ul>
      <div className="flex w-full flex-col gap-[8px] bg-soft px-[16px] py-[12px]" style={{ boxShadow: 'inset 0 1px 0 var(--color-line)' }}>
        <p className="w-full text-[12px] text-ink-2">Skip questions: let me read your website or a doc first.</p>
        <form
          className="flex w-full items-center gap-[6px]"
          onSubmit={(e) => {
            e.preventDefault()
            onReadWebsite()
          }}
        >
          <label className="flex h-[32px] min-w-0 flex-1 items-center gap-[6px] rounded-btn bg-surface px-[10px] outline-1 -outline-offset-1 outline-line-strong">
            <Globe size={13} aria-hidden className="shrink-0 text-muted" />
            <input
              aria-label="Website"
              placeholder="yourcompany.com"
              value={website}
              disabled={busy}
              onChange={(e) => onWebsiteChange(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
            />
          </label>
          <IconButton icon={Paperclip} aria-label="Upload a doc" onClick={() => fileRef.current?.click()} />
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="*/*"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
              e.target.value = ''
            }}
          />
        </form>
      </div>
      <Stroke />
    </aside>
  )
}

export function StepKnowYou({ onNext, onBack }: { onNext: () => void; onBack?: () => void }) {
  const navigate = useNavigate()
  const [view, setView] = useState<InterviewView | null>(null)
  const [pendingOwner, setPendingOwner] = useState<{ text?: string; attachment?: AttachmentMeta } | null>(null)
  const [liveText, setLiveText] = useState<string | null>(null)
  const [activity, setActivity] = useState<string | null>(null)
  const [writing, setWriting] = useState<TopicId | null>(null)
  const [website, setWebsite] = useState('')
  const [error, setError] = useState<string | null>(null)
  // The interview runs on your AI: it only starts once one is ready (Your AI step).
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const busy = liveText !== null

  function turn(body: { message?: string; website?: string; file?: FilePayload }, owner?: { text?: string; attachment?: AttachmentMeta }) {
    if (abortRef.current) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setError(null)
    setPendingOwner(owner ?? null)
    setLiveText('')
    setActivity(null)
    void interviewTurn(
      body,
      {
        onText: (d) => {
          setActivity(null)
          setLiveText((t) => (t ?? '') + d)
        },
        onActivity: (label) => setActivity(label),
        onNote: (topic, content) => {
          setWriting(topic)
          setView((v) => (v ? { ...v, notes: { ...v.notes, [topic]: content } } : v))
        },
        onDone: (v) => {
          setView(v)
          if (v.website) setWebsite(v.website)
        },
        onError: (message) => {
          setError(message)
        },
      },
      ctrl.signal,
    ).finally(() => {
      abortRef.current = null
      setLiveText(null)
      setPendingOwner(null)
      setActivity(null)
      window.setTimeout(() => setWriting(null), 1200)
    })
  }

  // Load where we were; a fresh interview starts with Chief's first question.
  useEffect(() => {
    let alive = true
    Promise.all([getAiStatus(), getInterview()])
      .then(([st, v]) => {
        if (!alive) return
        setAiStatus(st)
        setView(v)
        if (v.website) setWebsite(v.website)
        if (st.ready && !v.history.length) turn({})
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Couldn’t load the interview'))
    return () => {
      alive = false
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [view?.history.length, liveText, pendingOwner])

  const send = (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    turn({ message: t }, { text: t })
  }
  const readWebsite = () => {
    const url = website.trim()
    if (!url || busy) return
    turn({ website: url }, { text: `Read ${url}` })
  }
  const shareFile = async (file: File) => {
    const payload = await readFileBase64(file)
    turn({ file: payload }, { attachment: { name: file.name, mime: file.type, size: file.size } })
  }

  const history: InterviewEntry[] = view?.history ?? []
  const lastAi = [...history].reverse().find((h) => h.role === 'ai')
  const doneCount = view ? TOPIC_IDS.filter((t) => view.notes[t]?.trim()).length : 0
  const finished = view?.topic === 'finish'

  if (aiStatus && !aiStatus.ready) {
    return (
      <div className="flex min-h-0 w-full flex-1 items-center justify-center px-[16px] py-[24px]">
        <section
          aria-label="Connect your AI first"
          className="relative flex w-full max-w-[520px] flex-col items-start gap-[14px] rounded-lg bg-surface p-[28px]"
        >
          <Mascot helper area="brand" size={44} radius={12} title="Chief of Staff" />
          <h2 className="font-display text-[22px] font-semibold tracking-[-0.3px] text-ink">
            I need an AI before we talk
          </h2>
          <p className="text-[14px] leading-[1.55] text-ink-2">
            I get to know your business in a real conversation, and that runs on the AI you pick in the first step.{' '}
            {aiStatus.reason}
          </p>
          <div className="flex w-full flex-wrap items-center gap-[8px] pt-[4px]">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="flex h-[36px] items-center gap-[6px] rounded-btn bg-ink px-[14px] text-[13.5px] font-medium text-surface"
              >
                <ArrowLeft size={14} aria-hidden /> Back to Your AI
              </button>
            )}
            <QuietButton icon={ArrowRight} onClick={onNext}>Skip the interview for now</QuietButton>
          </div>
          <Stroke />
        </section>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-[16px] overflow-y-auto px-[16px] pt-[8px] pb-[16px] sm:px-[24px] sm:pb-[24px] lg:flex-row lg:overflow-hidden">
      <section aria-label="Interview" className="relative flex min-h-[460px] min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface lg:h-full lg:min-h-0">
        <div className="flex w-full items-center gap-[12px] px-[24px] py-[14px]" style={{ boxShadow: 'inset 0 -1px 0 var(--color-line)' }}>
          <h2 className="text-[14px] font-semibold text-ink">Getting to know you</h2>
          <span
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={7}
            className="relative hidden h-[6px] w-[160px] overflow-hidden rounded-[3px] bg-soft sm:block"
          >
            <span
              className="absolute inset-y-0 left-0 rounded-[3px] bg-helper-brand transition-[width]"
              style={{ width: `${(doneCount / 7) * 100}%` }}
            />
            <Stroke color="var(--color-line)" />
          </span>
          <span className="text-[12px] text-muted">{doneCount} of 7</span>
          {view?.ai.practice && (
            <span className="rounded-sm bg-soft px-[6px] py-[2px] text-[11px] text-muted" title="Connect an AI in the previous step for a real conversation">
              Practice mode
            </span>
          )}
          <span className="h-px flex-1" />
          <QuietButton icon={SkipForward} onClick={() => (busy ? undefined : send('Let’s skip this topic for now.'))}>
            Skip this topic
          </QuietButton>
          <QuietButton icon={Pause} onClick={() => void navigate({ to: '/inbox' })}>Finish later</QuietButton>
          <QuietButton icon={ArrowRight} onClick={onNext}>Next step</QuietButton>
        </div>

        <div ref={scrollRef} className="flex min-h-0 w-full flex-1 flex-col gap-[16px] overflow-y-auto px-[20px] py-[16px] sm:px-[48px] sm:py-[20px]">
          <div className="flex-1" />
          {history.map((h, i) =>
            h.role === 'ai' ? (
              <ChiefSays
                key={i}
                text={h.text}
                ideas={h === lastAi && !busy ? h.options : undefined}
                onIdea={send}
              />
            ) : (
              <OwnerSays key={i} text={h.text} attachment={h.attachment} />
            ),
          )}
          {pendingOwner && <OwnerSays text={pendingOwner.text ?? ''} attachment={pendingOwner.attachment} />}
          {liveText !== null && (
            <ChiefSays text={liveText || ''}>
              {!liveText && (
                <p className="flex items-center gap-[6px] text-[13px] text-muted">
                  <Loader2 size={13} aria-hidden className="animate-spin" />
                  {activity ?? 'Chief is thinking…'}
                </p>
              )}
              {liveText && activity && <p className="text-[12px] text-muted">{activity}</p>}
            </ChiefSays>
          )}
          {error && !busy && (
            <p role="alert" className="text-[13px] text-bad">
              {error}{' '}
              <button type="button" className="text-link underline" onClick={() => turn({})}>
                Try again
              </button>
            </p>
          )}
          {finished && !busy && (
            <div className="flex w-full justify-start pl-[34px]">
              <Pill icon={CircleCheck} onClick={onNext}>
                Check what I wrote
              </Pill>
            </div>
          )}
        </div>

        <div className="w-full px-[20px] pb-[16px] sm:px-[48px] sm:pb-[20px]">
          <Composer
            sessionId="onboarding-interview"
            selectedModel={DEFAULT_MODEL}
            onModelChange={() => {}}
            onSend={send}
            compact
            hideModelControls
            placeholder={busy ? 'Chief is answering…' : 'Type your answer…'}
          />
        </div>
        <Stroke />
      </section>
      <LearnedPanel
        view={view}
        writing={writing}
        website={website}
        onWebsiteChange={setWebsite}
        onReadWebsite={readWebsite}
        onFile={(f) => void shareFile(f)}
        busy={busy}
      />
    </div>
  )
}
