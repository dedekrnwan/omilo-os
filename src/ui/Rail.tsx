import { useState } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Bell,
  Building2,
  ChevronDown,
  CircleHelp,
  CreditCard,
  Ellipsis,
  Keyboard,
  LogOut,
  MessageCircle,
  MessageSquareHeart,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useUIStore } from '../app/store'
import { Mascot } from './ds/Mascot'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from './ds/Menu'

// ── Companies ─────────────────────────────────────────────────────────────────

const COMPANIES = [
  { id: 'sahabat-warga', name: 'Sahabat Warga', initial: 'S', color: '#EB6834', active: true },
  { id: 'kopi-kenangan', name: 'Kopi Kenangan', initial: 'K', color: '#6366F1', badge: true },
] as const

/** 40×40 company tile with a 30×30 initial avatar inset 5px; active = 2px company-colour ring. */
function CompanyTile({
  name,
  initial,
  color,
  active,
  badge,
}: {
  name: string
  initial: string
  color: string
  active?: boolean
  badge?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={active ? `${name} (active)` : name}
      aria-current={active ? 'true' : undefined}
      className="relative size-[40px] shrink-0 rounded-lg"
      style={active ? { outline: `2px solid ${color}`, outlineOffset: -1 } : undefined}
    >
      <span
        className="absolute top-[5px] left-[5px] flex size-[30px] items-center justify-center rounded-[9px] text-[13px] font-semibold text-white"
        style={{ background: color }}
      >
        {initial}
      </span>
      {badge && (
        <span
          aria-label="unread activity"
          className="absolute top-[2px] left-[27px] size-[11px] rounded-full border-2 border-app bg-[#C2410C]"
        />
      )}
    </button>
  )
}

// ── Bottom actions tray (pen `Rail · bottom actions`) ─────────────────────────

/** Dark tooltip to the right of a rail button: h-26 · radius 7 · px-9 · gap 8 · 12px white · optional kbd. */
function RailTooltip({ label, kbd }: { label: string; kbd?: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute top-1/2 left-[calc(100%+10px)] z-50 hidden h-[26px] -translate-y-1/2 items-center gap-[8px] rounded-btn bg-primary px-[9px] whitespace-nowrap shadow-[0_4px_10px_#0C0A0929] group-hover:flex group-focus-visible:flex"
    >
      <span className="text-[12px] text-white">{label}</span>
      {kbd && (
        <span className="flex h-[16px] items-center rounded-xs bg-[#FFFFFF1F] px-[4px] font-mono text-[10px] text-on-ink-2">
          {kbd}
        </span>
      )}
    </span>
  )
}

/** Orange unread dot on a 30×30 rail button. */
function UnreadDot() {
  return (
    <span
      aria-hidden
      className="absolute top-[4px] left-[17px] size-[8px] rounded-full border-2 border-app bg-[#EB6834]"
    />
  )
}

/** Two overlapping helper mascots — the Team glyph. */
function TeamGlyph() {
  return (
    <span aria-hidden className="relative block size-[30px]">
      <span className="absolute top-[5px] left-0">
        <Mascot size={20} radius={0} area="dev" tile={false} />
      </span>
      <span className="absolute top-[8px] left-[11px]">
        <Mascot size={20} radius={0} area="marketing" tile={false} />
      </span>
    </span>
  )
}

type TrayContext = 'rail' | 'tray'

/**
 * 30×30 rail button (radius 10 · icon 17 ink-2).
 * On the rail: hover = #E7E5E4A6, current page = hover fill + ink icon.
 * Inside the open tray: hover = soft white chip, current page = white + shadow.
 */
function TrayButton({
  label,
  tooltip,
  kbd,
  icon: Icon,
  glyph,
  dot,
  current,
  context = 'rail',
  onClick,
  iconClassName,
  expanded,
}: {
  label: string
  tooltip: string
  kbd?: string
  icon?: LucideIcon
  glyph?: React.ReactNode
  dot?: boolean
  current?: boolean
  context?: TrayContext
  onClick?: () => void
  iconClassName?: string
  expanded?: boolean
}) {
  const look =
    context === 'tray'
      ? current
        ? 'bg-surface shadow-[0_1px_3px_#0C0A091F]'
        : 'hover:bg-[#FFFFFF99]'
      : current
        ? 'bg-hover'
        : 'hover:bg-[#E7E5E4A6]'
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      aria-expanded={expanded}
      onClick={onClick}
      className={`group relative flex size-[30px] shrink-0 items-center justify-center ${
        glyph ? 'rounded-[9px]' : 'rounded-md'
      } transition-colors ${look}`}
    >
      {glyph ??
        (Icon && (
          <Icon size={17} aria-hidden className={iconClassName ?? (current ? 'text-ink' : 'text-ink-2')} />
        ))}
      {dot && <UnreadDot />}
      <RailTooltip label={tooltip} kbd={kbd} />
    </button>
  )
}

