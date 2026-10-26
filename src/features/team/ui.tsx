/**
 * Team-local primitives that mirror the pen components used across the Team
 * screens (Button/*, Chip/*, Switch/*, Icon Tile, Select, Input, Seg Item,
 * Option Tile, Radio, Drawer shell). Kept local to the feature — the shared
 * DS Button is the compact 30px/12.5 variant, these are the 32px/14 ones.
 */
import { useEffect } from 'react'
import { SegmentedTabs } from '../../ui/ds/Segmented'
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ── Buttons (pen Button/Primary Upfho · Secondary sqbAw · Quiet p38fT · Danger DUk7e · Danger Solid YSMba) ──

type BtnVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'danger-solid'

const BTN_LOOK: Record<BtnVariant, { box: string; icon: string; label: string }> = {
  primary: { box: 'bg-primary outline-1 -outline-offset-1 outline-primary hover:bg-primary-hover', icon: 'text-primary-ink', label: 'text-primary-ink font-medium' },
  secondary: { box: 'bg-surface outline-1 -outline-offset-1 outline-line-strong hover:bg-soft', icon: 'text-ink', label: 'text-ink font-medium' },
  quiet: { box: 'hover:bg-hover', icon: 'text-muted', label: 'text-muted' },
  danger: { box: 'bg-surface outline-1 -outline-offset-1 outline-bad-line hover:bg-bad-tint', icon: 'text-bad', label: 'text-bad font-medium' },
  'danger-solid': { box: 'bg-bad-solid outline-1 -outline-offset-1 outline-bad-solid hover:opacity-90', icon: 'text-primary-ink', label: 'text-primary-ink font-medium' },
}

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  h?: number
  fs?: number
  px?: number
  radius?: number
  icon?: LucideIcon
  labelClass?: string
}

export function Btn({
  variant = 'secondary',
  h = 32,
  fs = 13,
  px = 14,
  radius = 7,
  icon: Icon,
  labelClass = '',
  className = '',
  children,
  type = 'button',
  style,
  ...rest
}: BtnProps) {
  const look = BTN_LOOK[variant]
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-[6px] whitespace-nowrap transition-colors ${look.box} ${className}`}
      style={{ height: h, paddingLeft: px, paddingRight: px, borderRadius: radius, ...style }}
      {...rest}
    >
      {Icon && <Icon size={16} aria-hidden className={look.icon} />}
      <span className={`${look.label} ${labelClass}`} style={{ fontSize: fs }}>
        {children}
      </span>
    </button>
  )
}

/** pen `Icon Button` (u1cQLT): 28 · radius 6 · icon 16 muted. */
export function IconBtn({
  icon: Icon,
  label,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`inline-flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover ${className}`}
      {...rest}
    >
      <Icon size={16} aria-hidden />
    </button>
  )
}

// ── Chips (pen Chip/Up · Run · Warn · Idle · Neutral) ──────────────────────────

export type ChipTone = 'ok' | 'info' | 'warn' | 'idle' | 'neutral'

const CHIP: Record<ChipTone, string> = {
  ok: 'bg-ok-tint outline-ok-line text-ok',
  info: 'bg-info-tint outline-info-line text-info',
  warn: 'bg-warn-tint outline-warn-line text-warn',
  idle: 'bg-transparent outline-wire-strong text-muted',
  neutral: 'bg-soft outline-line-strong text-ink-2',
}

export function Chip({
  tone,
  icon: Icon,
  children,
  h = 22,
  className = '',
  labelClass = '',
}: {
  tone: ChipTone
  icon?: LucideIcon
  children: ReactNode
  h?: number
  className?: string
  labelClass?: string
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-[4px] rounded-sm px-[8px] outline-1 -outline-offset-1 ${CHIP[tone]} ${className}`}
      style={{ height: h }}
    >
      {Icon && <Icon size={12} aria-hidden />}
      <span className={`font-medium whitespace-nowrap ${labelClass.includes('text-[') ? '' : 'text-[12px]'} ${labelClass}`}>
        {children}
      </span>
    </span>
  )
}

// ── Switch (pen Switch/On y1lHE · Switch/Off o4QgH) ────────────────────────────

export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange?: (v: boolean) => void
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

// ── Icon Tile (pen vwHMT) ──────────────────────────────────────────────────────

export function IconTile({
  icon: Icon,
  iconClass = 'text-ink-2',
}: {
  icon: LucideIcon
  iconClass?: string
}) {
  return (
    <span className="flex size-[32px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
      <Icon size={16} aria-hidden className={iconClass} />
    </span>
  )
}

// ── Fields (pen Select gVDns · Input PzYhe · Input/Focus R2juh · Textarea GPKxc) ─

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-[13px] font-medium text-ink-2">{children}</span>
}

