import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CloudUpload,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Lightbulb,
  Link2,
  ListChecks,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  Sheet,
  Sparkles,
  SquarePen,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react'
import type { KbSource, Model } from '../../../core/domain/types'
import { Composer } from '../../../ui/ChatSession/Composer'
import { DEFAULT_MODEL } from '../../../ui/ChatSession/ModelMenu'
import { Mascot } from '../../../ui/ds/Mascot'
import { useHideChiefFab } from '../../chief-dm'
import type { MenuEntries } from '../../../ui/ds/ItemMenu'
import { notify } from '../../../ui/ds/Toaster'
import {
  useAddKnowledgeSource,
  useAsk,
  useConfirmLesson,
  useCreateLesson,
  useDeleteKnowledgeSource,
  useForgetLesson,
  useHelpers,
  useKnowledgeSources,
  useLessons,
  useUpdateLesson,
} from '../../../app/queries'
import { NetworkGraph } from './graph/NetworkGraph'
import type { FileKind, GNode } from './graph/NetworkGraph'
import { KNOW_FRAME, TAG_COLOR, kindOf, layoutKnowledge, sourceNodes } from './graph/graphData'
import type { KnowNode, MemTag } from './graph/graphData'

type Filter = 'all' | MemTag

interface Cite {
  key: string
  label: string
  /** Lesson id when the citation is a memory in the graph */
  memoryId?: string
  owner?: string
  review?: boolean
}

interface Turn {
  id: string
  role: 'you' | 'chief'
  text: string
  pending?: boolean
  cites?: Cite[]
  /** A lesson Chief proposes to save or change */
  proposal?: { kind: 'update' | 'new'; memoryId?: string; text: string; owner: string; saved?: boolean }
}

interface Reading {
  id: string
  title: string
}

const SUGGESTIONS = ['What did agents learn this week?', 'Teach: refunds need an owner’s OK first', 'Forget anything about old pricing']

const FILE_ICON: Record<FileKind, typeof FileText> = { pdf: FileText, xlsx: Sheet, img: ImageIcon, doc: FileText }
const FILE_INK: Record<FileKind, string> = { pdf: 'text-[#DC2626]', xlsx: 'text-ok', img: 'text-[#2563EB]', doc: 'text-[#2563EB]' }

/** Files the browser can read as text (Knowledge indexes their text). */
const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'xml', 'yaml', 'yml']
const isReadable = (f: File) => f.type.startsWith('text/') || TEXT_EXT.includes(f.name.split('.').pop()?.toLowerCase() ?? '')

const significant = (s: string) => s.toLowerCase().split(/\W+/).filter((w) => w.length > 3)

// ── Small pieces ─────────────────────────────────────────────────────────────

function Pill({ on, onClick, dot, children }: { on: boolean; onClick: () => void; dot?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`flex h-[28px] items-center gap-[7px] rounded-full px-[12px] text-[12.5px] font-medium transition-colors ${
        on ? 'bg-ink text-white' : 'bg-surface text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-soft'
      }`}
    >
      {dot && <span className="size-[7px] rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  )
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className={`absolute z-10 rounded-lg bg-surface shadow-[0_8px_24px_#0C0A0914] outline-1 -outline-offset-1 outline-line-strong animate-in fade-in-0 ${className}`}
    >
      {children}
    </div>
  )
}

function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} aria-hidden className="animate-spin text-ink-2" />
}

// ── Add sources dialog (igY8b) ───────────────────────────────────────────────

