// Local pen primitives shared by Office screens (Inbox, Goals, Flows) that the
// DS layer does not have yet: 32px buttons (Button/Primary·Secondary·Quiet·Danger),
// Icon Tile, Input field, dialog shell (Head · Body · Footer) and Toast.

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { IconButton } from '../../ui/ds/Button'
import { Drawer } from '../../ui/ds/Drawer'

type Btn32Variant = 'primary' | 'secondary' | 'quiet' | 'danger'

const BTN32: Record<Btn32Variant, { box: string; icon: string; label: string }> = {
  primary: { box: 'bg-primary outline-primary hover:bg-primary-hover', icon: 'text-primary-ink', label: 'text-primary-ink font-medium' },
  secondary: { box: 'bg-surface outline-line-strong hover:bg-soft', icon: 'text-ink', label: 'text-ink font-medium' },
  quiet: { box: 'outline-transparent hover:bg-hover', icon: 'text-muted', label: 'text-muted' },
  danger: { box: 'bg-surface outline-bad-line hover:bg-bad-tint', icon: 'text-bad', label: 'text-bad font-medium' },
}

/** pen `Button/Primary|Secondary|Quiet|Danger` (h-32 · radius btn · gap 6 · px 14 · icon 16 · label 13). */
export function Btn32({
  variant = 'secondary',
  icon: Icon,
  children,
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Btn32Variant; icon?: LucideIcon }) {
  const v = BTN32[variant]
  return (
    <button
      type={type}
      className={`inline-flex h-[32px] shrink-0 items-center justify-center gap-[6px] rounded-btn px-[14px] text-[13px] whitespace-nowrap outline-1 -outline-offset-1 transition-colors disabled:opacity-50 ${v.box} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={16} aria-hidden className={v.icon} />}
      <span className={v.label}>{children}</span>
    </button>
  )
}

/** pen `Icon Tile` (vwHMT): 32 · soft · radius md · line · icon 16 ink-2. */
export function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-[32px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
      <Icon size={16} aria-hidden className="text-ink-2" />
    </span>
  )
}

/** pen `Input` (PzYhe): label 13/500 ink-2 · gap 6 · field h-36 radius r line-strong px 10 gap 8 · value 14. */
export function Field({
  label,
  icon: Icon,
  value,
  onChange,
  placeholder,
  id,
  help,
  className = '',
}: {
  label: string
  icon?: LucideIcon
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  id: string
  help?: string
  className?: string
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-[6px] ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      <div className="flex h-[36px] w-full items-center gap-[8px] rounded-base bg-surface px-[10px] outline-1 -outline-offset-1 outline-line-strong focus-within:outline-ink">
        {Icon && <Icon size={16} aria-hidden className="shrink-0 text-muted" />}
        <input
          id={id}
          value={value}
          placeholder={placeholder}
          readOnly={!onChange}
          onChange={(e) => onChange?.(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
        />
      </div>
      {help && <span className="text-[12.5px] text-muted">{help}</span>}
    </div>
  )
}

/**
 * Reusable Office drawer wrapper. Delegates to the shared `Drawer` (serif-title
 * header + scrollable body + soft footer bar) so Office panels match the house
 * drawer pattern. Prop signature is kept backward-compatible for existing callers.
 */
export function OfficeDialog({
  open,
  onOpenChange,
  width,
  title,
  sub,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  width: number
  /** Deprecated: ignored — shared Drawer header is serif-title-only (no icon tile). */
  icon?: LucideIcon
  title: string
  sub?: ReactNode
  children: ReactNode
  footer: ReactNode
  /** Deprecated: ignored — drawers are full-height; accepted so existing call sites compile. */
  top?: number
}) {
  if (!open) return null
  return (
    <Drawer
      title={title}
      subtitle={sub}
      onClose={() => onOpenChange(false)}
      width={width}
      bodyClass="gap-[16px] p-[20px]"
      footer={footer}
    >
      {children}
    </Drawer>
  )
}

/** pen `Toast` (LZRbW): 360 · surface · radius lg · line-strong · shadow 0 10 24 #0C0A0929. */
export function Toast({
  icon: Icon,
  iconClassName = 'text-ink-2',
  title,
  body,
  onClose,
  className = '',
}: {
  icon: LucideIcon
  iconClassName?: string
  title: string
  body?: string
  onClose?: () => void
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex w-[360px] gap-[10px] rounded-lg bg-surface py-[12px] pr-[8px] pl-[14px] shadow-[0_10px_24px_#0C0A0929] outline-1 -outline-offset-1 outline-line-strong ${className}`}
    >
      <Icon size={18} aria-hidden className={`shrink-0 ${iconClassName}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[14px] font-medium text-ink">{title}</span>
        {body && <p className="m-0 text-[13px] leading-[1.45] text-muted">{body}</p>}
      </div>
      <IconButton icon={X} size={14} aria-label="Dismiss" onClick={onClose} />
    </div>
  )
}
