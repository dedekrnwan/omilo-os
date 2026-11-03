import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Pin, Plus } from 'lucide-react'
import { ContextMenuArea, MoreMenu } from './ItemMenu'
import type { MenuEntries } from './ItemMenu'
import type { LucideIcon } from 'lucide-react'
import type { SessionParticipant } from '../../core/domain/types'
import { Mascot } from './Mascot'

/** Overlapping mini-avatars of the helpers in a chat (up to 3, then "+N"). */
function ParticipantStack({ participants }: { participants: SessionParticipant[] }) {
  const shown = participants.slice(0, 3)
  const extra = participants.length - shown.length
  return (
    <span className="flex shrink-0 items-center" aria-label={`${participants.length} in this chat`}>
      {shown.map((p, i) => (
        <span key={i} className={`rounded-[5px] outline-1 -outline-offset-1 outline-app ${i > 0 ? '-ml-[5px]' : ''}`}>
          <Mascot size={15} radius={5} area={p.area} still title={p.name} />
        </span>
      ))}
      {extra > 0 && (
        <span className="-ml-[5px] flex size-[15px] items-center justify-center rounded-[5px] bg-soft text-[8.5px] font-medium text-muted outline-1 -outline-offset-1 outline-app">
          +{extra}
        </span>
      )}
    </span>
  )
}

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

/** Inline rename field used by sidebar rows. */
function RenameField({ value, onCommit, className = '' }: { value: string; onCommit: (next: string | null) => void; className?: string }) {
  return (
    <input
      autoFocus
      aria-label="New name"
      defaultValue={value}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.currentTarget.value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          e.currentTarget.value = ''
          onCommit(null)
        }
      }}
      className={`pointer-events-auto relative z-10 h-[22px] min-w-0 flex-1 rounded-xs bg-surface px-[5px] text-[12.5px] text-ink outline-1 outline-ink ${className}`}
    />
  )
}

/** Hover ⋯ shown at the right of a row (same entries as right-click). */
function RowMore({ items, label }: { items: MenuEntries; label: string }) {
  return (
    <span className="pointer-events-auto relative z-10 hidden group-hover/row:flex group-focus-within/row:flex has-[[data-state=open]]:flex">
      <MoreMenu items={items} label={label} size={20} />
    </span>
  )
}

/**
 * pen `Folder Row` (s0CjkQ): h-28 · radius 6 · gap 6 · padding 0 8 0 6 ·
 * chevron 12 faint · folder 15 muted · label 13 ink-2 · count 11.5 muted.
 * With `menu`: right-click and a hover ⋯ open the folder's actions.
 */
export function FolderRow({
  name,
  count,
  open,
  onToggle,
  iconSlot,
  menu,
  renaming,
  onRename,
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
  menu?: MenuEntries
  renaming?: boolean
  onRename?: (next: string | null) => void
}) {
  const Chevron = open ? ChevronDown : ChevronRight
  const Icon = open ? FolderOpen : Folder
  const row = (
    <div className="group/row relative flex h-[28px] w-full items-center rounded-sm transition-colors hover:bg-hover data-[state=open]:bg-hover">
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
        {renaming ? (
          <RenameField value={name} onCommit={(v) => onRename?.(v)} />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{name}</span>
        )}
        {!renaming && (
          <span className={`text-[11.5px] text-muted ${menu ? 'group-hover/row:hidden group-focus-within/row:hidden' : ''}`}>{count}</span>
        )}
        {menu && !renaming && <RowMore items={menu} label={`${name} actions`} />}
      </span>
    </div>
  )
  return menu ? (
    <ContextMenuArea items={menu} label={`${name} actions`}>
      {row}
    </ContextMenuArea>
  ) : (
    row
  )
}

/**
 * pen `Chat Row` (mG8wG): radius 6 · gap 8 · padding 5/8 · unread dot 6 brand ·
 * title 12.5 ink-2 · time 11.5 faint. Active = hover fill, title ink 500.
 * With `menu`: right-click and a hover ⋯ open the chat's actions.
 */
export function ChatRow({
  title,
  time,
  unread,
  active,
  onClick,
  menu,
  renaming,
  onRename,
  pinned,
  participants,
}: {
  title: string
  time: string
  unread?: boolean
  active?: boolean
  onClick?: () => void
  menu?: MenuEntries
  renaming?: boolean
  onRename?: (next: string | null) => void
  pinned?: boolean
  participants?: SessionParticipant[]
}) {
  const row = (
    <div
      className={`group/row relative flex w-full items-center rounded-sm transition-colors data-[state=open]:bg-hover ${
        active ? 'bg-hover' : 'hover:bg-hover'
      }`}
    >
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        aria-label={title}
        onClick={onClick}
        className="absolute inset-0 rounded-sm"
      />
      <span className="pointer-events-none relative flex w-full items-center gap-[8px] px-[8px] py-[5px]">
        {unread && <span aria-label="unread" className="size-[6px] shrink-0 rounded-full bg-helper-brand" />}
        {pinned && <Pin size={11} aria-label="pinned" className="shrink-0 -rotate-45 text-faint" />}
        {renaming ? (
          <RenameField value={title} onCommit={(v) => onRename?.(v)} className="-my-[3px]" />
        ) : (
          <span className={`min-w-0 flex-1 truncate text-[12.5px] ${active ? 'font-medium text-ink' : 'text-ink-2'}`}>{title}</span>
        )}
        {!renaming && participants && participants.length > 0 && (
          <span className={menu ? 'group-hover/row:hidden group-focus-within/row:hidden' : ''}>
            <ParticipantStack participants={participants} />
          </span>
        )}
        {!renaming && (
          <span className={`text-[11.5px] whitespace-nowrap text-faint ${menu ? 'group-hover/row:hidden group-focus-within/row:hidden' : ''}`}>{time}</span>
        )}
        {menu && !renaming && (
          <span className="-my-[2px] -mr-[3px]">
            <RowMore items={menu} label={`${title} actions`} />
          </span>
        )}
      </span>
    </div>
  )
  return menu ? (
    <ContextMenuArea items={menu} label={`${title} actions`}>
      {row}
    </ContextMenuArea>
  ) : (
    row
  )
}