export function SelectField({
  label,
  icon: Icon,
  value,
  fs = 13,
  width,
  className = '',
  style,
}: {
  label?: string
  icon?: LucideIcon
  value: string
  fs?: number
  width?: number
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div className={`flex shrink-0 flex-col gap-[6px] ${className}`} style={{ width, ...style }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <button
        type="button"
        className="flex h-[36px] w-full items-center gap-[8px] rounded-base bg-surface px-[10px] text-left outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
      >
        {Icon && <Icon size={16} aria-hidden className="shrink-0 text-muted" />}
        <span className="min-w-0 flex-1 truncate text-ink" style={{ fontSize: fs }}>
          {value}
        </span>
        <ChevronDown size={16} aria-hidden className="shrink-0 text-muted" />
      </button>
    </div>
  )
}

export function InputField({
  label,
  icon: Icon,
  value,
  placeholder,
  help,
  width,
  focus = false,
  mono = false,
  fs = 14,
  className = '',
}: {
  label?: string
  icon?: LucideIcon
  value?: string
  placeholder?: string
  help?: string
  width?: number
  focus?: boolean
  mono?: boolean
  fs?: number
  className?: string
}) {
  return (
    <label className={`flex shrink-0 flex-col gap-[6px] ${className}`} style={{ width }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <span
        className={`flex h-[36px] w-full items-center gap-[8px] rounded-base bg-surface px-[10px] outline-1 -outline-offset-1 ${
          focus ? 'outline-faint shadow-[0_0_6px_#A8A29E80]' : 'outline-line-strong'
        }`}
      >
        {Icon && <Icon size={16} aria-hidden className="shrink-0 text-muted" />}
        <input
          defaultValue={value}
          placeholder={placeholder}
          aria-label={label ?? placeholder}
          className={`min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint ${mono ? 'font-mono' : ''}`}
          style={{ fontSize: fs }}
        />
      </span>
      {help && <span className="text-[12.5px] text-muted">{help}</span>}
    </label>
  )
}

export function TextareaField({ label, value }: { label: string; value: string }) {
  return (
    <label className="flex w-full flex-col gap-[6px]">
      <FieldLabel>{label}</FieldLabel>
      <textarea
        defaultValue={value}
        className="h-[88px] w-full resize-none rounded-base bg-surface px-[10px] py-[8px] text-[14px] leading-[1.43] text-ink outline-1 -outline-offset-1 outline-line-strong"
      />
    </label>
  )
}

// ── Segmented control (pen Seg Item/On xoS7e · Seg Item/Off ABGqb) ─────────────

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  bg = 'bg-soft',
  onBg = 'bg-surface',
}: {
  items: readonly T[]
  value: T
  onChange?: (v: T) => void
  bg?: string
  onBg?: string
}) {
  return <SegmentedTabs options={items.map((it) => ({ id: it, label: it }))} value={value} onChange={onChange} bg={bg} onBg={onBg} />
}

// ── Radio (pen Radio/On hufFB · Radio/Off XCuSG) ───────────────────────────────

export function Radio({ on }: { on: boolean }) {
  return on ? (
    <span className="flex size-[16px] shrink-0 items-center justify-center rounded-[8px] bg-primary">
      <span className="size-[6px] rounded-full bg-primary-ink" />
    </span>
  ) : (
    <span className="size-[16px] shrink-0 rounded-[8px] bg-surface outline-1 -outline-offset-1 outline-[#A8A29E]" />
  )
}

/** Selectable card with a 2px ink ring when picked (pen Option Tile / radio cards). */
export function choiceRing(selected: boolean) {
  return selected
    ? 'outline-2 -outline-offset-2 outline-ink'
    : 'outline-1 -outline-offset-1 outline-line-strong'
}

// ── Section labels / heads ─────────────────────────────────────────────────────

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="text-[10.5px] font-semibold tracking-[1px] text-faint">{children}</span>
}

export function SettingRow({
  title,
  desc,
  last = false,
  titleSize = 13.5,
  children,
}: {
  title: string
  desc?: string
  last?: boolean
  titleSize?: number
  children?: ReactNode
}) {
  return (
    <div className={`flex w-full items-center gap-[16px] py-[12px] ${last ? '' : 'shadow-[inset_0_-1px_0_var(--color-line)]'}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="font-medium text-ink" style={{ fontSize: titleSize }}>
          {title}
        </span>
        {desc && <span className="text-[12px] text-muted">{desc}</span>}
      </div>
      {children}
    </div>
  )
}

// ── Drawer shell (pen Drawer · Channel Drawer · Doc Drawer) ────────────────────

export function Drawer({
  width = 560,
  label,
  onClose,
  head,
  footer,
  children,
  bodyClass = 'gap-[16px] p-[20px]',
}: {
  width?: number
  label: string
  onClose: () => void
  head: ReactNode
  footer?: ReactNode
  children: ReactNode
  bodyClass?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[#0C0A0926] duration-150 animate-in fade-in-0" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="absolute top-[8px] right-[8px] bottom-[8px] flex flex-col overflow-hidden rounded-lg bg-surface shadow-[-8px_0_48px_#1C19173D] outline-1 -outline-offset-1 outline-line-strong duration-200 ease-soft animate-in fade-in-0 slide-in-from-right-6"
        style={{ width }}
      >
        <div className="flex w-full shrink-0 items-center gap-[12px] shadow-[inset_0_-1px_0_var(--color-line)] py-[14px] pr-[12px] pl-[20px]">
          {head}
        </div>
        <div className={`flex min-h-0 w-full flex-1 flex-col overflow-y-auto ${bodyClass}`}>{children}</div>
        {footer && (
          <div className="flex w-full shrink-0 items-center gap-[8px] shadow-[inset_0_1px_0_var(--color-line)] px-[20px] py-[12px]">
            {footer}
          </div>
        )}
      </aside>
    </div>,
    document.body,
  )
}

/** Title block used in every drawer head: heading 16/600 + muted sub. */
export function DrawerTitle({ title, sub, mono = false }: { title: string; sub: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
      <h2
        className={`m-0 text-ink ${mono ? 'font-mono text-[15px] font-medium' : 'text-[16px] font-semibold'}`}
      >
        {title}
      </h2>
      <p className="m-0 text-[12.5px] text-muted">{sub}</p>
    </div>
  )
}

export function DrawerClose({ onClose }: { onClose: () => void }) {
  return <IconBtn icon={X} label="Close" onClick={onClose} />
}
