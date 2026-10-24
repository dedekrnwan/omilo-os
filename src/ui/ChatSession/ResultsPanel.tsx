/**
 * ResultsPanel — the 340px card beside the chat (pen `Chat · Session + Results` SP6gy):
 * Progress → Outputs → Context. Also:
 *   - DropOverlay over the chat card while files are dragged in (Zdjc7)
 *   - PreviewDrawer: an output opened over a scrim (CnBzj)
 */

import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import type { ComponentType } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  Circle,
  CircleCheck,
  Download,
  FileCode,
  FileText,
  FoldVertical,
  FolderPlus,
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  Notebook,
  Pin,
  Plus,
  Sheet,
  Target,
  X,
} from 'lucide-react'
import { IconButton } from '../ds/Button'
import { Mascot } from '../ds/Mascot'
import { Ring } from './Ring'

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

// ── Mock data (pen SP6gy) ─────────────────────────────────────────────────────

const STEPS = [
  { label: 'Audit current login flow', state: 'done', meta: '2 min' },
  { label: 'Draft rollout plan', state: 'done', meta: '4 min' },
  { label: 'Write migration doc for Support', state: 'running', meta: 'Dev · working' },
  { label: 'Schedule staged rollout', state: 'pending', meta: '' },
] as const

const OUTPUTS: { title: string; meta: string; icon: Icon }[] = [
  { title: 'Passkey rollout plan', meta: 'Doc · edited just now', icon: FileText },
  { title: 'login-funnel-audit.csv', meta: 'Sheet · 1.2k rows', icon: Sheet },
  { title: 'rollout-timeline.png', meta: 'Image · 1600×900', icon: ImageIcon },
]

const TIMELINE = [
  ['Web + iOS WebAuthn', 'Dev', 'Nov 14'],
  ['Android fallback', 'Dev', 'Nov 20'],
  ['Resident comms', 'Grower', 'Nov 18'],
  ['10% → 100% rollout', 'Chief', 'Nov 21–28'],
]

// ── Pieces ────────────────────────────────────────────────────────────────────

function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex w-full items-center gap-[6px]">
      <h3 className="m-0 text-[13px] font-semibold text-ink">{title}</h3>
      <ChevronDown size={14} aria-hidden className="text-muted" />
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

function StepState({ state }: { state: (typeof STEPS)[number]['state'] }) {
  if (state === 'done') return <CircleCheck size={16} aria-hidden className="shrink-0 text-ok" />
  if (state === 'running') return <LoaderCircle size={16} aria-hidden className="shrink-0 text-info" />
  return <Circle size={16} aria-hidden className="shrink-0 text-faint" />
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
      {/* Drag ghost (pen `Attachment Chip` JG9eD, rotated -4°) + count badge */}
      <div aria-hidden className="pointer-events-none absolute top-[586px] left-[470px]">
        <div className="flex w-[232px] -rotate-4 items-center gap-[10px] rounded-md bg-surface py-[6px] pr-[8px] pl-[6px] opacity-95 outline-1 -outline-offset-1 outline-line-strong shadow-[0_10px_24px_#0C0A0929]">
          <span className="flex size-[36px] shrink-0 items-center justify-center rounded-sm bg-soft outline-1 -outline-offset-1 outline-line">
            <FileText size={16} className="text-ink-2" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="truncate text-[13px] font-medium text-ink">Q3-board-notes.pdf</span>
            <span className="font-mono text-[11px] text-muted">PDF · 1.2 MB</span>
          </span>
        </div>
        <span className="absolute -top-[14px] left-[218px] flex h-[20px] items-center rounded-[10px] bg-info px-[7px] font-mono text-[11px] font-semibold text-white outline-2 outline-surface">
          2
        </span>
      </div>
    </div>
  )
}

