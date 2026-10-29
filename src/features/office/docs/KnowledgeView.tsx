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
import type { Model } from '../../../core/domain/types'
import { Composer } from '../../../ui/ChatSession/Composer'
import { DEFAULT_MODEL } from '../../../ui/ChatSession/ModelMenu'
import { Mascot } from '../../../ui/ds/Mascot'
import { useHideChiefFab } from '../../chief-dm'
import type { MenuEntries } from '../../../ui/ds/ItemMenu'
import { notify } from '../../../ui/ds/Toaster'
import { NetworkGraph } from './graph/NetworkGraph'
import type { FileKind, GEdge, GNode } from './graph/NetworkGraph'
import { AGENT_NAME, DEPLOY_ANSWER, KNOW_EDGES, KNOW_FRAME, KNOW_NODES, SOURCE_SLOTS, TAG_COLOR } from './graph/graphData'
import type { KnowNode, MemTag } from './graph/graphData'

type Filter = 'all' | MemTag

interface Source {
  id: string
  /** Where it sits next to Company facts */
  slot: { x: number; y: number }
  name: string
  file: FileKind
  /** 0–1 */
  progress: number
  pages?: number
  done: boolean
  facts: string[]
  skipped: number
}

interface Turn {
  id: string
  role: 'you' | 'chief'
  text: string
  /** Memory ids Chief cites, numbered in order */
  cites?: string[]
  /** A lesson Chief proposes to save or change */
  proposal?: { kind: 'update' | 'new'; memoryId?: string; text: string; owner: string; saved?: boolean }
}

const BASE_MEMORY_COUNT = KNOW_NODES.length

const SUGGESTIONS = ['What did agents learn this week?', 'Teach: refunds over Rp 2jt go to Dede', 'Forget anything about old pricing']

const FILE_ICON: Record<FileKind, typeof FileText> = { pdf: FileText, xlsx: Sheet, img: ImageIcon, doc: FileText }
const FILE_INK: Record<FileKind, string> = { pdf: 'text-[#DC2626]', xlsx: 'text-ok', img: 'text-[#2563EB]', doc: 'text-[#2563EB]' }