export type RailPage = 'team' | 'notifications' | 'settings' | 'autonomy'

interface BottomActionsProps {
  /** Unread notifications (bell shows while > 0). */
  unread?: number
  helpers?: number
  /** Autonomy mode; anything but "ask" keeps the shield visible. */
  autonomy?: 'ask' | 'yolo'
  /** Page currently open, if it is one of the tray's pages. */
  currentPage?: RailPage
}

/**
 * Team, Notifications, Settings and Autonomy live in a tray behind ⋯.
 * Collapsed, only items with something to show stay out (unread bell,
 * current page, non-default autonomy). ⋯ opens the tray; ⌄ closes it.
 */
function BottomActions({ unread = 3, helpers = 6, autonomy = 'ask', currentPage }: BottomActionsProps) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const yolo = autonomy === 'yolo'
  const autonomyProps = {
    label: 'Autonomy',
    tooltip: `Autonomy · ${yolo ? 'YOLO' : 'Ask'}`,
    kbd: '⌥ A',
    icon: yolo ? Zap : ShieldCheck,
    iconClassName: yolo ? 'text-warn' : undefined,
    current: currentPage === 'autonomy',
  }
  const items = {
    team: {
      label: 'Team',
      tooltip: `Team · ${helpers} helpers`,
      kbd: 'G T',
      glyph: <TeamGlyph />,
      current: currentPage === 'team',
      onClick: () => void navigate({ to: '/team' }),
    },
    notifications: {
      label: 'Notifications',
      tooltip: unread > 0 ? `Notifications · ${unread} new` : 'Notifications',
      kbd: 'G N',
      icon: Bell,
      dot: unread > 0,
      current: currentPage === 'notifications',
      onClick: () => void navigate({ to: '/notifications' }),
    },
    settings: {
      label: 'Settings',
      tooltip: 'Control panel',
      kbd: 'G ,',
      icon: Settings,
      current: currentPage === 'settings',
      onClick: () => void navigate({ to: '/control-panel' }),
    },
    autonomy: autonomyProps,
  }

  if (open) {
    return (
      <div role="group" aria-label="Rail actions" className="flex flex-col items-center gap-[2px] rounded-lg bg-[#E7E5E4] p-[3px]">
        <TrayButton context="tray" {...items.team} />
        <TrayButton context="tray" {...items.notifications} />
        <TrayButton context="tray" {...items.settings} />
        <TrayButton context="tray" {...items.autonomy} />
        <button
          type="button"
          aria-label="Close tray"
          aria-expanded
          onClick={() => setOpen(false)}
          className="flex h-[18px] w-[30px] items-center justify-center rounded-sm text-muted transition-colors hover:bg-[#FFFFFF99]"
        >
          <ChevronDown size={14} aria-hidden />
        </button>
      </div>
    )
  }

  const bellOut = unread > 0 || items.notifications.current
  return (
    <div role="group" aria-label="Rail actions" className="flex flex-col items-center gap-[10px] rounded-lg">
      {items.team.current && <TrayButton {...items.team} />}
      {bellOut && <TrayButton {...items.notifications} />}
      {items.settings.current && <TrayButton {...items.settings} />}
      {(yolo || items.autonomy.current) && <TrayButton {...items.autonomy} />}
      <TrayButton
        label="More"
        tooltip="More actions"
        icon={Ellipsis}
        dot={!bellOut && unread > 0}
        expanded={false}
        onClick={() => setOpen(true)}
      />
    </div>
  )
}

/** Chat ↔ Office segmented switch (fill #E7E5E4 · radius 10 · p-3 · gap 2). */
function ModeSegment({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string
  icon: LucideIcon
  active: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`flex size-[28px] items-center justify-center rounded-btn transition-colors ${
        active ? 'bg-surface text-ink shadow-[0_1px_3px_#0C0A091F]' : 'text-muted hover:text-ink-2'
      }`}
    >
      <Icon size={15} aria-hidden />
    </button>
  )
}

// ── Profile menu (pen `Profile Menu` NqUoT) ──────────────────────────────────

