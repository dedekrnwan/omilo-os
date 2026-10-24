/**
 * Local primitives for Office · Routines that mirror pen components not (yet) in src/ui/ds.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Check, ChevronDown, X } from 'lucide-react'
import { IconButton } from '../../ui/ds/Button'

/** pen `Switch/On` (y1lHE) / `Switch/Off` (o4QgH): 32×18 · r9 · p2 · knob 14. */
export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange?: (on: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange?.(!on)}
      className={`flex h-[18px] w-[32px] shrink-0 items-center rounded-[9px] p-[2px] transition-colors ${
        on ? 'justify-end bg-primary' : 'justify-start bg-line-strong'
      }`}
    >
      <span className="size-[14px] rounded-full bg-white shadow-[0_1px_2px_#0000002E]" />
    </button>
  )
}

/** pen `Seg Item/On` (xoS7e) / `Seg Item/Off` (ABGqb) inside a `$app` r8 p2 gap2 track. */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  fill = false,
  label,
}: {
  items: readonly T[]
  value: T
  onChange?: (v: T) => void
  fill?: boolean
  label?: string
}) {
  return (
    <div role="tablist" aria-label={label} className={`flex gap-[2px] rounded-base bg-app p-[2px] ${fill ? 'w-full' : ''}`}>
      {items.map((it) => {
        const on = it === value
        return (
          <button
            key={it}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange?.(it)}
            className={`flex h-[28px] items-center rounded-sm px-[10px] text-[12px] font-medium ${
              fill ? 'flex-1 justify-center' : ''
            } ${on ? 'bg-surface text-ink shadow-[0_1px_2px_#00000014]' : 'text-muted hover:text-ink-2'}`}
          >
            {it}
          </button>
        )
      })}
    </div>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon
  height?: number
  fontSize?: number
}

/** pen `Button/Secondary` (sqbAw): h-32 · r7 · px14 · gap6 · icon 16 · 14/500. */
export function SecondaryButton({ icon: Icon, height = 32, fontSize = 14, className = '', children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-[6px] rounded-btn bg-surface px-[14px] font-medium whitespace-nowrap text-ink outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft ${className}`}
      style={{ height, fontSize }}
      {...rest}
    >
      {Icon && <Icon size={16} aria-hidden className="text-ink" />}
      {children}
    </button>
  )
}

/** pen `Button/Primary` (Upfho): h-32 · r7 · px14 · gap6 · icon 16 · 14/500. */
export function PrimaryButton({ icon: Icon, height = 32, fontSize = 14, className = '', children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center gap-[6px] rounded-btn bg-primary px-[14px] font-medium whitespace-nowrap text-primary-ink transition-colors hover:bg-primary-hover ${className}`}
      style={{ height, fontSize }}
      {...rest}
    >
      {Icon && <Icon size={16} aria-hidden />}
      {children}
    </button>
  )
}

/** pen `Button/Danger` (DUk7e): outlined, bad-line stroke. */
export function DangerButton({ icon: Icon, className = '', children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={`inline-flex h-[32px] shrink-0 items-center justify-center gap-[6px] rounded-btn bg-surface px-[14px] text-[14px] font-medium whitespace-nowrap text-bad outline-1 -outline-offset-1 outline-bad-line hover:bg-bad-tint ${className}`}
      {...rest}
    >
      {Icon && <Icon size={16} aria-hidden />}
      {children}
    </button>
  )
}

/** pen `Select` (gVDns) / `Input` (PzYhe) field: h-36 · r8 · line-strong · gap8 · px10 · 14. */
export function Field({
  icon: Icon,
  value,
  label,
  chevron = false,
  className = '',
}: {
  icon?: LucideIcon
  value: string
  label?: string
  chevron?: boolean
  className?: string
}) {
  const field = (
    <div className="flex h-[36px] w-full items-center gap-[8px] rounded-base bg-surface px-[10px] outline-1 -outline-offset-1 outline-line-strong">
      {Icon && <Icon size={16} aria-hidden className="shrink-0 text-muted" />}
      <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{value}</span>
      {chevron && <ChevronDown size={16} aria-hidden className="shrink-0 text-muted" />}
    </div>
  )
  if (!label) return <div className={className}>{field}</div>
  return (
    <label className={`flex min-w-0 flex-col gap-[6px] ${className}`}>
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      {field}
    </label>
  )
}

/** pen `Toggle Row` (U1Cccn): py12 · gap12 · bottom line · title 13.5/500 · desc 12.5/1.5 muted. */
export function ToggleRow({ title, desc, on, onChange }: { title: string; desc: string; on: boolean; onChange?: (v: boolean) => void }) {
  return (
    <div className="flex w-full gap-[12px] shadow-[inset_0_-1px_0_var(--color-line)] py-[12px]">
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[13.5px] font-medium text-ink">{title}</span>
        <span className="text-[12.5px] leading-[1.5] text-muted">{desc}</span>
      </div>
      <Switch on={on} onChange={onChange} label={title} />
    </div>
  )
}