function kindOf(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['xlsx', 'xls', 'csv', 'numbers'].includes(ext)) return 'xlsx'
  if (['pdf'].includes(ext)) return 'pdf'
  if (['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext)) return 'img'
  return 'doc'
}

/** Facts a source yields (mock reader) */
function factsFor(name: string, file: FileKind): string[] {
  if (/harga|sewa/i.test(name)) return ['Hall Rp 250rb / Rp 400rb', 'Deposit Rp 200rb', 'Book ≥ 3 days ahead']
  if (/iuran|sop/i.test(name)) return ['Iuran Rp 25rb / month', 'Late fee after the 10th']
  if (file === 'img') return ['Kerja bakti Sun 07:00']
  return [`From ${name.replace(/\.[^.]+$/, '')}`]
}

const DEFAULT_DROP = ['Harga sewa balai.xlsx', 'SOP Iuran Warga 2026.pdf', 'Papan RT 04.jpg']

function sourceSub(s: Source) {
  if (s.done) return s.file === 'xlsx' ? `${s.facts.length * 4} added · ${s.skipped} skipped` : `${s.facts.length} added`
  if (s.file === 'img') return 'Reading photo'
  if (s.pages) return `Reading p. ${Math.max(1, Math.round(s.progress * s.pages))} of ${s.pages}`
  return 'Reading…'
}

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

function AddSourcesDialog({ sources, onFiles, onClose }: { sources: Source[]; onFiles: (names: string[]) => void; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0C0A0933] animate-in fade-in-0" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Add to company knowledge" className="flex w-[580px] max-w-[calc(100%-32px)] flex-col rounded-[16px] bg-surface shadow-[0_24px_60px_#0C0A0933] outline-1 -outline-offset-1 outline-line-strong">
        <div className="flex gap-[12px] px-[20px] pt-[18px] pb-[14px]">
          <span className="flex size-[36px] shrink-0 items-center justify-center rounded-base bg-soft outline-1 -outline-offset-1 outline-line-strong">
            <Building2 size={16} aria-hidden className="text-ink-2" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <h2 className="m-0 font-display text-[18px] font-semibold text-ink [font-variation-settings:'opsz'_96]">Add to company knowledge</h2>
            <p className="m-0 text-[13px] text-muted">Drop documents or photos. Chief reads them and adds the facts, rules and prices it finds. Undo any time.</p>
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
              onFiles([...e.dataTransfer.files].map((f) => f.name))
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
            <p className="m-0 text-[11.5px] text-faint">PDF, Word, Excel, slides · photos and scans (JPG, PNG, HEIC) · up to 50 MB each</p>
            <div className="mt-[4px] flex gap-[6px]">
              <button type="button" onClick={() => notify('Connect Google Drive in Control panel → Connectors')} className="flex h-[28px] items-center gap-[6px] rounded-btn bg-surface px-[10px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft">
                <HardDrive size={13} aria-hidden /> From Google Drive
              </button>
              <button type="button" onClick={() => onFiles(['Link · rangka.co/harga'])} className="flex h-[28px] items-center gap-[6px] rounded-btn bg-surface px-[10px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft">
                <Link2 size={13} aria-hidden /> Paste a link
              </button>
            </div>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              aria-label="Choose files"
              onChange={(e) => {
                onFiles([...(e.target.files ?? [])].map((f) => f.name))
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
          {sources.length > 0 && (
            <ul className="m-0 flex list-none flex-col rounded-lg p-0 outline-1 -outline-offset-1 outline-line-strong">
              {sources.map((s, i) => {
                const Icon = FILE_ICON[s.file]
                return (
                  <li key={s.id} className={`flex items-center gap-[10px] px-[12px] py-[10px] ${i < sources.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}>
                    <span className="flex size-[30px] items-center justify-center rounded-base outline-1 -outline-offset-1 outline-line-strong">
                      <Icon size={15} aria-hidden className={FILE_INK[s.file]} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <span className="truncate text-[13px] font-medium text-ink">{s.name}</span>
                      {s.done ? (
                        <span className="text-[11.5px] text-muted">{sourceSub(s)}</span>
                      ) : (
                        <span className="flex items-center gap-[8px]">
                          <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-app">
                            <span className="block h-full rounded-full bg-[#2563EB] transition-all" style={{ width: `${Math.round(s.progress * 100)}%` }} />
                          </span>
                          <span className="text-[11.5px] whitespace-nowrap text-muted">{sourceSub(s)}</span>
                        </span>
                      )}
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
          <span className="flex-1 text-[12.5px] text-muted">Runs on Quick steps · about Rp 400 for these files</span>
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
  memories,
  onSend,
  onClose,
  onNew,
  onSave,
  onPick,
  placeholder,
}: {
  turns: Turn[]
  memories: Map<string, KnowNode>
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
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' })
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
                  Chief <span className="text-[11.5px] font-normal text-faint">read {51 + memories.size - BASE_MEMORY_COUNT} memories · now</span>
                </span>
                <p className="m-0 text-[13px] leading-[19px] text-ink-2">{t.text}</p>
                {t.cites && (
                  <ol className="m-0 flex list-none flex-col p-0">
                    {t.cites.map((id, i) => {
                      const m = memories.get(id)
                      if (!m) return null
                      return (
                        <li key={id}>
                          <button type="button" onClick={() => onPick(id)} className="flex h-[27px] w-full items-center gap-[8px] rounded-sm px-[2px] text-left hover:bg-soft">
                            <span className="flex size-[16px] shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-semibold text-white">{i + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{m.label}</span>
                            {m.review && <span className="rounded-xs bg-[#FFEDD5] px-[5px] text-[11px] font-medium text-[#C2410C]">Review</span>}
                            <span className="text-[11.5px] text-faint">{AGENT_NAME[m.owner ?? 'hub']}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                )}
                {t.proposal && (
                  <div className="flex flex-col gap-[10px] rounded-lg p-[14px] outline-1 -outline-offset-1 outline-line-strong">
                    <span className="flex items-center gap-[10px] text-[13.5px] font-semibold text-ink">
                      <span className="flex size-[28px] items-center justify-center rounded-base bg-[#FEF2F2]">
                        <Lightbulb size={15} aria-hidden className="text-[#DC2626]" />
                      </span>
                      {t.proposal.kind === 'update' ? `Update ${AGENT_NAME[t.proposal.owner]}’s lesson?` : `Save a lesson for ${AGENT_NAME[t.proposal.owner]}?`}
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
                        “{t.proposal.text}” {t.proposal.kind === 'update' ? 'Replaces the old version; Chief uses it from the next run.' : 'Agents use it from the next run.'}
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
  const [filter, setFilter] = useState<Filter>('all')
  const [base, setBase] = useState<KnowNode[]>(KNOW_NODES)
  const [extraEdges, setExtraEdges] = useState<GEdge[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [reviewCard, setReviewCard] = useState<string | null>('m-deploys')
  const [editingReview, setEditingReview] = useState(false)
  const [owner, setOwner] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [sources, setSources] = useState<Source[]>([])
  const [readingOpen, setReadingOpen] = useState(true)
  const [sourcesCard, setSourcesCard] = useState(false)
  /** Source whose facts are shown in the graph (n8N6dT) */
  const [expanded, setExpanded] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [dialog, setDialog] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [highlight, setHighlight] = useState<{ ids: string[]; about: string } | null>(null)
  const [model, setModel] = useState<Model>(DEFAULT_MODEL)
  const [placeholder, setPlaceholder] = useState('Ask or teach — “Remember that…”')
  const dragDepth = useRef(0)
  useHideChiefFab(true)

  // Topbar "Teach something" (the board opens the panel) — get ready to teach
  const [seenTeach, setSeenTeach] = useState(teachSignal)
  if (seenTeach !== teachSignal) {
    setSeenTeach(teachSignal)
    setPlaceholder('Remember that…')
  }

  const reviews = base.filter((n) => n.review)
  const firstReview = reviews[0]?.id

  // ── Reading sources (mock reader ticks) ──
  const reading = sources.some((s) => !s.done)
  useEffect(() => {
    if (!reading) return
    const t = setInterval(() => {
      setSources((list) =>
        list.map((s) => {
          if (s.done) return s
          const step = s.file === 'xlsx' ? 0.35 : s.file === 'img' ? 0.12 : 0.08
          const progress = Math.min(1, s.progress + step)
          return { ...s, progress, done: progress >= 1 }
        }),
      )
    }, 450)
    return () => clearInterval(t)
  }, [reading])

  // When a source finishes, its facts join the graph
  const announced = useRef(new Set<string>())
  useEffect(() => {
    for (const s of sources) {
      if (!s.done || announced.current.has(s.id)) continue
      announced.current.add(s.id)
      const at = s.slot
      const facts: KnowNode[] = s.facts.map((label, i) => ({
        id: `${s.id}-f${i}`,
        kind: 'memory',
        label,
        x: at.x + [51, 66, 36][i % 3],
        y: at.y + [-40, 5, 50][i % 3],
        tag: 'fact',
        owner: 'hub',
        color: TAG_COLOR.fact,
        emphasis: 'new',
        source: s.name,
        spawnFrom: s.id,
      }))
      setBase((b) => [...b, ...facts])
      setExtraEdges((e) => [...e, ...facts.map((f) => ({ from: s.id, to: f.id, tone: 'new' as const }))])
      setToast(`${s.facts.length * (s.file === 'xlsx' ? 4 : 1)} fact${s.facts.length * (s.file === 'xlsx' ? 4 : 1) === 1 ? '' : 's'} added from ${s.name}${s.skipped ? ` · ${s.skipped} skipped (Handbook wins)` : ''}`)
    }
  }, [sources])


  function addFiles(names: string[]) {
    const list = (names.length ? names : DEFAULT_DROP).slice(0, 5)
    const used = new Set(sources.map((s) => `${s.slot.x},${s.slot.y}`))
    const prefer: Record<FileKind, number> = { xlsx: 1, pdf: 0, img: 2, doc: 3 }
    const next: Source[] = list.map((name, i) => {
      const file = kindOf(name)
      const order = [prefer[file], ...SOURCE_SLOTS.keys()]
      const slotIdx = order.find((j) => !used.has(`${SOURCE_SLOTS[j].x},${SOURCE_SLOTS[j].y}`)) ?? (sources.length + i) % SOURCE_SLOTS.length
      const slot = SOURCE_SLOTS[slotIdx]
      used.add(`${slot.x},${slot.y}`)
      return {
        slot,
        id: `src-${Date.now().toString(36)}-${i}`,
        name,
        file,
        progress: file === 'xlsx' ? 0.6 : file === 'pdf' ? 0.55 : 0.2,
        pages: file === 'pdf' ? 14 : undefined,
        done: false,
        facts: factsFor(name, file),
        skipped: file === 'xlsx' ? 1 : 0,
      }
    })
    setSources((s) => [...s, ...next])
    setReadingOpen(true)
    setSourcesCard(false)
    setReviewCard(null)
  }

  function removeSource(id: string) {
    const s = sources.find((x) => x.id === id)
    setSources((list) => list.filter((x) => x.id !== id))
    setBase((b) => b.filter((n) => !n.id.startsWith(`${id}-f`)))
    setExtraEdges((e) => e.filter((x) => x.from !== id))
    announced.current.delete(id)
    if (expanded === id) setExpanded(null)
    if (s) notify(`Removed ${s.name} and its facts`)
  }

  // ── Memories ──
  function confirm(id: string) {
    setBase((b) => b.map((n) => (n.id === id ? { ...n, review: false } : n)))
    const next = base.find((n) => n.review && n.id !== id)
    setReviewCard(next?.id ?? null)
    setEditingReview(false)
    notify('Lesson confirmed — agents use it from the next run')
  }
  function forget(id: string) {
    const n = base.find((x) => x.id === id)
    if (!n) return
    setBase((b) => b.filter((x) => x.id !== id))
    if (reviewCard === id) setReviewCard(base.find((x) => x.review && x.id !== id)?.id ?? null)
    if (selected === id) setSelected(null)
    notify(`Forgot “${n.label}”`, () => setBase((b) => [...b, n]))
  }
  function rename(id: string, label: string) {
    if (label.trim()) setBase((b) => b.map((n) => (n.id === id ? { ...n, label: label.trim() } : n)))
  }

  // ── Ask & teach ──
  function ask(text: string) {
    const id = `t${Date.now()}`
    const you: Turn = { id: `${id}y`, role: 'you', text }
    let reply: Turn
    if (/^(remember|teach)/i.test(text)) {
      const body = text.replace(/^(remember( that)?|teach)[:\s]*/i, '')
      const touches = /deploy|hotfix|21:00/i.test(body)
      reply = touches
        ? { id, role: 'chief', text: 'That refines lesson 1. Here’s the update — save it?', proposal: { kind: 'update', memoryId: 'm-deploys', text: `Don’t propose deploys after 21:00 — unless it’s a P0 hotfix.`, owner: 'chief' } }
        : { id, role: 'chief', text: 'Got it. I’ll keep this as a lesson for Chief — save it?', proposal: { kind: 'new', text: body.charAt(0).toUpperCase() + body.slice(1), owner: 'chief' } }
    } else if (/^forget/i.test(text)) {
      const word = text.replace(/^forget( anything)?( about)?/i, '').trim().toLowerCase()
      const hits = base.filter((n) => n.kind === 'memory' && word && word.split(' ').some((w) => w.length > 3 && n.label.toLowerCase().includes(w)))
      reply = hits.length
        ? { id, role: 'chief', text: `I found ${hits.length} — right-click one in the graph to forget it.`, cites: hits.map((h) => h.id) }
        : { id, role: 'chief', text: `Nothing about “${word || text}” is in memory — nothing to forget.` }
      setHighlight(hits.length ? { ids: hits.map((h) => h.id), about: word } : null)
    } else {
      const cites = DEPLOY_ANSWER.filter((m) => base.some((n) => n.id === m))
      reply = { id, role: 'chief', text: 'Six things — mostly from your Inbox decisions and the #482 postmortem:', cites }
      setHighlight({ ids: cites, about: /deploy/i.test(text) ? 'deploys' : 'this' })
    }
    setTurns((t) => [...t, you, reply])
    onPanelOpen(true)
    setReviewCard(null)
  }

  function saveProposal(turnId: string, text: string) {
    const t = turns.find((x) => x.id === turnId)
    if (!t?.proposal) return
    const p = t.proposal
    if (p.kind === 'update' && p.memoryId) {
      rename(p.memoryId, text.length > 34 ? 'Deploys not after 21:00 (P0 ok)' : text)
      setBase((b) => b.map((n) => (n.id === p.memoryId ? { ...n, review: false } : n)))
    } else {
      const id = `m-new-${Date.now()}`
      const chief = base.find((n) => n.id === 'chief')!
      setBase((b) => [
        ...b,
        { id, kind: 'memory', label: text.length > 32 ? `${text.slice(0, 30)}…` : text, x: chief.x + 40, y: chief.y - 70, tag: 'lesson', owner: 'chief', color: TAG_COLOR.lesson, emphasis: 'new', source: 'You taught it · now', spawnFrom: 'chief' },
      ])
      setExtraEdges((e) => [...e, { from: 'chief', to: id }])
    }
    setTurns((list) => list.map((x) => (x.id === turnId ? { ...x, proposal: { ...p, text, saved: true } } : x)))
    notify('Lesson saved')
  }

  // ── Graph model ──
  const memories = useMemo(() => new Map(base.map((n) => [n.id, n])), [base])
  const nodes: GNode[] = useMemo(() => {
    const cites = highlight?.ids ?? []
    const fileNodes: GNode[] = sources
      .filter((s) => !expanded || s.id === expanded)
      .map((s) => ({
        id: s.id,
        kind: 'file',
        label: s.name,
        file: s.file,
        ...s.slot,
        progress: s.done ? 1 : s.progress,
        sub: expanded ? undefined : sourceSub(s),
        subTone: s.done ? 'ok' : 'info',
        labelSide: expanded ? 'below' : 'right',
        spawnFrom: 'hub',
      }))
    const isFact = (id: string) => id.startsWith('src-')
    return [
      ...base.filter((n) => !isFact(n.id) || (expanded && n.id.startsWith(`${expanded}-f`))).map((n) => ({
        ...n,
        emphasis: n.emphasis === 'new' ? n.emphasis : n.review ? (n.id === (reviewCard ?? firstReview) ? 'review' : 'halo') : undefined,
        badge: cites.includes(n.id) ? cites.indexOf(n.id) + 1 : undefined,
      })) as GNode[],
      ...fileNodes,
    ]
  }, [base, sources, reviewCard, highlight, firstReview, expanded])

  const edges = useMemo(
    () => [...KNOW_EDGES, ...sources.map((s) => ({ from: 'hub', to: s.id, tone: 'source' as const })), ...extraEdges],
    [sources, extraEdges],
  )
  function showSource(id: string | null) {
    setExpanded(id)
    setSelected(id)
    if (id) setSourcesCard(true)
  }

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
    if (owner) return new Set(base.filter((n) => n.id === owner || n.owner === owner || n.kind === 'hub').map((n) => n.id))
    if (filter !== 'all')
      return new Set(
        nodes.filter((n) => n.kind !== 'memory' || (n as KnowNode).tag === filter).map((n) => n.id),
      )
    return null
  }, [filter, owner, highlight, base, nodes, memories])

  function menuFor(n: GNode): MenuEntries {
    const k = memories.get(n.id)
    if (n.kind === 'memory' && k) {
      return [
        { type: 'label', label: `${AGENT_NAME[k.owner ?? 'hub']} · ${k.tag}` },
        k.review && { label: 'Confirm', icon: Check, onSelect: () => confirm(k.id) },
        { label: 'Edit', icon: Pencil, onSelect: () => { setReviewCard(k.id); setEditingReview(true) } },
        { label: 'Ask about this', icon: Sparkles, onSelect: () => ask(`What does ${AGENT_NAME[k.owner ?? 'hub']} know about “${k.label}”?`) },
        { label: k.source ? `Learned from: ${k.source}` : 'Show source', icon: MessageSquareText, disabled: true, onSelect: () => {} },
        { type: 'separator' },
        { label: 'Forget', icon: Trash2, danger: true, onSelect: () => forget(k.id) },
      ]
    }
    if (n.kind === 'agent') {
      const name = AGENT_NAME[n.id]
      return [
        { label: owner === n.id ? 'Show everyone' : `Show only ${name}’s memories`, icon: ListChecks, onSelect: () => setOwner(owner === n.id ? null : n.id) },
        { label: `Teach ${name} something`, icon: Lightbulb, onSelect: () => { setPlaceholder(`Remember that… (for ${name})`); onPanelOpen(true) } },
        { label: `Ask what ${name} knows`, icon: Sparkles, onSelect: () => ask(`What has ${name} learned?`) },
        { type: 'separator' },
        { label: 'Open profile', icon: UserRound, onSelect: () => void navigate({ to: '/team/$helperId', params: { helperId: n.id } }) },
      ]
    }
    if (n.kind === 'file') {
      const s = sources.find((x) => x.id === n.id)
      return [
        { label: expanded === n.id ? 'Hide its facts' : 'Show its facts', icon: ListChecks, disabled: !s?.done, onSelect: () => showSource(expanded === n.id ? null : n.id) },
        { type: 'separator' },
        { label: 'Remove source and its facts', icon: Trash2, danger: true, onSelect: () => removeSource(n.id) },
      ]
    }
    return [
      { label: 'Add sources', icon: Upload, onSelect: () => setDialog(true) },
      { label: 'Teach something', icon: Plus, onSelect: () => onPanelOpen(true) },
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
  const doneSources = sources.filter((s) => s.done)

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
          addFiles([...e.dataTransfer.files].map((f) => f.name))
        }}
      >
        <NetworkGraph
          label="Knowledge graph"
          nodes={nodes}
          edges={edges}
          frame={KNOW_FRAME}
          selected={selected}
          onSelect={(id) => {
            const src = id ? sources.find((x) => x.id === id) : undefined
            if (src) return src.done ? showSource(expanded === src.id ? null : src.id) : setSelected(id)
            setSelected(id)
            const m = id ? memories.get(id) : undefined
            if (m?.review) setReviewCard(id)
            else if (id) setReviewCard(null)
          }}
          focus={focus}
          menuFor={menuFor}
          backgroundMenu={[
            { label: 'Add sources', icon: Upload, onSelect: () => setDialog(true) },
            { label: 'Teach something', icon: Plus, onSelect: () => onPanelOpen(true) },
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
                Only {AGENT_NAME[owner]} <X size={12} aria-hidden />
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
                  setReviewCard(reviews[0].id)
                  setSelected(reviews[0].id)
                }}
                className="flex h-[30px] items-center gap-[7px] rounded-full bg-[#FFF7ED] px-[12px] text-[13px] font-medium text-[#C2410C] outline-1 -outline-offset-1 outline-[#FDBA74] hover:bg-[#FFEDD5]"
              >
                <ListChecks size={14} aria-hidden /> {reviews.length} need review <ArrowRight size={13} aria-hidden />
              </button>
            )}
          </div>

          {/* Review / memory card */}
          {shownCard && !sourcesCard && (
            <Card className="top-[84px] left-[15px] w-[270px] px-[12px] pt-[11px] pb-[12px]">
              <div className="flex items-center gap-[6px] text-[12px] text-muted">
                {shownCard.owner && shownCard.owner !== 'hub' ? (
                  <Mascot size={14} radius={4} area={base.find((n) => n.id === shownCard.owner)?.helper ?? 'brand'} still />
                ) : (
                  <Building2 size={13} aria-hidden />
                )}
                {AGENT_NAME[shownCard.owner ?? 'hub']} · {shownCard.tag}
                <span className="flex-1" />
                {shownCard.review && <span className="rounded-xs bg-[#FEF2F2] px-[6px] py-[1px] text-[11px] font-medium text-[#B91C1C]">Needs review</span>}
                {!shownCard.review && (
                  <button type="button" aria-label="Close" onClick={() => { setReviewCard(null); setSelected(null) }} className="text-faint hover:text-ink">
                    <X size={13} aria-hidden />
                  </button>
                )}
              </div>
              {editingReview && reviewCard === shownCard.id ? (
                <input
                  autoFocus
                  aria-label="Memory text"
                  defaultValue={shownCard.label}
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
                <p className="m-0 mt-[6px] text-[13.5px] font-semibold text-ink">{shownCard.label}</p>
              )}
              <p className="m-0 mt-[3px] text-[12px] text-muted">{shownCard.source}</p>
              <div className="mt-[10px] flex gap-[6px]">
                {shownCard.review && (
                  <button type="button" onClick={() => confirm(shownCard.id)} className="flex h-[28px] items-center gap-[6px] rounded-btn bg-primary px-[10px] text-[12.5px] font-medium text-primary-ink hover:bg-primary-hover">
                    <Check size={13} aria-hidden /> Confirm
                  </button>
                )}
                <button type="button" onClick={() => { setReviewCard(shownCard.id); setEditingReview(true) }} className="h-[28px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft">
                  Edit
                </button>
                <button type="button" onClick={() => forget(shownCard.id)} className="h-[28px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-bad outline-1 -outline-offset-1 outline-line-strong hover:bg-bad-tint">
                  Forget
                </button>
              </div>
            </Card>
          )}

          {/* Sources card (n8N6dT) */}
          {sourcesCard && sources.length > 0 && (
            <Card className="top-[84px] left-[15px] w-[270px] p-[6px]">
              <div className="flex items-center gap-[6px] px-[6px] pt-[4px] pb-[6px]">
                <span className="text-[13px] font-semibold text-ink">Sources</span>
                <span className="text-[11.5px] text-faint">{sources.length}</span>
                <span className="flex-1" />
                <button type="button" aria-label="Add sources" onClick={() => setDialog(true)} className="flex size-[22px] items-center justify-center rounded-xs text-muted hover:bg-hover">
                  <Plus size={14} aria-hidden />
                </button>
                <button type="button" aria-label="Close sources" onClick={() => { setSourcesCard(false); setExpanded(null) }} className="flex size-[22px] items-center justify-center rounded-xs text-muted hover:bg-hover">
                  <X size={13} aria-hidden />
                </button>
              </div>
              {sources.map((s) => {
                const Icon = FILE_ICON[s.file]
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => showSource(s.done ? s.id : null)}
                    className={`flex w-full gap-[8px] rounded-base px-[8px] py-[7px] text-left ${expanded === s.id ? 'bg-[#EFF6FF]' : 'hover:bg-soft'}`}
                  >
                    <Icon size={14} aria-hidden className={`mt-[2px] shrink-0 ${FILE_INK[s.file]}`} />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[12.5px] font-medium text-ink">{s.name}</span>
                      <span className="text-[11.5px] text-[#2563EB]">{s.done ? `${sourceSub(s)} · just now` : sourceSub(s)}</span>
                    </span>
                  </button>
                )
              })}
            </Card>
          )}

          {/* Reading panel (cUtde) */}
          {sources.length > 0 && !sourcesCard && (
            <Card className="top-[56px] right-[16px] w-[283px]">
              <button type="button" onClick={() => setReadingOpen((o) => !o)} className="flex h-[36px] w-full items-center gap-[8px] px-[12px] text-left shadow-[inset_0_-1px_0_var(--color-line)]">
                {reading ? <Spinner /> : <CircleCheck size={14} aria-hidden className="text-ok" />}
                <span className="flex-1 text-[13px] font-semibold text-ink">
                  {reading ? `Reading ${sources.filter((s) => !s.done).length} file${sources.filter((s) => !s.done).length > 1 ? 's' : ''}` : `Read ${sources.length} files`}
                </span>
                {readingOpen ? <ChevronUp size={14} aria-hidden className="text-muted" /> : <ChevronDown size={14} aria-hidden className="text-muted" />}
              </button>
              {readingOpen && (
                <>
                  <ul className="m-0 list-none p-0">
                    {sources.map((s) => {
                      const Icon = FILE_ICON[s.file]
                      return (
                        <li key={s.id}>
                          <button type="button" onClick={() => (s.done ? showSource(s.id) : setSelected(s.id))} className="flex w-full items-center gap-[9px] px-[12px] py-[7px] text-left hover:bg-soft">
                            <Icon size={14} aria-hidden className={`shrink-0 ${FILE_INK[s.file]}`} />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-[12.5px] font-medium text-ink">{s.name}</span>
                              <span className="truncate text-[11.5px] text-muted">{s.done && s.skipped ? `${sourceSub(s)}, Handbook wins` : sourceSub(s)}</span>
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
              {toast}
              <button
                type="button"
                onClick={() => {
                  const last = doneSources.at(-1)
                  if (last) removeSource(last.id)
                  setToast(null)
                }}
                className="text-on-ink-2 hover:text-white"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => {
                  const last = doneSources.at(-1)
                  if (last) showSource(last.id)
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
            <p className="m-0 text-[13px] text-muted">Chief reads documents and photos and adds what it finds to company knowledge.</p>
            <span className="mt-[4px] flex h-[26px] items-center gap-[6px] rounded-full bg-surface px-[10px] text-[12.5px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong">
              <Building2 size={13} aria-hidden /> Company-wide
            </span>
            <p className="m-0 text-[11.5px] text-faint">PDF, Word, Excel, slides · photos and scans · up to 50 MB each</p>
          </div>
        )}

        {dialog && <AddSourcesDialog sources={sources} onFiles={addFiles} onClose={() => setDialog(false)} />}
      </div>

      {panelOpen && (
        <AskPanel
          turns={turns}
          memories={memories}
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
