import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '../../ui/ds/Button'

// ── Page layout ────────────────────────────────────────────────────────────────

/** Full-width scrollable content pane for a section. */
export function SectionPane({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[48px] py-[40px]">
      {children}
    </div>
  )
}

/** Section heading (h1) + optional subtitle. */
export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-[28px] flex items-start justify-between">
      <div>
        <h1 className="m-0 font-display text-[28px] font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-[4px] text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** h2-level section group title inside a section. */
export function SubHeading({ label }: { label: string }) {
  return <h2 className="mb-[12px] text-[16px] font-semibold text-ink">{label}</h2>
}

/** Horizontal divider rule. */
export function Rule() {
  return <div className="my-[24px] h-px bg-line-strong" />
}

// ── Form row ──────────────────────────────────────────────────────────────────

/**
 * A labelled setting row: label+desc on left, control on right.
 * Used extensively across sections.
 */
export function SettingRow({
  label,
  desc,
  children,
}: {
  label: string
  desc?: string
  children?: ReactNode
}) {
  return (
    <div className="flex min-h-[48px] items-center gap-[16px] py-[8px]">
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[13px] font-medium text-ink">{label}</span>
        {desc && <span className="text-[12px] text-muted">{desc}</span>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  )
}

/** Row separator (thin line between setting rows). */
export function RowDivider() {
  return <div className="h-px bg-line" />
}

/** Card that wraps a group of setting rows. */
export function SettingCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface">
      {children}
    </div>
  )
}

/** Vertical stack of SettingRow + RowDivider. Pass rows as children. */
export function SettingCardRows({ children }: { children: ReactNode }) {
  return <SettingCard><div className="px-[16px]">{children}</div></SettingCard>
}

// ── Text input ────────────────────────────────────────────────────────────────

export function TextInput({
  value,
  placeholder,
  className = '',
  width,
}: {
  value?: string
  placeholder?: string
  className?: string
  /** Fixed width in px; overrides the default min-width when set. */
  width?: number
}) {
  return (
    <input
      readOnly
      value={value}
      placeholder={placeholder}
      style={width !== undefined ? { width, minWidth: width } : undefined}
      className={`h-[34px] ${width === undefined ? 'min-w-[240px]' : ''} rounded-base border border-line-strong bg-soft px-[12px] text-[13px] text-ink outline-none ${className}`}
    />
  )
}

// ── Toggle ────────────────────────────────────────────────────────────────────

export function Toggle({ on = false, onClick, label }: { on?: boolean; onClick?: () => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full transition-colors ${
        on ? 'bg-ink' : 'bg-line-strong'
      }`}
    >
      <span
        className={`absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-[18px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  )
}

// ── Badge ─────────────────────────────────────────────────────────────────────

export function StatusBadge({ label, color }: { label: string; color: 'ok' | 'warn' | 'bad' | 'info' | 'neutral' }) {
  const colors = {
    ok: 'bg-ok-tint text-ok border-ok-line',
    warn: 'bg-warn-tint text-warn border-warn-line',
    bad: 'bg-bad-tint text-bad border-bad-line',
    info: 'bg-info-tint text-info border-info-line',
    neutral: 'bg-soft text-muted border-line-strong',
  }
  return (
    <span className={`inline-flex items-center rounded-pill border px-[8px] py-[2px] text-[11px] font-medium ${colors[color]}`}>
      {label}
    </span>
  )
}

// ── Select (visual-only) ──────────────────────────────────────────────────────

export function SelectField({ value, width }: { value: string; width?: number }) {
  return (
    <button
      type="button"
      style={width !== undefined ? { width, minWidth: width } : undefined}
      className={`flex h-[34px] ${width === undefined ? 'min-w-[200px]' : ''} items-center gap-[8px] rounded-base border border-line-strong bg-soft px-[12px] text-[13px] text-ink`}
    >
      <span className="flex-1 text-left">{value}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" className="text-muted" aria-hidden>
        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

// ── Modal / Dialog ────────────────────────────────────────────────────────────

/** Lightweight modal backdrop + card. No portal needed for static visual. */
export function Modal({
  title,
  subtitle,
  width = 480,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  width?: number
  onClose?: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0A0940] backdrop-blur-sm"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="relative flex max-h-[90vh] flex-col overflow-hidden rounded-dialog bg-surface shadow-[0_24px_64px_#0C0A091F]"
        style={{ width }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-[24px] pt-[24px] pb-[16px]">
          <div>
            <h2 className="m-0 text-[17px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-[4px] text-[13px] text-muted">{subtitle}</p>}
          </div>
          {onClose && (
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="ml-[12px] flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted hover:bg-hover"
            >
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-[24px] pb-[24px]">{children}</div>
        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-[8px] border-t border-line px-[24px] py-[16px]">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Footer bar (save / discard) ───────────────────────────────────────────────

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
    <div className="flex h-[52px] shrink-0 items-center justify-between border-t border-line px-[48px]">
      <span className="text-[12px] text-muted">{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span>
      <div className="flex items-center gap-[8px]">
        <Button variant="secondary" height={30} disabled={!dirty} onClick={onDiscard}>Discard</Button>
        <Button variant="primary" height={30} disabled={!dirty} onClick={onSave}>Save changes</Button>
      </div>
    </div>
  )
}

// ── Breadcrumb ─────────────────────────────────────────────────────────────────

export function Breadcrumb({ section }: { section: string }) {
  return (
    <div className="flex items-center gap-[6px] text-[12px] text-muted">
      <span>Control panel</span>
      <span>/</span>
      <span className="text-ink">{section}</span>
    </div>
  )
}
