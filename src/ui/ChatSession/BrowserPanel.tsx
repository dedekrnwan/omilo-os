/**
 * BrowserPanel — the 600px agent-browser card beside the chat
 * (pen `Chat · Session + Browser` E5554m, `· You took over` ocar6).
 */

import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  EllipsisVertical,
  Hand,
  Lock,
  Maximize2,
  MousePointer2,
  MousePointerClick,
  Plus,
  RotateCw,
  ShieldCheck,
  Undo2,
  X,
} from 'lucide-react'

/** lucide `github` (brand icons are not shipped by lucide-react). */
function Github({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  )
}

/** pen `Switch/On` (y1lHE) / `Switch/Off` (o4QgH): 32×18 · radius 9 · p-2 · 14px knob. */
function Switch({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`flex h-[18px] w-[32px] shrink-0 rounded-[9px] p-[2px] ${on ? 'justify-end bg-primary' : 'bg-line-strong'}`}>
      <span className="size-[14px] rounded-full bg-white shadow-[0_1px_2px_#0000002E]" />
    </span>
  )
}

/** pen `Spinner` (g4C5A): 14px donut, ink quarter arc on a line-strong track. */
function Spinner() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden className="shrink-0 animate-spin">
      <circle cx={7} cy={7} r={6.02} fill="none" stroke="var(--color-line-strong)" strokeWidth={1.96} />
      <circle cx={7} cy={7} r={6.02} fill="none" stroke="var(--color-ink)" strokeWidth={1.96} strokeDasharray={`${(Math.PI * 2 * 6.02) / 4} 100`} transform="rotate(-45 7 7)" />
    </svg>
  )
}

const SETTINGS = [
  { label: 'Enable passkeys', desc: 'Show “Sign in with passkey” on the login page', on: true },
  { label: 'Staged rollout', desc: 'Start with 10% of Engineering, then everyone', on: true },
  { label: 'Require on new devices', desc: 'Ask for a passkey when a device is unknown', on: false },
]

const iconBtn = 'flex items-center justify-center text-muted hover:text-ink-2'

export interface BrowserPanelProps {
  onClose: () => void
  /** Start in the "You took over" state (ocar6). */
  initialTakenOver?: boolean
}

