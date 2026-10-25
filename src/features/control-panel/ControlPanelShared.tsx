import { useCallback, useState } from 'react'
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { ChevronDown, Settings, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Topbar } from '../../ui/ds/Frame'

// ── Dirty-state hook ─────────────────────────────────────────────────────────

/**
 * Minimal dirty-state hook for the SaveBar.
 * - `markDirty()` — call whenever a setting changes.
 * - `save()` — clears dirty (callers can also show a toast).
 * - `discard()` — resets via the provided `reset` callback, then clears dirty.
 */
export function useDirtyState(reset?: () => void) {
  const [dirty, setDirty] = useState(false)
  const markDirty = useCallback(() => setDirty(true), [])
  const save = useCallback(() => setDirty(false), [])
  const discard = useCallback(() => {
    reset?.()
    setDirty(false)
  }, [reset])
  return { dirty, markDirty, save, discard }
}

/*
 * Control-panel primitives, mirroring the pen components used by every
 * `Control panel · …` screen in omilo-v2.pen. Strokes never take layout space
 * in pen, so row dividers are inset shadows and boxes use outlines.
 */

// ── Buttons (pen Button/Secondary sqbAw, Primary Upfho, Danger DUk7e, Quiet p38fT, Danger Solid YSMba) ──

export type PenButtonVariant = 'secondary' | 'primary' | 'danger' | 'quiet' | 'danger-solid'

export interface PenButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PenButtonVariant
  /** Height in px; pen default is 32. */
  h?: number
  /** Label size; pen default is 14. */
  fs?: number
  icon?: LucideIcon
  /** Icon size; pen default is 16. */
  iconSize?: number
  /** Horizontal padding; pen default 14. */
  px?: number
}

const BTN_LOOK: Record<PenButtonVariant, string> = {
  secondary: 'bg-surface text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft font-medium',
  primary: 'bg-primary text-primary-ink outline-1 -outline-offset-1 outline-primary hover:bg-primary-hover font-medium',
  danger: 'bg-surface text-bad outline-1 -outline-offset-1 outline-bad-line hover:bg-bad-tint font-medium',
  quiet: 'text-muted hover:bg-hover',
  'danger-solid': 'bg-bad-solid text-primary-ink outline-1 -outline-offset-1 outline-bad-solid font-medium',
}

export function PenButton({
  variant = 'secondary',
  h = 32,
  fs = 14,
  px = 14,
  icon: Icon,
  iconSize = 16,
  children,
  className = '',
  type = 'button',
  style,
  ...rest
}: PenButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-[6px] rounded-btn whitespace-nowrap transition-colors ${BTN_LOOK[variant]} ${className}`}
      style={{ height: h, fontSize: fs, paddingLeft: px, paddingRight: px, ...style }}
      {...rest}
    >
      {Icon && <Icon size={iconSize} aria-hidden className="shrink-0" />}
      {children}
    </button>
  )
}

// ── Chips (pen Chip/Neutral KMRv6, Chip/Warn XnZud, Chip/Run y85gB, Chip/Up Elczk) ──

export type ChipTone = 'neutral' | 'warn' | 'info' | 'ok' | 'bad'

const CHIP_LOOK: Record<ChipTone, string> = {
  neutral: 'bg-soft outline-line-strong text-ink-2',
  warn: 'bg-warn-tint outline-warn-line text-warn',
  info: 'bg-info-tint outline-info-line text-info',
  ok: 'bg-ok-tint outline-ok-line text-ok',
  bad: 'bg-bad-tint outline-bad-line text-bad',
}

export function Chip({
  tone = 'neutral',
  icon: Icon,
  children,
  className = '',
}: {
  tone?: ChipTone
  icon?: LucideIcon
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center gap-[4px] rounded-sm px-[8px] text-[12px] font-medium whitespace-nowrap outline-1 -outline-offset-1 ${CHIP_LOOK[tone]} ${className}`}
    >
      {Icon && <Icon size={12} aria-hidden className="shrink-0" />}
      {children}
    </span>
  )
}

// ── Fields (pen Input PzYhe, Select gVDns) ────────────────────────────────────

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[13px] font-medium text-ink-2">{children}</span>
}