function AddSourcesDialog({
  sources,
  reading,
  onFiles,
  onLink,
  onDrive,
  onClose,
}: {
  sources: KbSource[]
  reading: Reading[]
  onFiles: (files: File[]) => void
  onLink: (url: string) => void
  onDrive: () => void
  onClose: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [linking, setLinking] = useState(false)
  const [url, setUrl] = useState('')
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const rows = [...reading.map((r) => ({ id: r.id, title: r.title, done: false, chunks: 0 })), ...sources.slice(0, 6).map((s) => ({ id: s.id, title: s.title, done: true, chunks: s.chunks ?? 0 }))]
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0C0A0933] animate-in fade-in-0" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Add to company knowledge" className="flex w-[580px] max-w-[calc(100%-32px)] flex-col rounded-[16px] bg-surface shadow-[0_24px_60px_#0C0A0933] outline-1 -outline-offset-1 outline-line-strong">
        <div className="flex gap-[12px] px-[20px] pt-[18px] pb-[14px]">
          <span className="flex size-[36px] shrink-0 items-center justify-center rounded-base bg-soft outline-1 -outline-offset-1 outline-line-strong">
            <Building2 size={16} aria-hidden className="text-ink-2" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <h2 className="m-0 font-display text-[18px] font-semibold text-ink [font-variation-settings:'opsz'_96]">Add to company knowledge</h2>
            <p className="m-0 text-[13px] text-muted">Drop documents. Chief reads them and adds the facts, rules and prices it finds. Undo any time.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-ink">
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="flex flex-col gap-[14px] px-[20px] pb-[16px]">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              onFiles([...e.dataTransfer.files])
            }}
            className={`flex flex-col items-center gap-[6px] rounded-lg px-[20px] py-[18px] text-center outline-1 -outline-offset-1 ${over ? 'bg-[#EFF6FF] outline-[#93C5FD]' : 'bg-soft outline-line-strong'}`}
          >
            <CloudUpload size={18} aria-hidden className="text-ink-2" />
            <p className="m-0 text-[13px] text-ink-2">
              Drop files here, or{' '}
              <button type="button" onClick={() => input.current?.click()} className="text-link hover:underline">
                browse
              </button>
            </p>
            <p className="m-0 text-[11.5px] text-faint">Text, Markdown, CSV, JSON or HTML files · PDF, Office and photos are coming soon</p>
            <div className="mt-[4px] flex gap-[6px]">
              <button type="button" onClick={onDrive} className="flex h-[28px] items-center gap-[6px] rounded-btn bg-surface px-[10px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft">
                <HardDrive size={13} aria-hidden /> From Google Drive
              </button>
              <button type="button" onClick={() => setLinking((l) => !l)} className="flex h-[28px] items-center gap-[6px] rounded-btn bg-surface px-[10px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft">
                <Link2 size={13} aria-hidden /> Paste a link
              </button>
            </div>
            {linking && (
              <form
                className="mt-[6px] flex w-full gap-[6px]"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!url.trim()) return
                  onLink(url.trim())
                  setUrl('')
                  setLinking(false)
                }}
              >
                <input
                  autoFocus
                  aria-label="Link"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  className="h-[28px] min-w-0 flex-1 rounded-btn bg-surface px-[8px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-ink"
                />
                <button type="submit" className="h-[28px] rounded-btn bg-primary px-[10px] text-[12.5px] font-medium text-primary-ink hover:bg-primary-hover">
                  Add link
                </button>
              </form>
            )}
            <input
              ref={input}
              type="file"
              multiple
              hidden
              aria-label="Choose files"
              onChange={(e) => {
                onFiles([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </div>
          <div className="flex items-center gap-[8px] text-[12.5px] text-muted">
            Visible to
            <span className="flex h-[28px] items-center gap-[6px] rounded-btn bg-surface px-[10px] text-ink outline-1 -outline-offset-1 outline-line-strong">
              <Building2 size={13} aria-hidden /> Company-wide · every helper and person
            </span>
            <span className="ml-auto text-[11.5px] text-faint">Per channel · soon</span>
          </div>
          {rows.length > 0 && (
            <ul className="m-0 flex list-none flex-col rounded-lg p-0 outline-1 -outline-offset-1 outline-line-strong">
              {rows.map((s, i) => {
                const file = kindOf(s.title)
                const Icon = FILE_ICON[file]
                return (
                  <li key={s.id} className={`flex items-center gap-[10px] px-[12px] py-[10px] ${i < rows.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}>
                    <span className="flex size-[30px] items-center justify-center rounded-base outline-1 -outline-offset-1 outline-line-strong">
                      <Icon size={15} aria-hidden className={FILE_INK[file]} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <span className="truncate text-[13px] font-medium text-ink">{s.title}</span>
                      <span className="text-[11.5px] text-muted">{s.done ? `${s.chunks} added` : 'Reading…'}</span>
                    </div>
                    <span
                      className={`rounded-sm px-[7px] py-[2px] text-[12px] font-medium outline-1 -outline-offset-1 ${
                        s.done ? 'bg-ok-tint text-ok outline-ok-line' : 'bg-info-tint text-info outline-info-line'
                      }`}
                    >
                      {s.done ? 'Added' : 'Reading'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-[8px] px-[20px] py-[14px] shadow-[inset_0_1px_0_var(--color-line)]">
          <span className="flex-1 text-[12.5px] text-muted">Indexed in your workspace database · no AI credits used</span>
          <button type="button" onClick={onClose} className="h-[32px] rounded-base bg-primary px-[14px] text-[13px] font-medium text-primary-ink hover:bg-primary-hover">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Ask & teach panel (WZycb) ────────────────────────────────────────────────

function AskPanel({
  turns,
  memoryCount,
  nameOf,
  onSend,
  onClose,
  onNew,
  onSave,
  onPick,
  placeholder,
}: {
  turns: Turn[]
  memoryCount: number
  nameOf: (owner: string | undefined) => string
  onSend: (text: string) => void
  onClose: () => void
  onNew: () => void
  onSave: (turnId: string, text: string) => void
  onPick: (memoryId: string) => void
  placeholder: string
}) {
  const [model, setModel] = useState<Model>(DEFAULT_MODEL)
  const [editing, setEditing] = useState<string | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroll.current?.scrollTo?.({ top: scroll.current.scrollHeight, behavior: 'smooth' })
  }, [turns])
  return (
    <aside aria-label="Ask & teach" className="flex w-[400px] shrink-0 flex-col bg-surface shadow-[inset_1px_0_0_var(--color-line-strong)]">
      <header className="flex h-[44px] shrink-0 items-center gap-[8px] px-[14px] shadow-[inset_0_-1px_0_var(--color-line)]">
        <Mascot size={20} radius={5} area="brand" still />
        <h2 className="m-0 flex-1 text-[13px] font-semibold text-ink">Ask &amp; teach</h2>
        <button type="button" aria-label="New conversation" onClick={onNew} className="flex size-[26px] items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-ink">
          <SquarePen size={14} aria-hidden />
        </button>
        <button type="button" aria-label="Close panel" onClick={onClose} className="flex size-[26px] items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-ink">
          <X size={15} aria-hidden />
        </button>
      </header>
      <div ref={scroll} className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto px-[14px] py-[14px]">
        {turns.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-[8px] text-center">
            <Mascot size={36} radius={10} area="brand" />
            <p className="m-0 text-[13px] text-muted">Ask what your agents know, or teach them — “Remember that…”</p>
          </div>
        )}
        {turns.map((t) =>
          t.role === 'you' ? (
            <p key={t.id} className="m-0 ml-[44px] rounded-lg bg-soft px-[14px] py-[10px] text-[13.5px] leading-[20px] text-ink outline-1 -outline-offset-1 outline-line">
              {t.text}
            </p>
          ) : (
            <div key={t.id} className="flex gap-[10px]">
              <Mascot size={22} radius={6} area="brand" still />
              <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
                <span className="flex items-center gap-[8px] text-[12.5px] font-semibold text-ink">
                  Chief <span className="text-[11.5px] font-normal text-faint">read {memoryCount} memories · now</span>
                </span>
                {t.pending ? <div className="h-[14px] w-2/3 animate-pulse rounded-sm bg-soft" /> : <p className="m-0 text-[13px] leading-[19px] text-ink-2">{t.text}</p>}
                {t.cites && t.cites.length > 0 && (
                  <ol className="m-0 flex list-none flex-col p-0">
                    {t.cites.map((c, i) => (
                      <li key={c.key}>
                        <button
                          type="button"
                          disabled={!c.memoryId}
                          onClick={() => c.memoryId && onPick(c.memoryId)}
                          className="flex h-[27px] w-full items-center gap-[8px] rounded-sm px-[2px] text-left hover:bg-soft disabled:hover:bg-transparent"
                        >
                          <span className="flex size-[16px] shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-semibold text-white">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{c.label}</span>
                          {c.review && <span className="rounded-xs bg-[#FFEDD5] px-[5px] text-[11px] font-medium text-[#C2410C]">Review</span>}
                          <span className="text-[11.5px] text-faint">{c.memoryId ? nameOf(c.owner) : 'Doc'}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                {t.proposal && (
                  <div className="flex flex-col gap-[10px] rounded-lg p-[14px] outline-1 -outline-offset-1 outline-line-strong">
                    <span className="flex items-center gap-[10px] text-[13.5px] font-semibold text-ink">
                      <span className="flex size-[28px] items-center justify-center rounded-base bg-[#FEF2F2]">
                        <Lightbulb size={15} aria-hidden className="text-[#DC2626]" />
                      </span>
                      {t.proposal.kind === 'update'
                        ? `Update ${nameOf(t.proposal.owner)}’s lesson?`
                        : t.proposal.owner === 'hub'
                          ? 'Save a company fact?'
                          : `Save a lesson for ${nameOf(t.proposal.owner)}?`}
                    </span>
                    {editing === t.id ? (
                      <textarea
                        autoFocus
                        aria-label="Lesson text"
                        defaultValue={t.proposal.text}
                        onBlur={(e) => {
                          onSave(t.id, e.target.value)
                          setEditing(null)
                        }}
                        rows={2}
                        className="resize-none rounded-base bg-surface px-[10px] py-[7px] text-[13px] text-ink outline-1 outline-ink"
                      />
                    ) : (
                      <p className="m-0 text-[13px] leading-[19px] text-ink-2">
                        “{t.proposal.text}” {t.proposal.kind === 'update' ? 'Replaces the old version; agents use it from the next run.' : 'Agents use it from the next run.'}
                      </p>
                    )}
                    <div className="flex items-center gap-[6px]">
                      {t.proposal.saved ? (
                        <span className="flex items-center gap-[6px] text-[12.5px] font-medium text-ok">
                          <CircleCheck size={14} aria-hidden /> Saved
                        </span>
                      ) : (
                        <>
                          <button type="button" onClick={() => setEditing(t.id)} className="h-[30px] rounded-btn bg-surface px-[12px] text-[13px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft">
                            Edit
                          </button>
                          <button type="button" onClick={() => onSave(t.id, t.proposal!.text)} className="flex h-[30px] items-center gap-[6px] rounded-btn bg-primary px-[12px] text-[13px] font-medium text-primary-ink hover:bg-primary-hover">
                            <Check size={14} aria-hidden /> Save lesson
                          </button>
                        </>
                      )}
                      <span className="ml-auto text-[11.5px] text-faint">you · now</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ),
        )}
      </div>
      <div className="shrink-0 px-[12px] pt-[6px] pb-[12px]">
        <Composer sessionId="knowledge" selectedModel={model} onModelChange={setModel} placeholder={placeholder} onSend={onSend} autoFocus />
      </div>
    </aside>
  )
}

// ── Knowledge view ───────────────────────────────────────────────────────────

/** pen `Docs · Knowledge (on)` — eU7Fc, TBJls, cUtde, n8N6dT, igY8b, WZycb. */
export function KnowledgeView({ panelOpen, onPanelOpen, teachSignal }: { panelOpen: boolean; onPanelOpen: (open: boolean) => void; teachSignal: number }) {
  const navigate = useNavigate()
  const { data: lessons = [], isError: lessonsError } = useLessons()
  const { data: helpers = [] } = useHelpers()
  const { data: sources = [] } = useKnowledgeSources()
  const confirmLesson = useConfirmLesson()
  const forgetLesson = useForgetLesson()
  const updateLesson = useUpdateLesson()
  const createLesson = useCreateLesson()
  const addSource = useAddKnowledgeSource()
  const deleteSource = useDeleteKnowledgeSource()
  const askChief = useAsk()

  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  /** undefined → show the first lesson that needs review */
  const [reviewPick, setReviewPick] = useState<string | null | undefined>(undefined)
  const [editingReview, setEditingReview] = useState(false)
  const [owner, setOwner] = useState<string | null>(null)
  const [teachOwner, setTeachOwner] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState<Reading[]>([])
  const [readingOpen, setReadingOpen] = useState(true)
  const [sourcesCard, setSourcesCard] = useState(false)
  const [toast, setToast] = useState<{ text: string; sourceId: string } | null>(null)
  const [dialog, setDialog] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [highlight, setHighlight] = useState<{ ids: string[]; about: string } | null>(null)
  const [forgotten, setForgotten] = useState<string[]>([])
  const [model, setModel] = useState<Model>(DEFAULT_MODEL)
  const [placeholder, setPlaceholder] = useState('Ask or teach — “Remember that…”')
  const dragDepth = useRef(0)
  const forgetTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useHideChiefFab(true)

  // Topbar "Teach something" (the board opens the panel) — get ready to teach
  const [seenTeach, setSeenTeach] = useState(teachSignal)
  if (seenTeach !== teachSignal) {
    setSeenTeach(teachSignal)
    setPlaceholder('Remember that…')
  }

  const live = useMemo(() => lessons.filter((l) => !forgotten.includes(l.id)), [lessons, forgotten])
  const lessonById = useMemo(() => new Map(live.map((l) => [l.id, l])), [live])
  const chief = helpers.find((h) => h.isChief)
  const nameOf = (o: string | undefined | null) => (!o || o === 'hub' ? 'Company fact' : helpers.find((h) => h.id === o)?.name ?? 'Helper')
  const reviews = live.filter((l) => l.status === 'review')
  const reviewCard = reviewPick === undefined ? reviews[0]?.id ?? null : reviewPick
  const busy = reading.length > 0

  // ── Sources ──
  async function addOne(input: { kind: string; ref: string; title: string; body: string }) {
    const tmp = { id: `reading-${input.ref}`, title: input.title }
    setReading((r) => [...r.filter((x) => x.id !== tmp.id), tmp])
    setReadingOpen(true)
    try {
      const src = await addSource.mutateAsync(input)
      const n = src.chunks ?? 0
      setToast({ text: `${n} fact${n === 1 ? '' : 's'} added from ${src.title}`, sourceId: src.id })
    } catch {
      notify(`Couldn't read ${input.title}`)
    } finally {
      setReading((r) => r.filter((x) => x.id !== tmp.id))
    }
  }

  function addFiles(files: File[]) {
    const list = files.slice(0, 5)
    const skipped = list.filter((f) => !isReadable(f))
    if (skipped.length) notify(`Can’t read ${skipped.map((f) => f.name).join(', ')} yet — add text, Markdown or CSV files`)
    for (const f of list.filter(isReadable)) {
      void f.text().then((body) => addOne({ kind: 'upload', ref: `upload:${f.name}`, title: f.name, body }))
    }
    setSourcesCard(false)
    setReviewPick(null)
  }

  function addLink(url: string) {
    void addOne({ kind: 'url', ref: url, title: url.replace(/^https?:\/\//, ''), body: `Link: ${url}` })
  }

  function removeSource(id: string) {
    const s = sources.find((x) => x.id === id)
    deleteSource.mutate(id, {
      onSuccess: () => notify(`Removed ${s?.title ?? 'the source'} and its facts`),
      onError: () => notify("Couldn't remove the source"),
    })
  }

  // ── Memories ──
  function confirm(id: string) {
    confirmLesson.mutate(id, {
      onSuccess: () => notify('Lesson confirmed — agents use it from the next run'),
      onError: () => notify("Couldn't confirm the lesson"),
    })
    setReviewPick(undefined)
    setEditingReview(false)
  }
  function forget(id: string) {
    const l = lessonById.get(id)
    if (!l) return
    setForgotten((f) => [...f, id])
    if (reviewCard === id) setReviewPick(undefined)
    if (selected === id) setSelected(null)
    const timer = setTimeout(() => {
      forgetTimers.current.delete(id)
      forgetLesson.mutate(id, { onError: () => notify(`Couldn't forget “${l.text}”`) })
    }, 6000)
    forgetTimers.current.set(id, timer)
    notify(`Forgot “${l.text}”`, () => {
      clearTimeout(timer)
      forgetTimers.current.delete(id)
      setForgotten((f) => f.filter((x) => x !== id))
    })
  }
  // Flush pending forgets if the view goes away.
  useEffect(() => {
    const timers = forgetTimers.current
    return () => {
      for (const [id, t] of timers) {
        clearTimeout(t)
        forgetLesson.mutate(id)
      }
      timers.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function rename(id: string, label: string) {
    const l = lessonById.get(id)
    if (l && label.trim() && label.trim() !== l.text) updateLesson.mutate({ id, text: label.trim() }, { onError: () => notify("Couldn't save the change") })
  }

  // ── Ask & teach ──
  function ask(text: string) {
    const id = `t${Date.now()}`
    const you: Turn = { id: `${id}y`, role: 'you', text }
    onPanelOpen(true)
    setReviewPick(null)
    if (/^(remember|teach)/i.test(text)) {
      const body = text.replace(/^(remember( that)?|teach)[:\s]*/i, '').trim()
      const target = teachOwner ?? chief?.id ?? 'hub'
      const words = significant(body)
      const match = live.find((l) => (l.helperId ?? 'hub') === target && significant(l.text).filter((w) => words.includes(w)).length >= 2)
      const proposalText = body.charAt(0).toUpperCase() + body.slice(1)
      const reply: Turn = match
        ? { id, role: 'chief', text: 'That refines a lesson I already have. Here’s the update — save it?', proposal: { kind: 'update', memoryId: match.id, text: proposalText, owner: target } }
        : { id, role: 'chief', text: target === 'hub' ? 'Got it. I’ll keep this as a company fact — save it?' : `Got it. I’ll keep this as a lesson for ${nameOf(target)} — save it?`, proposal: { kind: 'new', text: proposalText, owner: target } }
      setTurns((t) => [...t, you, reply])
      return
    }
    if (/^forget/i.test(text)) {
      const word = text.replace(/^forget( anything)?( about)?/i, '').trim().toLowerCase()
      const hits = live.filter((l) => word && word.split(' ').some((w) => w.length > 3 && l.text.toLowerCase().includes(w)))
      const reply: Turn = hits.length
        ? { id, role: 'chief', text: `I found ${hits.length} — right-click one in the graph to forget it.`, cites: hits.map((h) => ({ key: h.id, label: h.text, memoryId: h.id, owner: h.helperId ?? 'hub', review: h.status === 'review' })) }
        : { id, role: 'chief', text: `Nothing about “${word || text}” is in memory — nothing to forget.` }
      setHighlight(hits.length ? { ids: hits.map((h) => h.id), about: word } : null)
      setTurns((t) => [...t, you, reply])
      return
    }
    setTurns((t) => [...t, you, { id, role: 'chief', text: '', pending: true }])
    askChief.mutate(text, {
      onSuccess: (a) => {
        const cites: Cite[] = a.citations.map((c) => {
          const memoryId = c.kind === 'lesson' && c.ref.startsWith('lesson:') ? c.ref.slice(7) : undefined
          const l = memoryId ? lessonById.get(memoryId) : undefined
          return { key: `${c.n}-${c.sourceId}`, label: l?.text ?? c.title, memoryId: l?.id, owner: l?.helperId ?? 'hub', review: l?.status === 'review' }
        })
        // Questions about what agents learned also list their recent lessons.
        if (/learn|know/i.test(text) && cites.every((c) => !c.memoryId)) {
          for (const l of live.slice(0, 6)) cites.push({ key: l.id, label: l.text, memoryId: l.id, owner: l.helperId ?? 'hub', review: l.status === 'review' })
        }
        const ids = cites.flatMap((c) => (c.memoryId ? [c.memoryId] : []))
        setHighlight(ids.length ? { ids, about: 'this' } : null)
        setTurns((list) => list.map((x) => (x.id === id ? { ...x, pending: false, text: a.answer, cites } : x)))
      },
      onError: () => setTurns((list) => list.map((x) => (x.id === id ? { ...x, pending: false, text: 'I couldn’t search right now — try again.' } : x))),
    })
  }

  function saveProposal(turnId: string, text: string) {
    const t = turns.find((x) => x.id === turnId)
    if (!t?.proposal) return
    const p = t.proposal
    const done = () => {
      setTurns((list) => list.map((x) => (x.id === turnId ? { ...x, proposal: { ...p, text, saved: true } } : x)))
      notify('Lesson saved')
    }
    if (p.kind === 'update' && p.memoryId) {
      updateLesson.mutate({ id: p.memoryId, text }, {
        onSuccess: () => {
          if (lessonById.get(p.memoryId!)?.status === 'review') confirmLesson.mutate(p.memoryId!)
          done()
        },
        onError: () => notify("Couldn't save the lesson"),
      })
    } else {
      createLesson.mutate(
        { text, helperId: p.owner === 'hub' ? null : p.owner, tag: p.owner === 'hub' ? 'fact' : 'lesson' },
        { onSuccess: done, onError: () => notify("Couldn't save the lesson") },
      )
    }
  }

  // ── Graph model ──
  const layout = useMemo(() => layoutKnowledge(helpers, live), [helpers, live])
  const memories = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout])
  const fileNodes = useMemo(() => sourceNodes(sources, reading), [sources, reading])
  const nodes: GNode[] = useMemo(() => {
    const cites = highlight?.ids ?? []
    return [
      ...layout.nodes.map((n) => ({
        ...n,
        emphasis: n.review ? (n.id === reviewCard ? 'review' : 'halo') : undefined,
        badge: cites.includes(n.id) ? cites.indexOf(n.id) + 1 : undefined,
      })) as GNode[],
      ...fileNodes,
    ]
  }, [layout, fileNodes, reviewCard, highlight])
  const edges = useMemo(() => [...layout.edges, ...fileNodes.map((f) => ({ from: 'hub', to: f.id, tone: 'source' as const }))], [layout, fileNodes])

  const focus = useMemo(() => {
    if (highlight) {
      const s = new Set(highlight.ids)
      for (const id of highlight.ids) {
        const o = memories.get(id)?.owner
        if (o) s.add(o)
      }
      s.add('hub')
      return s
    }
    if (owner) return new Set(layout.nodes.filter((n) => n.id === owner || n.owner === owner || n.kind === 'hub').map((n) => n.id))
    if (filter !== 'all') return new Set(nodes.filter((n) => n.kind !== 'memory' || (n as KnowNode).tag === filter).map((n) => n.id))
    return null
  }, [filter, owner, highlight, layout, nodes, memories])

  function menuFor(n: GNode): MenuEntries {
    const k = memories.get(n.id)
    if (n.kind === 'memory' && k) {
      return [
        { type: 'label', label: `${nameOf(k.owner)} · ${k.tag}` },
        k.review && { label: 'Confirm', icon: Check, onSelect: () => confirm(k.id) },
        { label: 'Edit', icon: Pencil, onSelect: () => { setReviewPick(k.id); setEditingReview(true) } },
        { label: 'Ask about this', icon: Sparkles, onSelect: () => ask(`What does ${nameOf(k.owner)} know about “${lessonById.get(k.id)?.text ?? k.label}”?`) },
        { label: k.source ? `Learned from: ${k.source}` : 'Show source', icon: MessageSquareText, disabled: true, onSelect: () => {} },
        { type: 'separator' },
        { label: 'Forget', icon: Trash2, danger: true, onSelect: () => forget(k.id) },
      ]
    }
    if (n.kind === 'agent') {
      const name = nameOf(n.id)
      return [
        { label: owner === n.id ? 'Show everyone' : `Show only ${name}’s memories`, icon: ListChecks, onSelect: () => setOwner(owner === n.id ? null : n.id) },
        { label: `Teach ${name} something`, icon: Lightbulb, onSelect: () => { setTeachOwner(n.id); setPlaceholder(`Remember that… (for ${name})`); onPanelOpen(true) } },
        { label: `Ask what ${name} knows`, icon: Sparkles, onSelect: () => ask(`What has ${name} learned?`) },
        { type: 'separator' },
        { label: 'Open profile', icon: UserRound, onSelect: () => void navigate({ to: '/team/$helperId', params: { helperId: n.id } }) },
      ]
    }
    if (n.kind === 'file') {
      const id = n.id.startsWith('src:') ? n.id.slice(4) : null
      return [
        { label: 'Show all sources', icon: ListChecks, onSelect: () => setSourcesCard(true) },
        { type: 'separator' },
        { label: 'Remove source and its facts', icon: Trash2, danger: true, disabled: !id, onSelect: () => id && removeSource(id) },
      ]
    }
    return [
      { label: 'Add sources', icon: Upload, onSelect: () => setDialog(true) },
      { label: 'Teach something', icon: Plus, onSelect: () => { setTeachOwner(null); onPanelOpen(true) } },
    ]
  }

  function onDragEnter(e: DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return
    dragDepth.current += 1
    setDragging(true)
  }
  function onDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const card = reviewCard ? memories.get(reviewCard) : undefined
  const sel = selected ? memories.get(selected) : undefined
  const shownCard = card ?? (sel?.kind === 'memory' ? sel : undefined)
  const shownLesson = shownCard ? lessonById.get(shownCard.id) : undefined
  const showSourcesPanel = (sources.length > 0 || busy) && !sourcesCard

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div
        className="relative flex min-h-0 min-w-0 flex-1"
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          addFiles([...e.dataTransfer.files])
        }}
      >
        <NetworkGraph
          label="Knowledge graph"
          nodes={nodes}
          edges={edges}
          frame={KNOW_FRAME}
          selected={selected}
          onSelect={(id) => {
            if (id?.startsWith('src:') || id?.startsWith('reading-')) {
              setSelected(id)
              return setSourcesCard(true)
            }
            setSelected(id)
            const m = id ? lessonById.get(id) : undefined
            if (m?.status === 'review') setReviewPick(id)
            else if (id) setReviewPick(null)
          }}
          focus={focus}
          menuFor={menuFor}
          backgroundMenu={[
            { label: 'Add sources', icon: Upload, onSelect: () => setDialog(true) },
            { label: 'Teach something', icon: Plus, onSelect: () => { setTeachOwner(null); onPanelOpen(true) } },
          ]}
          className={dragging ? 'opacity-30 blur-[2px]' : ''}
        >
          {/* Filters + actions */}
          <div className="absolute top-[16px] right-[16px] left-[15px] z-10 flex items-center gap-[8px]" onPointerDown={(e) => e.stopPropagation()}>
            <div role="radiogroup" aria-label="Memory type" className="flex gap-[6px]">
              <Pill on={filter === 'all'} onClick={() => setFilter('all')}>All</Pill>
              <Pill on={filter === 'lesson'} onClick={() => setFilter('lesson')} dot={TAG_COLOR.lesson}>Lessons</Pill>
              <Pill on={filter === 'preference'} onClick={() => setFilter('preference')} dot={TAG_COLOR.preference}>Preferences</Pill>
              <Pill on={filter === 'fact'} onClick={() => setFilter('fact')} dot={TAG_COLOR.fact}>Facts</Pill>
            </div>
            {owner && (
              <button type="button" onClick={() => setOwner(null)} className="flex h-[28px] items-center gap-[6px] rounded-full bg-surface px-[10px] text-[12.5px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong">
                Only {nameOf(owner)} <X size={12} aria-hidden />
              </button>
            )}
            <div className="flex-1" />
            <button type="button" onClick={() => setDialog(true)} className="flex h-[30px] items-center gap-[7px] rounded-btn bg-surface px-[11px] text-[13px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft">
              <Upload size={14} aria-hidden /> Add sources
            </button>
            {reviews.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setReviewPick(reviews[0].id)
                  setSelected(reviews[0].id)
                }}
                className="flex h-[30px] items-center gap-[7px] rounded-full bg-[#FFF7ED] px-[12px] text-[13px] font-medium text-[#C2410C] outline-1 -outline-offset-1 outline-[#FDBA74] hover:bg-[#FFEDD5]"
              >
                <ListChecks size={14} aria-hidden /> {reviews.length} need review <ArrowRight size={13} aria-hidden />
              </button>
            )}
          </div>

          {lessonsError && (
            <div className="absolute top-[60px] left-[15px] z-10 text-[12.5px] text-bad">Couldn't load memories</div>
          )}

          {/* Review / memory card */}
          {shownCard && shownLesson && !sourcesCard && (
            <Card className="top-[84px] left-[15px] w-[270px] px-[12px] pt-[11px] pb-[12px]">
              <div className="flex items-center gap-[6px] text-[12px] text-muted">
                {shownCard.owner && shownCard.owner !== 'hub' ? (
                  <Mascot size={14} radius={4} area={helpers.find((h) => h.id === shownCard.owner)?.area ?? 'brand'} still />
                ) : (
                  <Building2 size={13} aria-hidden />
                )}
                {nameOf(shownCard.owner)} · {shownCard.tag}
                <span className="flex-1" />
                {shownCard.review && <span className="rounded-xs bg-[#FEF2F2] px-[6px] py-[1px] text-[11px] font-medium text-[#B91C1C]">Needs review</span>}
                {!shownCard.review && (
                  <button type="button" aria-label="Close" onClick={() => { setReviewPick(null); setSelected(null) }} className="text-faint hover:text-ink">
                    <X size={13} aria-hidden />
                  </button>
                )}
              </div>
              {editingReview && reviewCard === shownCard.id ? (
                <input
                  autoFocus
                  aria-label="Memory text"
                  defaultValue={shownLesson.text}
                  onBlur={(e) => {
                    rename(shownCard.id, e.target.value)
                    setEditingReview(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditingReview(false)
                  }}
                  className="mt-[6px] h-[28px] w-full rounded-sm bg-surface px-[6px] text-[13.5px] font-semibold text-ink outline-1 outline-ink"
                />
              ) : (
                <p className="m-0 mt-[6px] text-[13.5px] font-semibold text-ink">{shownLesson.text}</p>
              )}
              <p className="m-0 mt-[3px] text-[12px] text-muted">{shownLesson.source}</p>
              <div className="mt-[10px] flex gap-[6px]">
                {shownCard.review && (
                  <button type="button" onClick={() => confirm(shownCard.id)} className="flex h-[28px] items-center gap-[6px] rounded-btn bg-primary px-[10px] text-[12.5px] font-medium text-primary-ink hover:bg-primary-hover">
                    <Check size={13} aria-hidden /> Confirm
                  </button>
                )}
                <button type="button" onClick={() => { setReviewPick(shownCard.id); setEditingReview(true) }} className="h-[28px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft">
                  Edit
                </button>
                <button type="button" onClick={() => forget(shownCard.id)} className="h-[28px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-bad outline-1 -outline-offset-1 outline-line-strong hover:bg-bad-tint">
                  Forget
                </button>
              </div>
            </Card>
          )}

          {/* Sources card (n8N6dT) */}
          {sourcesCard && (
            <Card className="top-[84px] left-[15px] w-[270px] p-[6px]">
              <div className="flex items-center gap-[6px] px-[6px] pt-[4px] pb-[6px]">
                <span className="text-[13px] font-semibold text-ink">Sources</span>
                <span className="text-[11.5px] text-faint">{sources.length}</span>
                <span className="flex-1" />
                <button type="button" aria-label="Add sources" onClick={() => setDialog(true)} className="flex size-[22px] items-center justify-center rounded-xs text-muted hover:bg-hover">
                  <Plus size={14} aria-hidden />
                </button>
                <button type="button" aria-label="Close sources" onClick={() => setSourcesCard(false)} className="flex size-[22px] items-center justify-center rounded-xs text-muted hover:bg-hover">
                  <X size={13} aria-hidden />
                </button>
              </div>
              {sources.length === 0 && <p className="m-0 px-[8px] pb-[8px] text-[12px] text-muted">Nothing added yet.</p>}
              {sources.map((s) => {
                const file = kindOf(s.title)
                const Icon = FILE_ICON[file]
                return (
                  <div key={s.id} className={`group/src flex w-full gap-[8px] rounded-base px-[8px] py-[7px] text-left ${selected === `src:${s.id}` ? 'bg-[#EFF6FF]' : 'hover:bg-soft'}`}>
                    <Icon size={14} aria-hidden className={`mt-[2px] shrink-0 ${FILE_INK[file]}`} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[12.5px] font-medium text-ink">{s.title}</span>
                      <span className="text-[11.5px] text-[#2563EB]">{s.chunks ?? 0} added</span>
                    </span>
                    <button type="button" aria-label={`Remove ${s.title}`} onClick={() => removeSource(s.id)} className="hidden size-[20px] items-center justify-center rounded-xs text-muted group-hover/src:flex hover:text-bad">
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </div>
                )
              })}
            </Card>
          )}

          {/* Reading panel (cUtde) */}
          {showSourcesPanel && (
            <Card className="top-[56px] right-[16px] w-[283px]">
              <button type="button" onClick={() => setReadingOpen((o) => !o)} className="flex h-[36px] w-full items-center gap-[8px] px-[12px] text-left shadow-[inset_0_-1px_0_var(--color-line)]">
                {busy ? <Spinner /> : <CircleCheck size={14} aria-hidden className="text-ok" />}
                <span className="flex-1 text-[13px] font-semibold text-ink">
                  {busy ? `Reading ${reading.length} file${reading.length > 1 ? 's' : ''}` : `Read ${sources.length} source${sources.length === 1 ? '' : 's'}`}
                </span>
                {readingOpen ? <ChevronUp size={14} aria-hidden className="text-muted" /> : <ChevronDown size={14} aria-hidden className="text-muted" />}
              </button>
              {readingOpen && (
                <>
                  <ul className="m-0 list-none p-0">
                    {[...reading.map((r) => ({ id: r.id, title: r.title, done: false, chunks: 0 })), ...sources.slice(0, 5).map((s) => ({ id: s.id, title: s.title, done: true, chunks: s.chunks ?? 0 }))].map((s) => {
                      const file = kindOf(s.title)
                      const Icon = FILE_ICON[file]
                      return (
                        <li key={s.id}>
                          <button type="button" onClick={() => setSourcesCard(true)} className="flex w-full items-center gap-[9px] px-[12px] py-[7px] text-left hover:bg-soft">
                            <Icon size={14} aria-hidden className={`shrink-0 ${FILE_INK[file]}`} />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-[12.5px] font-medium text-ink">{s.title}</span>
                              <span className="truncate text-[11.5px] text-muted">{s.done ? `${s.chunks} added` : 'Reading…'}</span>
                            </span>
                            {s.done ? <CircleCheck size={15} aria-hidden className="shrink-0 text-ok" /> : <Spinner size={14} />}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="m-0 flex items-center gap-[6px] px-[12px] py-[8px] text-[11.5px] text-muted shadow-[inset_0_1px_0_var(--color-line)]">
                    <Building2 size={12} aria-hidden /> Company-wide · added as soon as it’s read
                  </p>
                </>
              )}
            </Card>
          )}

          {/* Facts added toast */}
          {toast && (
            <div role="status" className="absolute top-[60px] left-1/2 z-20 flex h-[34px] -translate-x-1/2 items-center gap-[10px] rounded-lg bg-primary pr-[14px] pl-[12px] text-[13px] whitespace-nowrap text-primary-ink shadow-[0_10px_24px_#0C0A0940] animate-in fade-in-0 slide-in-from-top-1" onPointerDown={(e) => e.stopPropagation()}>
              <CircleCheck size={15} aria-hidden className="text-[#86EFAC]" />
              {toast.text}
              <button
                type="button"
                onClick={() => {
                  removeSource(toast.sourceId)
                  setToast(null)
                }}
                className="text-on-ink-2 hover:text-white"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelected(`src:${toast.sourceId}`)
                  setSourcesCard(true)
                  setToast(null)
                }}
                className="font-semibold hover:underline"
              >
                Show in graph
              </button>
              <button type="button" aria-label="Dismiss" onClick={() => setToast(null)} className="-mr-[6px] text-on-ink-2 hover:text-white">
                <X size={13} aria-hidden />
              </button>
            </div>
          )}

          {/* Highlight strip */}
          {highlight && (
            <div className="absolute bottom-[20px] left-[16px] z-10 flex h-[30px] items-center gap-[8px] rounded-full bg-surface pr-[12px] pl-[10px] text-[12.5px] text-ink-2 shadow-[0_1px_2px_#0C0A090D] outline-1 -outline-offset-1 outline-line-strong" onPointerDown={(e) => e.stopPropagation()}>
              <Sparkles size={13} aria-hidden className="text-[#6366F1]" />
              Highlighting {highlight.ids.length} memories about {highlight.about}
              <button type="button" onClick={() => setHighlight(null)} className="font-medium text-link hover:underline">
                Clear
              </button>
            </div>
          )}

          {/* Centered composer (eU7Fc) — the panel takes it over when open */}
          {!panelOpen && (
            <div className="absolute bottom-[46px] left-1/2 z-10 flex w-[680px] max-w-[calc(100%-40px)] -translate-x-1/2 flex-col items-center gap-[12px]" onPointerDown={(e) => e.stopPropagation()}>
              <h2 className="m-0 flex items-center gap-[10px] font-display text-[19px] font-semibold tracking-[-0.3px] text-ink [font-variation-settings:'opsz'_96]">
                <Mascot size={28} radius={8} area="brand" />
                Ask what your agents know, or teach them something
              </h2>
              <Composer sessionId="knowledge-hero" selectedModel={model} onModelChange={setModel} placeholder={'“What has Chief learned about deploys?” or “Remember that…”'} onSend={ask} />
              <div className="flex flex-nowrap justify-center gap-[6px]">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s.replace(/^Teach: /, 'Remember that '))} className="h-[28px] shrink-0 rounded-btn bg-surface px-[10px] text-[12.5px] whitespace-nowrap text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-soft">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </NetworkGraph>

        {/* Drop overlay (TBJls) */}
        {dragging && (
          <div className="pointer-events-none absolute inset-[12px] z-20 flex flex-col items-center justify-center gap-[8px] rounded-lg bg-[#EFF6FFB3] text-center outline-2 -outline-offset-2 outline-[#93C5FD]">
            <Mascot size={56} radius={16} area="brand" helper tile={false} />
            <h3 className="m-0 mt-[6px] text-[15px] font-semibold text-ink">Drop to teach the whole company</h3>
            <p className="m-0 text-[13px] text-muted">Chief reads the documents and adds what it finds to company knowledge.</p>
            <span className="mt-[4px] flex h-[26px] items-center gap-[6px] rounded-full bg-surface px-[10px] text-[12.5px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong">
              <Building2 size={13} aria-hidden /> Company-wide
            </span>
            <p className="m-0 text-[11.5px] text-faint">Text, Markdown, CSV, JSON or HTML files</p>
          </div>
        )}

        {dialog && (
          <AddSourcesDialog
            sources={sources}
            reading={reading}
            onFiles={addFiles}
            onLink={addLink}
            onDrive={() => void navigate({ to: '/control-panel/$section', params: { section: 'connectors' } })}
            onClose={() => setDialog(false)}
          />
        )}
      </div>

      {panelOpen && (
        <AskPanel
          turns={turns}
          memoryCount={live.length}
          nameOf={nameOf}
          onSend={ask}
          onClose={() => onPanelOpen(false)}
          onNew={() => {
            setTurns([])
            setHighlight(null)
          }}
          onSave={saveProposal}
          onPick={(id) => setSelected(id)}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}
