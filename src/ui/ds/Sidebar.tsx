import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** pen `Chat Sidebar` / `Office Sidebar` frame: 232 wide · padding 10/8 · gap 12 · fill app. */
export function SidebarFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav
      aria-label={label}
      className="relative flex h-full w-[232px] shrink-0 flex-col gap-[12px] bg-app px-[8px] py-[10px]"
    >
      {children}
    </nav>
  )
}

/** Vertical stack with 1px gap — the `Channel Nav`, `Folders`, `Recent` groups. */
export function NavGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex w-full flex-col gap-px ${className}`}>{children}</div>
}

export interface NavLinkProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon
  /** Replaces the icon slot (e.g. the area dot in Office › Areas). */
  leading?: ReactNode
  label: string
  count?: string | number
  /** Count styling override, e.g. Office › Inbox orange count */
  countClassName?: string
  /** Label styling override (Areas rows use ink-2, Archived uses muted). */
  labelClassName?: string
  active?: boolean
}

/**
 * pen `Nav Link` (ees3C): h-28 · radius 6 · gap 8 · px 8 · icon 15 muted ·
 * label 13 ink · count 11.5 muted. Active = hover fill, ink icon, label 500.
 */
export function NavLink({
  icon: Icon,
  leading,
  label,
  count,
  countClassName = 'text-muted',
  labelClassName,
  active = false,
  className = '',
  type = 'button',
  ...rest
}: NavLinkProps) {
  return (
    <button
      type={type}
      aria-current={active ? 'true' : undefined}
      className={`flex h-[28px] w-full items-center gap-[8px] rounded-sm px-[8px] text-left transition-colors ${
        active ? 'bg-hover' : 'hover:bg-hover'
      } ${className}`}
      {...rest}
    >
      {leading ??
        (Icon && <Icon size={15} aria-hidden className={active ? 'text-ink' : 'text-muted'} />)}
      <span
        className={`min-w-0 flex-1 truncate text-[13px] ${
          active ? 'font-medium text-ink' : (labelClassName ?? 'text-ink')
        }`}
      >
        {label}
      </span>
      {count !== undefined && <span className={`text-[11.5px] ${countClassName}`}>{count}</span>}
    </button>
  )
}

/** pen `Group Label` (hFJT9) with the sidebar override padding [0,10,6,10]. */
export function GroupLabel({
  label,
  action,
}: {
  label: string
  action?: { label: string; onClick?: () => void }
}) {
  return (
    <div className="flex w-full items-center gap-[6px] px-[10px] pb-[6px]">
      <span className="flex-1 text-[10.5px] font-medium tracking-[1px] text-faint">{label}</span>
      {action && (
        <button
          type="button"
          aria-label={action.label}
          onClick={action.onClick}
          className="flex items-center justify-center rounded-xs text-faint hover:text-muted"
        >
          <Plus size={13} aria-hidden />
        </button>
      )}
    </div>
  )
}

/**
 * pen `Folder Row` (s0CjkQ): h-28 · radius 6 · gap 6 · padding 0 8 0 6 ·
 * chevron 12 faint · folder 15 muted · label 13 ink-2 · count 11.5 muted.
 */
export function FolderRow({
  name,
  count,
  open,
  onToggle,
  iconSlot,
}: {
  name: string
  count: number
  open: boolean
  onToggle: () => void
  /**
   * Replaces the folder glyph — e.g. a button that opens the icon picker.
   * Rendered outside the toggle button so it can be its own control.
   */
  iconSlot?: ReactNode
}) {
  const Chevron = open ? ChevronDown : ChevronRight
  const Icon = open ? FolderOpen : Folder
  return (
    <div className="group/folder relative flex h-[28px] w-full items-center rounded-sm transition-colors hover:bg-hover">
      {/* The whole row toggles; the icon slot sits above it as its own control. */}
      <button
        type="button"
        aria-expanded={open}
        aria-label={name}
        onClick={onToggle}
        className="absolute inset-0 rounded-sm"
      />
      <span className="pointer-events-none relative flex w-full items-center gap-[6px] pr-[8px] pl-[6px]">
        <Chevron size={12} aria-hidden className="text-faint" />
        <span className="pointer-events-auto flex">
          {iconSlot ?? <Icon size={15} aria-hidden className="text-muted" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{name}</span>
        <span className="text-[11.5px] text-muted">{count}</span>
      </span>
    </div>
  )
}

/**
 * pen `Chat Row` (mG8wG): radius 6 · gap 8 · padding 5/8 · unread dot 6 brand ·
 * title 12.5 ink-2 · time 11.5 faint. Active = hover fill, title ink 500.
 */
export function ChatRow({
  title,
  time,
  unread,
  active,
  onClick,
}: {
  title: string
  time: string
  unread?: boolean
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-[8px] rounded-sm px-[8px] py-[5px] text-left transition-colors ${
        active ? 'bg-hover' : 'hover:bg-hover'
      }`}
    >
      {unread && (
        <span aria-label="unread" className="size-[6px] shrink-0 rounded-full bg-helper-brand" />
      )}
      <span
        className={`min-w-0 flex-1 truncate text-[12.5px] ${active ? 'font-medium text-ink' : 'text-ink-2'}`}
      >
        {title}
      </span>
      <span className="text-[11.5px] whitespace-nowrap text-faint">{time}</span>
    </button>
  )
}
