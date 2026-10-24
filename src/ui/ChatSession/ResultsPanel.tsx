/**
 * ResultsPanel — right-hand artifact/output panel (pen ref SP6gy / CnBzj).
 *
 * Split pane state: session thread on the left, this panel on the right.
 * Hosts two sub-states:
 *   - Default list view  (SP6gy)
 *   - Output preview     (CnBzj) — toggled when the user clicks an output item.
 *
 * Also provides the drag-drop overlay (Zdjc7).
 */

import { useState } from 'react'
import { ArrowUpRight, CheckCircle2, ChevronRight, Circle, Clock, ExternalLink, FileSpreadsheet, FileText, ImageIcon, Pin, UploadCloud, X } from 'lucide-react'
import { IconButton } from '../ds/Button'

// ── Types ────────────────────────────────────────────────────────────────────

interface OutputItem {
  id: string
  title: string
  kind: 'doc' | 'sheet' | 'image'
  meta: string
}

interface ProgressStep {
  label: string
  status: 'done' | 'running' | 'pending'
  time?: string
}

// ── Mock data (matches SP6gy / CnBzj) ────────────────────────────────────────

const PROGRESS_STEPS: ProgressStep[] = [
  { label: 'Audit current login flow',       status: 'done',    time: '1m' },
  { label: 'Draft rollout plan',             status: 'done',    time: '8m' },
  { label: 'Write migration doc for Support', status: 'running' },
  { label: 'Schedule staged rollout',        status: 'pending' },
]

const OUTPUT_ITEMS: OutputItem[] = [
  { id: 'out-1', title: 'Passkey rollout plan',    kind: 'doc',   meta: 'Doc · 1.2k views' },
  { id: 'out-2', title: 'login-funnel-audit.csv',  kind: 'sheet', meta: 'Sheet · 1.2k rows' },
  { id: 'out-3', title: 'rollout-timeline.png',    kind: 'image', meta: 'Image · 1800×808' },
]

// Simulated document preview body (CnBzj)
const PREVIEW_BODY = `Goal: passwordless login for 80% of active users by Q4 code freeze (Nov 28).

**Timeline**

| Phase                | Who    | When        |
|----------------------|--------|-------------|
| Web + iOS WebAuthn   | Dev    | Nov 14      |
| Android fallback     | Dev    | Nov 20      |
| Resident comms       | Grower | Nov 16      |
| 10% → 100% rollout   | Chief  | Nov 21–28   |

**Risks**

Legacy Android (< v9) can't do WebAuthn — keep password + OTP for those 6% of users until they update.`

// ── Sub-components ────────────────────────────────────────────────────────────

function KindIcon({ kind }: { kind: OutputItem['kind'] }) {
  if (kind === 'sheet') return <FileSpreadsheet size={14} aria-hidden className="text-muted" />
  if (kind === 'image') return <ImageIcon size={14} aria-hidden className="text-muted" />
  return <FileText size={14} aria-hidden className="text-muted" />
}

function StepIcon({ status }: { status: ProgressStep['status'] }) {
  if (status === 'done')    return <CheckCircle2 size={13} aria-hidden className="shrink-0 text-ok" />
  if (status === 'running') return <Clock size={13} aria-hidden className="shrink-0 text-warn" />
  return <Circle size={13} aria-hidden className="shrink-0 text-faint" />
}

// Drag-drop overlay (Zdjc7)
function DropOverlay({ onDragLeave }: { onDragLeave: () => void }) {
  return (
    <div
      aria-label="Drop files to add to this message"
      onDragLeave={onDragLeave}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDragLeave}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-[10px] rounded-lg bg-surface/90 backdrop-blur-[2px]"
    >
      <div className="flex flex-col items-center gap-[16px] rounded-lg border-2 border-dashed border-muted/50 px-[48px] py-[40px]">
        <UploadCloud size={40} aria-hidden className="text-muted" />
        <div className="flex flex-col items-center gap-[4px] text-center">
          <p className="m-0 text-[14px] font-medium text-ink">Drop files to add to this message</p>
          <p className="m-0 text-[12.5px] text-muted">PDF, images, docs, sheets · up to 25 MB each</p>
        </div>
      </div>
    </div>
  )
}

// Output preview pane (CnBzj)
function OutputPreview({ item, onClose }: { item: OutputItem; onClose: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Preview header */}
      <div className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
        <KindIcon kind={item.kind} />
        <span className="flex-1 truncate text-[13px] font-medium text-ink">{item.title}</span>
        <button
          type="button"
          aria-label="Open in Docs"
          className="inline-flex items-center gap-[5px] rounded-btn px-[8px] py-[4px] text-[12px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
        >
          <ExternalLink size={12} aria-hidden />
          Open in Docs
        </button>
        <button
          type="button"
          aria-label="Pin to Docs"
          className="inline-flex items-center gap-[5px] rounded-btn px-[8px] py-[4px] text-[12px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
        >
          <Pin size={12} aria-hidden />
          Pin to Docs
        </button>
        <IconButton icon={X} aria-label="Close preview" onClick={onClose} />
      </div>

      {/* Preview body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[20px]">
        <h2 className="m-0 mb-[4px] font-display text-[20px] font-semibold text-ink">{item.title}</h2>
        <p className="m-0 mb-[16px] text-[12.5px] text-muted">{item.meta}</p>
        {/* Markdown-like preview body */}
        <div className="prose prose-sm max-w-none text-[13.5px] leading-[1.6] text-ink-2 whitespace-pre-wrap">
          {PREVIEW_BODY}
        </div>
        {/* Ask Dev bar */}
        <div className="mt-[20px] flex items-center gap-[8px] rounded-base border border-line-strong px-[12px] py-[8px]">
          <input
            placeholder="Ask Dev to change something"
            aria-label="Ask Dev to change something"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
          />
        </div>
      </div>
    </div>
  )
}