export function Field({
  label,
  value,
  placeholder,
  icon: Icon,
  help,
  width,
  fs = 14,
  mono,
  trailing,
  select,
  h = 36,
  className = '',
  valueClassName = '',
}: {
  label?: ReactNode
  value?: ReactNode
  placeholder?: string
  icon?: LucideIcon
  help?: ReactNode
  width?: number | string
  fs?: number
  mono?: boolean
  trailing?: ReactNode
  /** Draw the select chevron (pen Select). */
  select?: boolean
  h?: number
  className?: string
  valueClassName?: string
}) {
  return (
    <div
      className={`flex shrink-0 flex-col gap-[6px] ${width === undefined ? 'w-full' : ''} ${className}`}
      style={width !== undefined ? { width } : undefined}
    >
      {label && <FieldLabel>{label}</FieldLabel>}
      <div
        className="flex w-full items-center gap-[8px] rounded-base bg-surface px-[10px] outline-1 -outline-offset-1 outline-line-strong"
        style={{ height: h }}
      >
        {Icon && <Icon size={16} aria-hidden className="shrink-0 text-muted" />}
        <span
          className={`min-w-0 flex-1 truncate ${value !== undefined ? 'text-ink' : 'text-faint'} ${mono ? 'font-mono' : ''} ${valueClassName}`}
          style={{ fontSize: fs }}
        >
          {value ?? placeholder}
        </span>
        {trailing}
        {select && <ChevronDown size={16} aria-hidden className="shrink-0 text-muted" />}
      </div>
      {help && <span className="text-[12.5px] text-muted">{help}</span>}
    </div>
  )
}

// ── Icon tile (pen Icon Tile vwHMT) ───────────────────────────────────────────

export function IconTile({
  icon: Icon,
  size = 32,
  iconSize = 16,
  className = '',
  iconClassName = 'text-ink-2',
  style,
}: {
  icon: LucideIcon
  size?: number
  iconSize?: number
  className?: string
  iconClassName?: string
  style?: CSSProperties
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      <Icon size={iconSize} aria-hidden className={iconClassName} />
    </span>
  )
}

// ── Radio (pen Radio/On hufFB, Radio/Off XCuSG) ──────────────────────────────

export function Radio({ on }: { on?: boolean }) {
  return on ? (
    <span className="flex size-[16px] shrink-0 items-center justify-center rounded-full bg-primary">
      <span className="size-[6px] rounded-full bg-primary-ink" />
    </span>
  ) : (
    <span className="size-[16px] shrink-0 rounded-full bg-surface outline-1 -outline-offset-1 outline-faint" />
  )
}

// ── Toggle ───────────────────────────────────────────────────────────────────

export function Toggle({ on = false, label }: { on?: boolean; label?: string }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`relative inline-flex h-[20px] w-[34px] shrink-0 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-wire-strong'}`}
    >
      <span
        className={`absolute top-[2px] size-[16px] rounded-full bg-surface shadow-[0_1px_2px_#0C0A0933] transition-transform ${on ? 'translate-x-[16px]' : 'translate-x-[2px]'}`}
      />
    </span>
  )
}

// ── Avatars ──────────────────────────────────────────────────────────────────

