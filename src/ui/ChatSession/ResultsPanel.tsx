/**
 * ResultsPanel — the 340px card beside the chat (pen `Chat · Session + Results` SP6gy):
 * Progress → Outputs → Context. Also:
 *   - DropOverlay over the chat card while files are dragged in (Zdjc7)
 *   - PreviewDrawer: an output opened over a scrim (CnBzj)
 */

import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import type { ComponentType } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { Connector, SessionOutput, SessionStep } from '../../core/domain/types'
import { useConnectors, useCreateDoc, useSessionResults } from '../../app/queries'
import { notify } from '../ds/Toaster'
import {
  ArrowUpRight,
  ChevronDown,
  Circle,
  CircleCheck,
  CircleAlert,
  Download,
  FileText,
  FoldVertical,
  FolderPlus,
  LoaderCircle,
  MessageCircle,
  Notebook,
  Pin,
  Plus,
  Target,
  X,
} from 'lucide-react'
import { IconButton } from '../ds/Button'
import { Mascot } from '../ds/Mascot'
import { Ring } from './Ring'
import { EmptyState } from '../ds/EmptyState'

type Icon = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>

/** lucide `github` (brand icons are not shipped by lucide-react). */
function Github({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function SectionHead({
  title,
  open = true,
  onToggle,
  action,
}: {
  title: string
  open?: boolean
  onToggle?: () => void
  action?: React.ReactNode
}) {
  return (
    <div className="flex w-full items-center gap-[6px]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-[6px] text-left"
      >
        <h3 className="m-0 text-[13px] font-semibold text-ink">{title}</h3>
        <ChevronDown
          size={14}
          aria-hidden
          className={`text-muted transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {action && (
        <>
          <span className="h-px flex-1" />
          {action}
        </>
      )}
    </div>
  )
}

function Chip({ icon: I, label }: { icon: Icon; label: string }) {
  return (
    <span className="inline-flex items-center gap-[5px] rounded-pill bg-soft px-[9px] py-[4px] outline-1 -outline-offset-1 outline-line">
      <I size={12} aria-hidden className="text-ink-2" />
      <span className="text-[12px] text-ink-2">{label}</span>
    </span>
  )
}

function StepState({ state }: { state: SessionStep['status'] }) {
  if (state === 'done') return <CircleCheck size={16} aria-hidden className="shrink-0 text-ok" />
  if (state === 'running' || state === 'waiting') return <LoaderCircle size={16} aria-hidden className="shrink-0 text-info" />
  if (state === 'failed') return <CircleAlert size={16} aria-hidden className="shrink-0 text-bad" />
  return <Circle size={16} aria-hidden className="shrink-0 text-faint" />
}

function stepMeta(s: SessionStep): string {
  if (s.status === 'running') return `${s.helper} · working`
  if (s.status === 'waiting') return `${s.helper} · waiting on you`
  if (s.status === 'failed') return `${s.helper} · failed`
  if (s.durationS != null) return s.durationS < 60 ? `${s.durationS}s` : `${Math.round(s.durationS / 60)} min`
  return s.helper
}

function relTime(iso?: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const mins = Math.round((Date.now() - t) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function downloadMarkdown(o: SessionOutput) {
  const blob = new Blob([o.bodyMd], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${o.title.replace(/\s+/g, '-').toLowerCase()}.md`
  a.click()
  URL.revokeObjectURL(url)
}

/** pen `Drop Overlay` (kSbNy) filling the chat card under the topbar, with the drag ghost (Zdjc7). */
function DropOverlay({ onDone }: { onDone: () => void }) {
  return (
    <div
      aria-label="Drop files to add to this message"
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDone()
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDone()
      }}
      className="absolute inset-x-0 top-[44px] bottom-0 z-20 flex flex-col bg-[#FAFAF9B8] p-[12px] backdrop-blur-[6px]"
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-[12px] rounded-md bg-[#EFF6FFB3] p-[16px] outline-[1.5px] -outline-offset-[1.5px] outline-info-line">
        <Mascot helper size={64} radius={18} area="brand" mood="happy" style={{ boxShadow: '0 6px 16px #6366F129' }} />
        <p className="m-0 text-[15px] font-semibold text-ink">Drop files to add to this message</p>
        <p className="m-0 text-[12px] text-muted">PDF, images, docs, sheets · up to 25 MB each</p>
      </div>
    </div>
  )
}

/** Output preview drawer over a scrim (pen CnBzj `Preview Drawer` EPRgt). */
function PreviewDrawer({
  output,
  onOpenChange,
  onAskChange,
}: {
  output: SessionOutput | null
  onOpenChange: (o: boolean) => void
  onAskChange?: (helper: string, title: string) => void
}) {
  const navigate = useNavigate()
  const createDoc = useCreateDoc()
  return (
    <Dialog.Root open={output !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#0C0A0926]" />
        {output && (
          <Dialog.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="fixed top-[8px] right-[8px] bottom-[8px] z-50 flex w-[620px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-dialog bg-surface outline-1 -outline-offset-1 outline-line-strong shadow-[0_24px_64px_#0C0A0940]"
          >
            <div className="flex w-full items-center gap-[12px] py-[14px] pr-[12px] pl-[20px] shadow-[inset_0_-1px_0_var(--color-line)]">
              <span className="flex size-[32px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
                <FileText size={16} aria-hidden className="text-ink-2" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <Dialog.Title className="m-0 truncate text-[16px] font-semibold text-ink">{output.title}</Dialog.Title>
                <span className="text-[12.5px] text-muted">
                  Report · written by {output.helper}
                  {output.createdAt ? ` · ${relTime(output.createdAt)}` : ''}
                </span>
              </div>
              <IconButton icon={Download} aria-label="Download" onClick={() => downloadMarkdown(output)} />
              <Dialog.Close asChild>
                <IconButton icon={X} aria-label="Close preview" />
              </Dialog.Close>
            </div>

            <div className="flex min-h-0 w-full flex-1 flex-col gap-[12px] overflow-y-auto px-[32px] py-[20px]">
              <h2 className="m-0 font-display text-[22px] font-semibold text-ink">{output.title}</h2>
              <p className="m-0 text-[13.5px] leading-[1.6] whitespace-pre-wrap text-ink-2">
                {output.bodyMd || 'This report has no body.'}
              </p>
            </div>

            <div className="flex w-full items-center gap-[8px] px-[20px] py-[12px] shadow-[inset_0_1px_0_var(--color-line)]">
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false)
                  onAskChange?.(output.helper, output.title)
                }}
                className="inline-flex h-[32px] items-center gap-[6px] rounded-btn px-[14px] text-[13px] text-muted hover:bg-hover"
              >
                <MessageCircle size={16} aria-hidden />
                Ask {output.helper} to change something
              </button>
              <span className="h-px flex-1" />
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false)
                  void navigate({ to: '/docs' })
                }}
                className="inline-flex h-[32px] items-center gap-[6px] rounded-btn bg-surface px-[14px] text-[13px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
              >
                <ArrowUpRight size={16} aria-hidden />
                Open in Docs
              </button>
              <button
                type="button"
                disabled={createDoc.isPending}
                onClick={() =>
                  createDoc.mutate(
                    { title: output.title, content: output.bodyMd },
                    {
                      onSuccess: () => notify(`“${output.title}” pinned to Docs`),
                      onError: () => notify('Couldn’t pin to Docs — try again'),
                    },
                  )
                }
                className="inline-flex h-[32px] items-center gap-[6px] rounded-btn bg-primary px-[14px] text-[13px] font-medium text-primary-ink outline-1 -outline-offset-1 outline-primary hover:bg-primary-hover disabled:opacity-60"
              >
                <Pin size={16} aria-hidden />
                Pin to Docs
              </button>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export interface ResultsPanelProps {
  /** Chat whose results are shown (GET /v1/sessions/{id}/results). */
  sessionId: string
  onClose?: () => void
  /** Files are being dragged in: "Files in this chat" lights up (Zdjc7). */
  highlightFiles?: boolean
  /** Open with the first output's preview drawer showing (CnBzj). */
  initialPreview?: boolean
  /** Share of the context window in use, 0–100. */
  contextUsed?: number
  /** Model label for the context card, e.g. "Opus 5.5". */
  modelLabel?: string
  /** Compact the context now. */
  onCompact?: () => void
  /** Files attached to the chat or its folder. */
  files?: string[]
  /** Linked goal title. */
  goal?: string
  /** "Ask <helper> to change something" from an output preview. */
  onAskChange?: (helper: string, title: string) => void
}

const CONTEXT_WINDOW_K = 200

export function ResultsPanel({
  sessionId,
  highlightFiles = false,
  initialPreview = false,
  contextUsed = 0,
  modelLabel,
  onCompact,
  files = [],
  goal,
  onAskChange,
}: ResultsPanelProps) {
  const { data: results, isLoading, isError } = useSessionResults(sessionId)
  const { data: connectors = [] } = useConnectors()
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewOpenedInitially, setPreviewOpenedInitially] = useState(false)
  // Each panel section collapses on its header; all open by default.
  const [open, setOpen] = useState({ progress: true, outputs: true, context: true })
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }))

  const steps = results?.steps ?? []
  const outputs = results?.outputs ?? []
  const done = steps.filter((s) => s.status === 'done').length
  // Design state: open the first output's preview once it has loaded.
  if (initialPreview && !previewOpenedInitially && outputs[0]) {
    setPreviewOpenedInitially(true)
    setPreviewId(outputs[0].id)
  }
  const preview = outputs.find((o) => o.id === previewId) ?? null
  const live: Connector[] = connectors.filter((c) => c.enabled)
  const usedK = Math.round((contextUsed / 100) * CONTEXT_WINDOW_K)

  return (
    <aside
      aria-label="Results"
      data-testid="results-panel"
      className="ml-[6px] flex min-h-0 w-[340px] shrink-0 flex-col overflow-y-auto rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong"
    >
      <section className="flex w-full flex-col gap-[12px] px-[18px] py-[16px] shadow-[inset_0_-1px_0_var(--color-line)]">
        <SectionHead title="Progress" open={open.progress} onToggle={() => toggle('progress')} />
        {open.progress && (isLoading ? (
          <span className="text-[12.5px] text-muted">Loading…</span>
        ) : isError ? (
          <EmptyState size="sm" mood="worried" title="Couldn’t load progress" />
        ) : steps.length === 0 ? (
          <EmptyState
            size="sm"
            title="No helper work yet"
            description="When Chief hands part of this chat to a helper, its steps and results show up here."
          />
        ) : (
          <>
            <div className="flex w-full flex-col gap-[10px]">
              {steps.map((s) => (
                <div key={s.id} className="flex w-full items-center gap-[10px]">
                  <StepState state={s.status} />
                  <span className={`min-w-0 flex-1 truncate text-[12.5px] ${s.status === 'pending' ? 'text-muted' : 'text-ink'}`}>{s.label}</span>
                  <span className="shrink-0 text-[11.5px] text-faint">{stepMeta(s)}</span>
                </div>
              ))}
            </div>
            <span className="text-[11.5px] text-muted">
              {done} of {steps.length} step{steps.length === 1 ? '' : 's'} done
            </span>
          </>
        ))}
      </section>

      <section className="flex w-full flex-col gap-[12px] px-[18px] py-[16px] shadow-[inset_0_-1px_0_var(--color-line)]">
        <SectionHead title="Outputs" open={open.outputs} onToggle={() => toggle('outputs')} />
        {open.outputs && (
        <>
        {!isLoading && outputs.length === 0 && (
          <span className="text-[12.5px] text-muted">Reports and docs helpers write here show up in this list.</span>
        )}
        {outputs.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setPreviewId(o.id)}
            className="flex w-full items-center gap-[10px] rounded-md p-[8px] text-left outline-1 -outline-offset-1 outline-line transition-colors hover:bg-soft"
          >
            <span className="flex size-[32px] shrink-0 items-center justify-center rounded-sm bg-soft">
              <FileText size={16} aria-hidden className="text-ink-2" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="truncate text-[12.5px] font-medium text-ink">{o.title}</span>
              <span className="text-[11.5px] text-muted">
                Report · {o.helper}
                {o.createdAt ? ` · ${relTime(o.createdAt)}` : ''}
              </span>
            </span>
            <ArrowUpRight size={15} aria-hidden className="shrink-0 text-muted" />
          </button>
        ))}
        </>
        )}
      </section>

      <section className="flex w-full flex-col gap-[12px] px-[18px] py-[16px]">
        <SectionHead
          title="Context"
          open={open.context}
          onToggle={() => toggle('context')}
          action={
            <button type="button" aria-label="Add context" className="text-muted hover:text-ink-2">
              <FolderPlus size={15} aria-hidden />
            </button>
          }
        />
        {open.context && (
        <>
        <div className="flex w-full items-center gap-[10px] rounded-md px-[12px] py-[10px] outline-1 -outline-offset-1 outline-line">
          <Ring size={28} value={contextUsed} inner={0.74} />
          <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
            <span className="text-[12.5px] font-semibold text-ink">
              {usedK}k / {CONTEXT_WINDOW_K}k · {contextUsed}%
            </span>
            <span className="text-[11.5px] text-muted">{modelLabel ? `${modelLabel} · ` : ''}auto at 85%</span>
          </span>
          <button type="button" aria-label="Compact" onClick={onCompact} className="flex size-[28px] items-center justify-center rounded-btn text-muted hover:bg-hover">
            <FoldVertical size={16} aria-hidden />
          </button>
        </div>
        <div className="flex w-full flex-col gap-[8px]">
          <span className="text-[11.5px] text-muted">Connectors</span>
          {live.length ? (
            <div className="flex flex-wrap gap-[6px]">
              {live.map((c) => (
                <Chip key={c.id} icon={/github/i.test(c.pieceId) ? Github : Notebook} label={c.label} />
              ))}
            </div>
          ) : (
            <span className="text-[12px] text-faint">No connectors on yet.</span>
          )}
        </div>
        <div
          className={`flex w-full flex-col gap-[8px] ${
            highlightFiles ? 'rounded-md bg-info-tint p-[10px] outline-[1.5px] -outline-offset-[1.5px] outline-info-line' : ''
          }`}
        >
          <span className="text-[11.5px] text-muted">Files in this chat</span>
          {files.length ? (
            <div className="flex flex-wrap gap-[6px]">
              {files.map((f) => (
                <Chip key={f} icon={FileText} label={f} />
              ))}
            </div>
          ) : (
            !highlightFiles && <span className="text-[12px] text-faint">No files yet.</span>
          )}
          {highlightFiles && (
            <span className="inline-flex h-[23px] w-fit items-center gap-[4px] rounded-sm bg-surface px-[8px] outline-1 -outline-offset-1 outline-info-line">
              <Plus size={12} aria-hidden className="text-info" />
              <span className="text-[12px] font-medium text-info">Drop to attach</span>
            </span>
          )}
        </div>
        {goal && (
          <div className="flex w-full flex-col gap-[8px]">
            <span className="text-[11.5px] text-muted">Goal</span>
            <div className="flex gap-[6px]">
              <Chip icon={Target} label={goal} />
            </div>
          </div>
        )}
        </>
        )}
      </section>

      <PreviewDrawer output={preview} onOpenChange={(o) => { if (!o) setPreviewId(null) }} onAskChange={onAskChange} />
    </aside>
  )
}

ResultsPanel.DropOverlay = DropOverlay