// ── Main ResultsPanel ─────────────────────────────────────────────────────────

export interface ResultsPanelProps {
  onClose: () => void
  /** When true, renders the full-panel drag-drop overlay (Zdjc7) */
  isDraggingOver?: boolean
  onDragLeave?: () => void
}

export function ResultsPanel({ onClose, isDraggingOver = false, onDragLeave = () => {} }: ResultsPanelProps) {
  const [previewItem, setPreviewItem] = useState<OutputItem | null>(null)

  const doneCount = PROGRESS_STEPS.filter((s) => s.status === 'done').length

  return (
    <div
      className="relative flex min-h-0 w-[320px] shrink-0 flex-col border-l border-line-strong bg-surface"
      aria-label="Results and artifacts"
      data-testid="results-panel"
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Drop overlay */}
      {isDraggingOver && <DropOverlay onDragLeave={onDragLeave} />}

      {previewItem ? (
        <OutputPreview item={previewItem} onClose={() => setPreviewItem(null)} />
      ) : (
        <>
          {/* Panel header */}
          <div className="flex h-[44px] shrink-0 items-center gap-[6px] border-b border-line px-[16px]">
            <span className="flex-1 text-[13px] font-medium text-ink">Progress</span>
            <button
              type="button"
              className="text-[11.5px] text-muted hover:underline"
            >
              <ChevronRight size={14} aria-hidden className="inline" />
            </button>
            <IconButton icon={X} aria-label="Close results panel" onClick={onClose} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-[14px] py-[12px] flex flex-col gap-[16px]">
            {/* Progress section */}
            <section aria-labelledby="rp-progress">
              <p id="rp-progress" className="m-0 mb-[8px] text-[11px] font-medium uppercase tracking-[0.55px] text-muted">
                Progress <span className="normal-case font-normal tracking-normal text-faint ml-[4px]">↓</span>
              </p>
              <ul className="flex flex-col gap-[6px]">
                {PROGRESS_STEPS.map((step) => (
                  <li key={step.label} className="flex items-center gap-[7px]">
                    <StepIcon status={step.status} />
                    <span className={`flex-1 text-[12.5px] ${step.status === 'pending' ? 'text-muted' : 'text-ink-2'}`}>
                      {step.label}
                    </span>
                    {step.status === 'running' && (
                      <span className="text-[11px] text-warn">working</span>
                    )}
                    {step.time && (
                      <span className="text-[11px] text-faint">{step.time}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-[8px] text-[11.5px] text-faint">{doneCount} of {PROGRESS_STEPS.length} steps done</p>
            </section>

            {/* Outputs section */}
            <section aria-labelledby="rp-outputs">
              <p id="rp-outputs" className="m-0 mb-[8px] text-[11px] font-medium uppercase tracking-[0.55px] text-muted">Outputs</p>
              <ul className="flex flex-col gap-[4px]">
                {OUTPUT_ITEMS.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      className="flex w-full items-center gap-[8px] rounded-sm px-[8px] py-[6px] text-left transition-colors hover:bg-soft"
                    >
                      <KindIcon kind={item.kind} />
                      <div className="min-w-0 flex-1">
                        <p className="m-0 truncate text-[12.5px] font-medium text-ink">{item.title}</p>
                        <p className="m-0 text-[11.5px] text-faint">{item.meta}</p>
                      </div>
                      <ArrowUpRight size={12} aria-hidden className="shrink-0 text-faint" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {/* Context section */}
            <section aria-labelledby="rp-context">
              <p id="rp-context" className="m-0 mb-[8px] text-[11px] font-medium uppercase tracking-[0.55px] text-muted">Context</p>
              <div className="rounded-sm bg-soft px-[10px] py-[8px]">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-ink-2">84k / 200k · 42%</span>
                  <span className="text-[11.5px] text-faint">Opus 5.5 · auto at 85%</span>
                </div>
                <div className="mt-[6px] h-[4px] w-full overflow-hidden rounded-full bg-line-strong">
                  <div className="h-full w-[42%] rounded-full bg-muted" />
                </div>
              </div>
            </section>

            {/* Connectors */}
            <section aria-labelledby="rp-connectors">
              <p id="rp-connectors" className="m-0 mb-[6px] text-[11px] font-medium uppercase tracking-[0.55px] text-muted">Connectors</p>
              <div className="flex items-center gap-[8px]">
                <span className="inline-flex items-center gap-[4px] rounded-sm bg-soft px-[6px] py-[3px] text-[11.5px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong">
                  Notion
                </span>
                <span className="inline-flex items-center gap-[4px] rounded-sm bg-soft px-[6px] py-[3px] text-[11.5px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong">
                  GitHub
                </span>
              </div>
            </section>

            {/* Files in this chat */}
            <section aria-labelledby="rp-files">
              <p id="rp-files" className="m-0 mb-[6px] text-[11px] font-medium uppercase tracking-[0.55px] text-muted">Files in this chat</p>
              <div className="flex flex-col gap-[4px]">
                {['Q4 Launch brief', 'auth-spec.md'].map((f) => (
                  <span key={f} className="text-[12px] text-link hover:underline cursor-pointer">{f}</span>
                ))}
              </div>
            </section>

            {/* Goal */}
            <section aria-labelledby="rp-goal">
              <p id="rp-goal" className="m-0 mb-[6px] text-[11px] font-medium uppercase tracking-[0.55px] text-muted">Goal</p>
              <span className="text-[12.5px] text-ink-2">Passwordless login by Q4</span>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