/** Output preview drawer over a scrim (pen CnBzj `Preview Drawer` EPRgt). */
function PreviewDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#0C0A0926]" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed top-[8px] right-[8px] bottom-[8px] z-50 flex w-[620px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong shadow-[-8px_0_48px_#1C19173D]"
        >
          <div className="flex w-full items-center gap-[12px] py-[14px] pr-[12px] pl-[20px] shadow-[inset_0_-1px_0_var(--color-line)]">
            <span className="flex size-[32px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
              <FileText size={16} aria-hidden className="text-ink-2" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <Dialog.Title className="m-0 text-[16px] font-semibold text-ink">Passkey rollout plan</Dialog.Title>
              <span className="text-[12.5px] text-muted">Doc · written by Dev · edited just now</span>
            </div>
            <IconButton icon={Download} aria-label="Download" />
            <IconButton icon={Maximize2} aria-label="Expand" />
            <Dialog.Close asChild>
              <IconButton icon={X} aria-label="Close preview" />
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 w-full flex-1 flex-col gap-[12px] overflow-y-auto px-[32px] py-[20px]">
            <h2 className="m-0 font-display text-[22px] font-semibold text-ink">Passkey rollout plan</h2>
            <p className="m-0 text-[13.5px] leading-[1.6] text-ink-2">
              Goal: passwordless login for 80% of active users by Q4 code freeze (Nov 28).
            </p>
            <h3 className="m-0 font-display text-[16px] font-semibold text-ink">Timeline</h3>
            <div className="flex w-full flex-col overflow-hidden rounded-base outline-1 -outline-offset-1 outline-line">
              {[['Phase', 'Who', 'When'], ...TIMELINE].map((row, i, all) => (
                <div
                  key={row[0]}
                  className={`flex w-full gap-[12px] px-[12px] py-[8px] text-[12.5px] ${
                    i === 0 ? 'bg-soft font-semibold text-muted' : 'text-ink-2'
                  } ${i < all.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}
                >
                  <span className="flex-1">{row[0]}</span>
                  <span className="w-[110px]">{row[1]}</span>
                  <span className="w-[110px]">{row[2]}</span>
                </div>
              ))}
            </div>
            <h3 className="m-0 font-display text-[16px] font-semibold text-ink">Risks</h3>
            <p className="m-0 text-[13.5px] leading-[1.6] text-ink-2">
              Legacy Android (&lt; v9) can&apos;t do WebAuthn — keep password + OTP for those 6% of users until they update.
            </p>
          </div>

          <div className="flex w-full items-center gap-[8px] px-[20px] py-[12px] shadow-[inset_0_1px_0_var(--color-line)]">
            <button type="button" className="inline-flex h-[32px] items-center gap-[6px] rounded-btn px-[14px] text-[13px] text-muted hover:bg-hover">
              <MessageCircle size={16} aria-hidden />
              Ask Dev to change something
            </button>
            <span className="h-px flex-1" />
            <button type="button" className="inline-flex h-[32px] items-center gap-[6px] rounded-btn bg-surface px-[14px] text-[13px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft">
              <ArrowUpRight size={16} aria-hidden />
              Open in Docs
            </button>
            <button type="button" className="inline-flex h-[32px] items-center gap-[6px] rounded-btn bg-primary px-[14px] text-[13px] font-medium text-primary-ink outline-1 -outline-offset-1 outline-primary hover:bg-primary-hover">
              <Pin size={16} aria-hidden />
              Pin to Docs
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export interface ResultsPanelProps {
  onClose?: () => void
  /** Files are being dragged in: "Files in this chat" lights up with the incoming count (Zdjc7). */
  highlightFiles?: boolean
  /** Open with the first output's preview drawer showing (CnBzj). */
  initialPreview?: boolean
}

export function ResultsPanel({ highlightFiles = false, initialPreview = false }: ResultsPanelProps) {
  const [preview, setPreview] = useState(initialPreview)

  return (
    <aside
      aria-label="Results"
      data-testid="results-panel"
      className="ml-[6px] flex min-h-0 w-[340px] shrink-0 flex-col overflow-y-auto rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong"
    >
      <section className="flex w-full flex-col gap-[12px] px-[18px] py-[16px] shadow-[inset_0_-1px_0_var(--color-line)]">
        <SectionHead title="Progress" />
        <div className="flex w-full flex-col gap-[10px]">
          {STEPS.map((s) => (
            <div key={s.label} className="flex w-full items-center gap-[10px]">
              <StepState state={s.state} />
              <span className={`flex-1 text-[12.5px] ${s.state === 'pending' ? 'text-muted' : 'text-ink'}`}>{s.label}</span>
              {s.meta && <span className="text-[11.5px] text-faint">{s.meta}</span>}
            </div>
          ))}
        </div>
        <span className="text-[11.5px] text-muted">2 of 4 steps done</span>
      </section>

      <section className="flex w-full flex-col gap-[12px] px-[18px] py-[16px] shadow-[inset_0_-1px_0_var(--color-line)]">
        <SectionHead title="Outputs" />
        {OUTPUTS.map((o) => (
          <button
            key={o.title}
            type="button"
            onClick={() => setPreview(true)}
            className="flex w-full items-center gap-[10px] rounded-md p-[8px] text-left outline-1 -outline-offset-1 outline-line transition-colors hover:bg-soft"
          >
            <span className="flex size-[32px] shrink-0 items-center justify-center rounded-sm bg-soft">
              <o.icon size={16} aria-hidden className="text-ink-2" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="truncate text-[12.5px] font-medium text-ink">{o.title}</span>
              <span className="text-[11.5px] text-muted">{o.meta}</span>
            </span>
            <ArrowUpRight size={15} aria-hidden className="shrink-0 text-muted" />
          </button>
        ))}
      </section>

      <section className="flex w-full flex-col gap-[12px] px-[18px] py-[16px]">
        <SectionHead
          title="Context"
          action={
            <button type="button" aria-label="Add context" className="text-muted hover:text-ink-2">
              <FolderPlus size={15} aria-hidden />
            </button>
          }
        />
        <div className="flex w-full items-center gap-[10px] rounded-md px-[12px] py-[10px] outline-1 -outline-offset-1 outline-line">
          <Ring size={28} value={42} inner={0.74} />
          <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
            <span className="text-[12.5px] font-semibold text-ink">84k / 200k · 42%</span>
            <span className="text-[11.5px] text-muted">Opus 5.5 · auto at 85%</span>
          </span>
          <button type="button" aria-label="Compact" className="flex size-[28px] items-center justify-center rounded-btn text-muted hover:bg-hover">
            <FoldVertical size={16} aria-hidden />
          </button>
        </div>
        <div className="flex w-full flex-col gap-[8px]">
          <span className="text-[11.5px] text-muted">Connectors</span>
          <div className="flex gap-[6px]">
            <Chip icon={Notebook} label="Notion" />
            <Chip icon={Github} label="GitHub" />
          </div>
        </div>
        <div
          className={`flex w-full flex-col gap-[8px] ${
            highlightFiles ? 'rounded-md bg-info-tint p-[10px] outline-[1.5px] -outline-offset-[1.5px] outline-info-line' : ''
          }`}
        >
          <span className="text-[11.5px] text-muted">Files in this chat</span>
          <div className="flex gap-[6px]">
            <Chip icon={FileText} label="Q4 Launch brief" />
            <Chip icon={FileCode} label="auth-spec.md" />
          </div>
          {highlightFiles && (
            <span className="inline-flex h-[23px] w-fit items-center gap-[4px] rounded-sm bg-surface px-[8px] outline-1 -outline-offset-1 outline-info-line">
              <Plus size={12} aria-hidden className="text-info" />
              <span className="text-[12px] font-medium text-info">2 files</span>
            </span>
          )}
        </div>
        <div className="flex w-full flex-col gap-[8px]">
          <span className="text-[11.5px] text-muted">Goal</span>
          <div className="flex gap-[6px]">
            <Chip icon={Target} label="Passwordless login by Q4" />
          </div>
        </div>
      </section>

      <PreviewDrawer open={preview} onOpenChange={setPreview} />
    </aside>
  )
}

ResultsPanel.DropOverlay = DropOverlay