const PROFILE_ITEMS: { icon: LucideIcon; label: string; hint?: string }[][] = [
  [
    { icon: UserRound, label: 'Account' },
    { icon: CreditCard, label: 'Subscription & billing' },
    { icon: Settings, label: 'Settings', hint: '⌘,' },
    { icon: Bell, label: 'Notification settings' },
  ],
  [
    { icon: CircleHelp, label: 'Help & docs' },
    { icon: MessageSquareHeart, label: 'Send feedback' },
    { icon: Keyboard, label: 'Keyboard shortcuts', hint: '?' },
  ],
]

function ProfileMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="User menu"
        className="flex size-[28px] shrink-0 items-center justify-center rounded-full bg-[#D6D3D1] text-[11px] font-semibold text-ink-2 outline-none data-[state=open]:ring-2 data-[state=open]:ring-ink"
      >
        DK
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="right"
          align="end"
          sideOffset={10}
          alignOffset={-4}
          className={`z-50 w-[260px] ${menuSurface}`}
        >
          <div className="flex items-center gap-[10px] p-[10px]">
            <span className="flex size-[36px] items-center justify-center rounded-full bg-[#FED7AA] text-[13px] font-semibold text-[#9A3412]">
              DK
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[14px] font-semibold text-ink">Dede Kurniawan</span>
              <span className="text-[12px] text-muted">dede@sahabatwarga.id</span>
            </div>
          </div>
          <div className="px-[6px] pb-[6px]">
            <div className="flex flex-col gap-[6px] rounded-base outline-1 -outline-offset-1 outline-line bg-soft px-[12px] py-[10px]">
              <div className="flex items-center gap-[6px]">
                <span className="text-[12px] font-semibold text-ink">Team plan</span>
                <span className="h-px flex-1" />
                <span className="font-mono text-[11px] text-muted">Rp 1,2 jt / 2 jt</span>
              </div>
              <div className="h-[4px] overflow-hidden rounded-[2px] bg-line-strong">
                <div className="h-full w-[60%] rounded-[2px] bg-ink" />
              </div>
            </div>
          </div>
          {PROFILE_ITEMS.map((group, i) => (
            <div key={i}>
              <MenuSeparatorLine />
              {group.map((item) => (
                <DropdownMenu.Item key={item.label} className={menuItemClass}>
                  <MenuItemBody icon={item.icon} label={item.label} hint={item.hint} />
                </DropdownMenu.Item>
              ))}
            </div>
          ))}
          <MenuSeparatorLine />
          <DropdownMenu.Item className={menuItemClass}>
            <MenuItemBody icon={LogOut} label="Log out" danger />
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ── Rail ──────────────────────────────────────────────────────────────────────

/**
 * pen `Rail` (hyn98): 56 wide · fill app · padding 12/0 · gap 10 · centered.
 * Omilo mark → companies → spacer → tray (notifications, more) →
 * Chat/Office mode switch → you.
 */
export function Rail({ onOpenCommandMenu }: { onOpenCommandMenu?: () => void } = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { mode, toggleTarget } = useUIStore()
  const isChat = mode === 'chat'

  const currentPage: RailPage | undefined = location.pathname.startsWith('/team')
    ? 'team'
    : location.pathname.startsWith('/notifications')
      ? 'notifications'
      : location.pathname.startsWith('/control-panel')
        ? 'settings'
        : undefined

  function switchMode() {
    const target = toggleTarget()
    void navigate({ to: target.path })
  }

  return (
    <nav
      aria-label="main rail"
      className="flex h-full w-[56px] shrink-0 flex-col items-center gap-[10px] bg-app py-[12px]"
    >
      <Mascot size={30} radius={9} title="Omilo" />

      <div className="flex flex-col items-center gap-[8px] pt-[6px]">
        {COMPANIES.map((c) => (
          <CompanyTile key={c.id} {...c} />
        ))}
        <button
          type="button"
          aria-label="Add company"
          title="Add company"
          className="flex size-[30px] items-center justify-center rounded-[9px] text-muted transition-colors hover:bg-hover"
        >
          <Plus size={16} aria-hidden />
        </button>
      </div>

      <div className="w-px flex-1" />

      {onOpenCommandMenu && (
        <TrayButton
          label="Search"
          tooltip="Search"
          kbd="⌘K"
          icon={Search}
          onClick={onOpenCommandMenu}
        />
      )}

      <BottomActions currentPage={currentPage} />

      <div role="group" aria-label="Mode" className="flex flex-col gap-[2px] rounded-md bg-[#E7E5E4] p-[3px]">
        <ModeSegment label="Chat" icon={MessageCircle} active={isChat} onClick={isChat ? undefined : switchMode} />
        <ModeSegment label="Office" icon={Building2} active={!isChat} onClick={isChat ? switchMode : undefined} />
      </div>

      <ProfileMenu />
    </nav>
  )
}