/** pen `Chip/Neutral` (KMRv6) / `Chip/Up` (Elczk) / `Chip/Down` (UcO9p): h-22 · r6 · px8 · gap4 · 12/500. */
export function Chip({ icon: Icon, label, tone = 'neutral' }: { icon?: LucideIcon; label: string; tone?: 'neutral' | 'ok' | 'bad' }) {
  const look =
    tone === 'ok'
      ? 'bg-ok-tint text-ok outline-ok-line'
      : tone === 'bad'
        ? 'bg-bad-tint text-bad outline-bad-line'
        : 'bg-soft text-ink-2 outline-line-strong'
  return (
    <span
      className={`inline-flex h-[22px] shrink-0 items-center gap-[4px] rounded-sm px-[8px] text-[12px] font-medium whitespace-nowrap outline-1 -outline-offset-1 ${look}`}
    >
      {Icon && <Icon size={12} aria-hidden />}
      {label}
    </span>
  )
}

/** pen `Checkbox/On` (l3E9dD) / `Checkbox/Off` (qswGP): 16 · r4. */
export function Checkbox({ checked }: { checked: boolean }) {
  return checked ? (
    <span className="flex size-[16px] shrink-0 items-center justify-center rounded-xs bg-primary">
      <Check size={12} strokeWidth={3} aria-hidden className="text-primary-ink" />
    </span>
  ) : (
    <span className="size-[16px] shrink-0 rounded-xs bg-surface outline-1 -outline-offset-1 outline-faint" />
  )
}

/** pen `Option Tile` (MFJM0) / `Option Tile/Selected` (jrQbn). */
export function OptionTile({
  icon: Icon,
  title,
  desc,
  selected,
  onClick,
}: {
  icon: LucideIcon
  title: string
  desc: string
  selected?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={!!selected}
      onClick={onClick}
      className={`flex w-full min-w-0 flex-1 gap-[10px] rounded-md bg-surface px-[12px] py-[10px] text-left ${
        selected ? 'outline-2 -outline-offset-2 outline-ink' : 'outline-1 -outline-offset-1 outline-line-strong'
      }`}
    >
      <Icon size={18} aria-hidden className="shrink-0 text-ink-2" />
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[13.5px] font-medium text-ink">{title}</span>
        <span className="text-[12px] text-muted">{desc}</span>
      </span>
    </button>
  )
}

/** Section label used inside routine drawers: 12/600 ink-2 (+0.2 tracking on most). */
export function SectionLabel({ children, tracking = true }: { children: ReactNode; tracking?: boolean }) {
  return (
    <span className={`text-[12px] font-semibold text-ink-2 ${tracking ? 'tracking-[0.2px]' : ''}`}>{children}</span>
  )
}

/** Full-screen scrim (#0C0A0959). */
export function Scrim({ onClick }: { onClick?: () => void }) {
  return <div aria-hidden className="fixed inset-0 z-40 bg-[#0C0A0959]" onClick={onClick} />
}

/**
 * pen routine `Drawer`: fixed 480 wide, 8px from the right/top/bottom, r20, big shadow.
 * Header (serif 22 title + 13 sub + close), scrolling Body, soft Footer.
 */
export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
  bodyClass = 'gap-[18px] px-[24px] py-[20px]',
}: {
  title: string
  subtitle: string
  onClose: () => void
  children: ReactNode
  footer: ReactNode
  bodyClass?: string
}) {
  return (
    <>
      <Scrim onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed top-[8px] right-[8px] bottom-[8px] z-50 flex w-[480px] flex-col overflow-hidden rounded-dialog bg-surface shadow-[0_24px_64px_#0C0A0940]"
      >
        <header className="flex w-full shrink-0 gap-[12px] shadow-[inset_0_-1px_0_var(--color-line)] pt-[20px] pr-[16px] pb-[16px] pl-[24px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <h2 className="m-0 font-serif text-[22px] leading-[27px] font-medium tracking-[-0.22px] text-ink">{title}</h2>
            <p className="m-0 text-[13px] text-muted">{subtitle}</p>
          </div>
          <IconButton icon={X} aria-label="Close" onClick={onClose} />
        </header>
        <div className={`flex min-h-0 w-full flex-1 flex-col overflow-y-auto ${bodyClass}`}>{children}</div>
        <footer className="flex w-full shrink-0 items-center gap-[8px] shadow-[inset_0_1px_0_var(--color-line)] bg-soft px-[24px] py-[14px]">
          {footer}
        </footer>
      </aside>
    </>
  )
}

/** "You" avatar used in the BY column: 16 · #57534E · white "D" 8/700. */
export function YouAvatar() {
  return (
    <span className="flex size-[16px] shrink-0 items-center justify-center rounded-full bg-[#57534E] text-[8px] font-bold text-white">
      D
    </span>
  )
}