export function BrowserPanel({ onClose, initialTakenOver = false }: BrowserPanelProps) {
  const [takenOver, setTakenOver] = useState(initialTakenOver)

  return (
    <aside
      aria-label="Agent browser"
      data-testid="browser-panel"
      className="ml-[6px] flex min-h-0 w-[600px] shrink-0 flex-col overflow-hidden rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong"
    >
      {takenOver && (
        <div role="alert" className="flex w-full items-center justify-center gap-[8px] bg-warn px-[12px] py-[6px]">
          <MousePointer2 size={13} aria-hidden className="text-white" />
          <span className="text-[12px] font-medium text-white">You&apos;re controlling this tab — Dev won&apos;t click or type</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex w-full items-center gap-[6px] bg-soft px-[10px] py-[8px]">
        <div className="flex items-center gap-[8px] rounded-sm bg-surface px-[10px] py-[6px] outline-1 -outline-offset-1 outline-line">
          <ShieldCheck size={13} aria-hidden className="text-ok" />
          <span className="text-[12px] text-ink">Auth console · Passkeys</span>
          <X size={12} aria-hidden className="text-muted" />
        </div>
        <div className="flex items-center gap-[8px] rounded-sm px-[10px] py-[6px]">
          <Github size={13} className="text-muted" />
          <span className="text-[12px] text-muted">PR #482</span>
        </div>
        <button type="button" aria-label="New tab" className={iconBtn}>
          <Plus size={15} aria-hidden />
        </button>
        <span className="h-px flex-1" />
        <button type="button" aria-label="Browser options" className={iconBtn}>
          <EllipsisVertical size={15} aria-hidden />
        </button>
        <button type="button" aria-label="Expand browser" className={iconBtn}>
          <Maximize2 size={15} aria-hidden />
        </button>
        <button type="button" aria-label="Close browser panel" onClick={onClose} className={iconBtn}>
          <X size={15} aria-hidden />
        </button>
      </div>

      {/* Nav */}
      <div className="flex w-full items-center gap-[10px] px-[12px] py-[8px] shadow-[inset_0_-1px_0_var(--color-line)]">
        <ArrowLeft size={15} aria-hidden className="text-muted" />
        <ArrowRight size={15} aria-hidden className="text-muted" />
        <RotateCw size={15} aria-hidden className="text-muted" />
        <div className="flex h-[28px] min-w-0 flex-1 items-center gap-[6px] rounded-sm bg-soft px-[10px]">
          <Lock size={12} aria-hidden className="text-muted" />
          <span className="truncate font-mono text-[12px] text-ink-2">console.saga.id/auth/passkeys</span>
        </div>
        <MousePointerClick size={15} aria-hidden className="text-muted" />
      </div>

      {/* View */}
      <div
        className={`relative flex min-h-0 w-full flex-1 flex-col gap-[18px] bg-app p-[28px] ${
          takenOver ? 'outline-2 -outline-offset-2 outline-warn' : ''
        }`}
      >
        <div className="flex w-full flex-col gap-[4px]">
          <span className="text-[10.5px] font-semibold tracking-[1px] text-faint">AUTHENTICATION</span>
          <h2 className="m-0 font-display text-[22px] font-semibold text-ink">Passkeys</h2>
          <p className="m-0 text-[12.5px] text-muted">Let people sign in with Face ID, Touch ID or a security key.</p>
        </div>

        <div className="flex w-full flex-col rounded-md bg-surface outline-1 -outline-offset-1 outline-line-strong">
          {SETTINGS.map((s, i) => (
            <div
              key={s.label}
              className={`flex w-full items-center gap-[12px] px-[16px] py-[14px] ${
                i < SETTINGS.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
              }`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="text-[13px] font-medium text-ink">{s.label}</span>
                <span className="text-[12px] text-muted">{s.desc}</span>
              </div>
              {/* The setting the agent just touched gets a 2px info ring (agent mode) */}
              <span
                className={`rounded-pill ${i === 0 ? 'p-[3px]' : ''} ${
                  i === 0 && !takenOver ? 'outline-2 -outline-offset-2 outline-info' : ''
                }`}
              >
                <Switch on={s.on} />
              </span>
            </div>
          ))}
        </div>

        <span className="flex-1" />

        {takenOver ? (
          <div className="flex w-full items-center gap-[10px] rounded-md bg-warn-tint px-[12px] py-[10px] outline-1 -outline-offset-1 outline-warn-line">
            <Hand size={16} aria-hidden className="shrink-0 text-warn" />
            <span className="flex-1 text-[12.5px] text-ink-2">You&apos;re in control · Dev paused and is watching</span>
            <button
              type="button"
              onClick={() => setTakenOver(false)}
              className="inline-flex h-[28px] items-center gap-[6px] rounded-btn bg-primary px-[14px] text-[13px] font-medium text-primary-ink outline-1 -outline-offset-1 outline-primary hover:bg-primary-hover"
            >
              <Undo2 size={16} aria-hidden />
              Hand back to Dev
            </button>
          </div>
        ) : (
          <div className="flex w-full items-center gap-[10px] rounded-md bg-surface px-[12px] py-[10px] outline-1 -outline-offset-1 outline-line-strong">
            <Spinner />
            <span className="flex-1 text-[12.5px] text-ink-2">Dev turned on passkeys · checking the login page next</span>
            <button
              type="button"
              onClick={() => setTakenOver(true)}
              className="inline-flex h-[28px] items-center rounded-btn px-[14px] text-[14px] text-muted hover:bg-hover"
            >
              Take over
            </button>
            <button
              type="button"
              className="inline-flex h-[28px] items-center rounded-btn bg-surface px-[12px] text-[13px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
            >
              Stop
            </button>
          </div>
        )}

        {takenOver && (
          <MousePointer2 size={20} aria-hidden className="pointer-events-none absolute top-[150px] left-[520px] text-ink" />
        )}
      </div>
    </aside>
  )
}