export function Initials({
  text,
  color,
  size = 28,
  fs = 11,
  ring,
}: {
  text: string
  color: string
  size?: number
  fs?: number
  /** Surface ring (stacked avatars) */
  ring?: boolean
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${ring ? 'outline-2 outline-surface' : ''}`}
      style={{ width: size, height: size, background: color, fontSize: fs }}
    >
      {text}
    </span>
  )
}

// ── Page layout ──────────────────────────────────────────────────────────────

/** Topbar + centred 860 page in a scroll + optional save bar. */
export function PageShell({
  crumb,
  children,
  gap = 18,
  saveBar,
  dirty,
  onSave,
  onDiscard,
  width = 860,
  pad = '20px 0 16px 0',
}: {
  crumb: string
  children: ReactNode
  gap?: number
  /** Show the save bar. */
  saveBar?: boolean
  /** Whether there are unsaved changes (passed down from the section). */
  dirty?: boolean
  onSave?: () => void
  onDiscard?: () => void
  width?: number
  pad?: string
}) {
  return (
    <>
      <Topbar icon={Settings} title="Control panel" meta={`/  ${crumb}`} />
      <div className="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto">
        <div className="flex shrink-0 flex-col" style={{ width, gap, padding: pad }}>
          {children}
        </div>
      </div>
      {saveBar && <SaveBar dirty={dirty} onSave={onSave} onDiscard={onDiscard} />}
    </>
  )
}

export function PageHeader({
  title,
  sub,
  actions,
  gap = 12,
}: {
  title: string
  sub?: ReactNode
  actions?: ReactNode
  gap?: number
}) {
  return (
    <div className="flex w-full items-end" style={{ gap }}>
      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <h1 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">{title}</h1>
        {sub && <p className="m-0 text-[13px] text-muted">{sub}</p>}
      </div>
      {actions}
    </div>
  )
}

/** A titled group: head (T 14/600 + optional D 12.5 muted) then content, gap 10. */
export function Group({
  title,
  desc,
  right,
  children,
  gap = 10,
  inlineDesc,
}: {
  title: ReactNode
  desc?: ReactNode
  right?: ReactNode
  children?: ReactNode
  gap?: number
  /** Head lays T and D out in a row (gap 8). */
  inlineDesc?: boolean
}) {
  return (
    <section className="flex w-full flex-col" style={{ gap }}>
      <div className={`flex w-full ${inlineDesc ? 'items-center gap-[8px]' : 'items-end gap-[8px]'}`}>
        <div className={`flex min-w-0 ${inlineDesc ? 'items-center gap-[8px]' : 'flex-1 flex-col gap-[2px]'}`}>
          <h2 className="m-0 text-[14px] font-semibold text-ink">{title}</h2>
          {desc && <p className="m-0 text-[12.5px] text-muted">{desc}</p>}
        </div>
        {right && (
          <>
            <div className="h-px min-w-0 flex-1" />
            {right}
          </>
        )}
      </div>
      {children}
    </section>
  )
}

/** pen setting Box: radius 12 · line-strong stroke · padding 4 14. */
export function Box({
  children,
  className = '',
  pad = '4px 14px',
  style,
}: {
  children: ReactNode
  className?: string
  pad?: string
  style?: CSSProperties
}) {
  return (
    <div
      className={`flex w-full flex-col rounded-lg outline-1 -outline-offset-1 outline-line-strong ${className}`}
      style={{ padding: pad, ...style }}
    >
      {children}
    </div>
  )
}

/** Bottom hairline that takes no layout space (pen stroke bottom). */
export const lineBottom = 'shadow-[inset_0_-1px_0_var(--color-line)]'
export const lineTop = 'shadow-[inset_0_1px_0_var(--color-line)]'

/** A setting row: T 13.5/500 + D 12 muted, control on the right; padding 12 0. */
export function Row({
  title,
  desc,
  children,
  last,
  gap = 16,
  pad = '12px 0',
  leading,
}: {
  title: ReactNode
  desc?: ReactNode
  children?: ReactNode
  last?: boolean
  gap?: number
  pad?: string
  leading?: ReactNode
}) {
  return (
    <div className={`flex w-full items-center ${last ? '' : lineBottom}`} style={{ gap, padding: pad }}>
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[13.5px] font-medium text-ink">{title}</span>
        {desc && <span className="text-[12px] text-muted">{desc}</span>}
      </div>
      {children}
    </div>
  )
}

export function SaveBar({
  dirty = false,
  onSave,
  onDiscard,
}: {
  dirty?: boolean
  onSave?: () => void
  onDiscard?: () => void
}) {
  return (
    <div className={`flex w-full shrink-0 items-center gap-[8px] px-[20px] py-[10px] ${lineTop}`}>
      <span className="min-w-0 flex-1 text-[12px] text-muted">
        {dirty ? 'Unsaved changes' : 'No unsaved changes'}
      </span>
      <PenButton disabled={!dirty} onClick={onDiscard}>Discard</PenButton>
      <PenButton variant="primary" disabled={!dirty} onClick={onSave}>Save changes</PenButton>
    </div>
  )
}

// ── Dialog / Drawer shells ───────────────────────────────────────────────────

/** Scrim (#0C0A0940) over the whole window. */
export function Scrim({ onClose, children, align = 'center' }: { onClose?: () => void; children: ReactNode; align?: 'center' | 'right' }) {
  return (
    <div
      className={`fixed inset-0 z-50 flex bg-[#0C0A0940] ${align === 'center' ? 'items-center justify-center' : 'justify-end'}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      {children}
    </div>
  )
}

export function CloseButton({ onClose }: { onClose?: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      className="inline-flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
    >
      <X size={16} aria-hidden />
    </button>
  )
}

/** pen Dialog: radius 20 · line-strong · shadow 0 24 48 #1C19173D · head / body / footer. */
export function DialogCard({
  width,
  title,
  sub,
  icon,
  tile,
  onClose,
  children,
  footer,
  bodyGap = 16,
  label,
  offsetY = 0,
}: {
  width: number
  title: ReactNode
  sub?: ReactNode
  icon?: LucideIcon
  tile?: ReactNode
  onClose?: () => void
  children: ReactNode
  footer?: ReactNode
  bodyGap?: number
  label?: string
  /** Shift from the vertical centre (pen dialogs are not always centred). */
  offsetY?: number
}) {
  return (
    <Scrim onClose={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === 'string' ? title : undefined)}
        className="flex flex-col overflow-hidden rounded-dialog bg-surface shadow-[0_24px_48px_#1C19173D] outline-1 -outline-offset-1 outline-line-strong"
        style={{ width, transform: offsetY ? `translateY(${offsetY}px)` : undefined }}
      >
        <div className={`flex w-full items-center gap-[12px] py-[14px] pr-[12px] pl-[20px] ${lineBottom}`}>
          {tile ?? (icon && <IconTile icon={icon} />)}
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <h2 className="m-0 text-[16px] font-semibold text-ink">{title}</h2>
            {sub && <p className="m-0 text-[12.5px] text-muted">{sub}</p>}
          </div>
          <CloseButton onClose={onClose} />
        </div>
        <div className="flex w-full flex-col p-[20px]" style={{ gap: bodyGap }}>
          {children}
        </div>
        {footer && (
          <div className={`flex w-full items-center gap-[8px] px-[20px] py-[12px] ${lineTop}`}>{footer}</div>
        )}
      </div>
    </Scrim>
  )
}

/** pen Drawer: right-anchored full-height panel. */
export function DrawerCard({
  width,
  children,
  onClose,
  label,
  className = '',
}: {
  width: number
  children: ReactNode
  onClose?: () => void
  label: string
  className?: string
}) {
  return (
    <Scrim onClose={onClose} align="right">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`flex h-full flex-col overflow-hidden bg-surface ${className}`}
        style={{ width }}
      >
        {children}
      </div>
    </Scrim>
  )
}

/** Summary table row (label left, mono value right). */
export function SumRow({
  label,
  value,
  strong,
  soft,
  first,
}: {
  label: ReactNode
  value: ReactNode
  strong?: boolean
  soft?: boolean
  first?: boolean
}) {
  return (
    <div
      className={`flex w-full gap-[8px] px-[14px] py-[10px] ${soft ? 'bg-soft' : ''} ${first ? '' : lineTop}`}
    >
      <span className={`min-w-0 flex-1 text-[13px] ${strong ? 'font-semibold text-ink' : 'text-ink-2'}`}>{label}</span>
      <span className={`font-mono text-[12.5px] text-ink ${strong ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  )
}

/** pen Spinner g4C5A: 14px ring, line-strong track, ink 90° arc. */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0 animate-spin">
      <circle cx="7" cy="7" r="6.02" fill="none" stroke="var(--color-line-strong)" strokeWidth="1.96" />
      <path d="M11.26 2.74 A6.02 6.02 0 0 1 11.26 11.26" fill="none" stroke="var(--color-ink)" strokeWidth="1.96" />
    </svg>
  )
}
