import { forwardRef, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { notify } from './ds/Toaster'
import { Dialog } from './ds/Dialog'
import { Button } from './ds/Button'
import { ConfirmDialog } from './ds/ConfirmDialog'
import { FeedbackDialog } from './ds/FeedbackDialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import {
  ArrowRightLeft,
  ArrowUpRight,
  ImageUp,
  RotateCcw,
  UserPlus,
  Bell,
  Building2,
  Check,
  ChevronDown,
  CircleHelp,
  CreditCard,
  Ellipsis,
  Keyboard,
  Lock,
  LogOut,
  MessageCircle,
  MessageSquareHeart,
  Plus,
  Settings,
  ShieldCheck,
  UserRound,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useUIStore, MODE_HOME } from '../app/store'
import type { Autonomy, Mode } from '../app/store'
import { Mascot } from './ds/Mascot'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from './ds/Menu'
import { useAppearance } from '../app/appearance'
import { CompanyLogo } from './ds/CompanyLogo'
import { useCompanyLook } from './ds/looks'
import type { CompanyDefaults } from './ds/looks'
import { LookPicker } from './ds/LookPicker'
import { ContextMenuArea } from './ds/ItemMenu'
import type { MenuEntries } from './ds/ItemMenu'
import { useSession } from '../app/session'
import { useAuth } from '../app/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import type { Company } from '../core/domain/session'
import { useCompanyDetail, useSubscription, useStorage } from '../app/queries'

// ── Companies ─────────────────────────────────────────────────────────────────

/**
 * 40×40 company tile with a 30×30 logo inset 5px; active = 2px company-colour ring.
 * Right-click (or the "Change logo" item) opens the logo picker.
 */
function CompanyTile({
  company,
  active,
  badge,
  onClick,
}: {
  company: CompanyDefaults
  active?: boolean
  badge?: boolean
  onClick?: () => void
}) {
  const look = useCompanyLook(company)
  const { setLook, resetLook } = useAppearance()
  const [pickerOpen, setPickerOpen] = useState(false)
  const navigate = useNavigate()
  const menu: MenuEntries = [
    { label: active ? 'Current company' : `Switch to ${company.name}`, icon: ArrowRightLeft, disabled: active, onSelect: () => onClick?.() },
    { type: 'separator' },
    { label: 'Change logo…', icon: ImageUp, onSelect: () => setTimeout(() => setPickerOpen(true), 0) },
    { label: 'Reset logo', icon: RotateCcw, onSelect: () => resetLook('companies', company.id) },
    { type: 'separator' },
    { label: 'Company settings', icon: Settings, onSelect: () => void navigate({ to: '/control-panel/$section', params: { section: 'general' } }) },
    { label: 'Invite people', icon: UserPlus, onSelect: () => void navigate({ to: '/control-panel/$section', params: { section: 'members' } }) },
  ]
  return (
    <ContextMenuArea items={menu} label={`${company.name} actions`}>
    <div className="flex">
    <LookPicker
      kind="company"
      title={`${company.name} logo`}
      value={{ color: look.color, initial: look.initial, image: look.image }}
      onChange={(patch) => setLook('companies', company.id, patch)}
      onReset={() => resetLook('companies', company.id)}
      open={pickerOpen}
      onOpenChange={setPickerOpen}
    >
      <button
        type="button"
        aria-label={active ? `${company.name} (active)` : company.name}
        aria-current={active ? 'true' : undefined}
        title={`${company.name} — right-click for more`}
        onClick={(e) => {
          // Radix opens the picker on click; on the rail a click switches company instead.
          e.preventDefault()
          onClick?.()
        }}
        className="group relative size-[40px] shrink-0 rounded-lg transition-transform outline-none focus-visible:ring-2 focus-visible:ring-ink active:scale-90"
        style={active ? { outline: `2px solid ${look.color}`, outlineOffset: -1 } : undefined}
      >
        <CompanyLogo
          company={company}
          size={30}
          radius={9}
          fontSize={13}
          className={`absolute top-[5px] left-[5px] transition group-hover:brightness-110 ${
            active ? '' : 'opacity-85 group-hover:opacity-100'
          }`}
        />
        {badge && (
          <span
            aria-label="unread activity"
            className="absolute top-[2px] left-[27px] size-[11px] rounded-full border-2 border-app bg-[#C2410C]"
          />
        )}
      </button>
    </LookPicker>
    </div>
    </ContextMenuArea>
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
        <Mascot helper size={20} radius={0} area="dev" tile={false} />
      </span>
      <span className="absolute top-[8px] left-[11px]">
        <Mascot helper size={20} radius={0} area="marketing" tile={false} />
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
interface TrayButtonProps {
  label: string
  tooltip: string
  kbd?: string
  icon?: LucideIcon
  glyph?: React.ReactNode
  dot?: boolean
  current?: boolean
  context?: TrayContext
  onClick?: () => void
  onMouseEnter?: () => void
  onFocus?: () => void
  iconClassName?: string
  expanded?: boolean
}

const TrayButton = forwardRef<HTMLButtonElement, TrayButtonProps>(function TrayButton(
  { label, tooltip, kbd, icon: Icon, glyph, dot, current, context = 'rail', onClick, onMouseEnter, onFocus, iconClassName, expanded, ...rest },
  ref,
) {
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
      ref={ref}
      type="button"
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      aria-expanded={expanded}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      className={`group relative flex size-[30px] shrink-0 items-center justify-center ${
        glyph ? 'rounded-[9px]' : 'rounded-md'
      } outline-none transition focus-visible:ring-2 focus-visible:ring-ink active:scale-90 ${look}`}
      {...rest}
    >
      {glyph ??
        (Icon && (
          <Icon size={17} aria-hidden className={iconClassName ?? (current ? 'text-ink' : 'text-ink-2')} />
        ))}
      {dot && <UnreadDot />}
      <RailTooltip label={tooltip} kbd={kbd} />
    </button>
  )
})

// ── Autonomy popover (pen `Autonomy Popover`) ─────────────────────────────────

interface AutonomyOption {
  level: Autonomy
  icon: LucideIcon
  iconClass: string
  title: string
  kbd: string
  desc: string
}

const AUTONOMY_OPTIONS: AutonomyOption[] = [
  { level: 'strict', icon: Lock, iconClass: 'text-info', title: 'Strict', kbd: '⌥1', desc: 'Read and draft only. Every change waits.' },
  { level: 'ask', icon: ShieldCheck, iconClass: 'text-ink', title: 'Ask', kbd: '⌥2', desc: 'Work on their own. Posting, sending and spending wait.' },
  { level: 'yolo', icon: Zap, iconClass: 'text-warn', title: 'YOLO', kbd: '⌥3', desc: 'Act without asking. Caps and guardrails still hold.' },
]

/** The rail Autonomy button + its popover. Controlled so the hover-tray can stay open while it is. */
function AutonomyPopover({
  context,
  open,
  onOpenChange,
}: {
  context: TrayContext
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const navigate = useNavigate()
  const autonomy = useUIStore((s) => s.autonomy)
  const setAutonomy = useUIStore((s) => s.setAutonomy)
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const active = AUTONOMY_OPTIONS.find((o) => o.level === autonomy) ?? AUTONOMY_OPTIONS[1]
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <TrayButton
          context={context}
          label="Autonomy"
          tooltip={`Autonomy · ${active.title}`}
          kbd="⌥ A"
          icon={active.icon}
          iconClassName={autonomy === 'ask' ? undefined : active.iconClass}
          current={open}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="end"
          sideOffset={10}
          alignOffset={4}
          aria-label="Autonomy"
          className="z-50 w-[320px] overflow-hidden rounded-[14px] bg-surface shadow-[0_12px_32px_#0C0A0926] outline-1 -outline-offset-1 outline-line-strong"
        >
          <div className="flex flex-col gap-[2px] border-b border-line px-[14px] pt-[12px] pb-[10px]">
            <span className="text-[13px] font-semibold text-ink">Autonomy</span>
            <span className="text-[12px] text-muted">For every helper in {companyName}</span>
          </div>
          <div className="flex flex-col gap-[2px] p-[6px]">
            {AUTONOMY_OPTIONS.map((o) => {
              const selected = o.level === autonomy
              return (
                <button
                  key={o.level}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setAutonomy(o.level)
                    onOpenChange(false)
                  }}
                  className={`flex w-full items-start gap-[10px] rounded-[9px] px-[10px] py-[9px] text-left transition-colors ${
                    selected ? 'bg-hover' : 'hover:bg-hover'
                  }`}
                >
                  <span className="flex size-[28px] shrink-0 items-center justify-center rounded-sm bg-soft outline-1 -outline-offset-1 outline-line">
                    <o.icon size={14} aria-hidden className={o.iconClass} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <span className="flex items-center gap-[6px]">
                      <span className="text-[13px] font-semibold text-ink">{o.title}</span>
                      {selected && <Check size={13} aria-hidden className="text-ink" />}
                      <span className="h-px flex-1" />
                      <span className="font-mono text-[10.5px] text-faint">{o.kbd}</span>
                    </span>
                    <span className="text-[12px] leading-[17px] text-muted">{o.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-[8px] border-t border-line bg-soft px-[14px] py-[9px]">
            <span className="flex-1 text-[12px] text-muted">Caps, guardrails and approvers</span>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false)
                void navigate({ to: '/control-panel/$section', params: { section: 'safety' } })
              }}
              className="inline-flex items-center gap-[4px] text-[12px] font-medium text-info"
            >
              Safety &amp; limits
              <ArrowUpRight size={12} aria-hidden />
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export type RailPage = 'team' | 'notifications' | 'settings' | 'autonomy'

interface BottomActionsProps {
  /** Unread notifications (bell shows while > 0). */
  unread?: number
  helpers?: number
  /** Page currently open, if it is one of the tray's pages. */
  currentPage?: RailPage
}

/**
 * Team, Notifications, Settings and Autonomy live in a tray behind ⋯.
 * Collapsed, only items with something to show stay out (unread bell,
 * current page, non-default autonomy). ⋯ opens the tray; ⌄ closes it.
 */
function BottomActions({ unread = 3, helpers = 6, currentPage }: BottomActionsProps) {
  const [open, setOpen] = useState(false)
  const [autonomyOpen, setAutonomyOpen] = useState(false)
  const groupRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const autonomy = useUIStore((s) => s.autonomy)

  // ⋯ opens the tray on click; it closes on an outside click (ignoring the
  // portaled autonomy popover) or Escape.
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (groupRef.current?.contains(t)) return
      if (t.closest('[data-radix-popper-content-wrapper]')) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleAutonomyOpen = (o: boolean) => setAutonomyOpen(o)
  const autonomyOut = autonomy !== 'ask'
  const go = (to: string) => () => {
    void navigate({ to })
    setOpen(false)
  }
  const items = {
    team: {
      label: 'Team',
      tooltip: `Team · ${helpers} helpers`,
      kbd: 'G T',
      glyph: <TeamGlyph />,
      current: currentPage === 'team',
      onClick: go('/team'),
    },
    notifications: {
      label: 'Notifications',
      tooltip: unread > 0 ? `Notifications · ${unread} new` : 'Notifications',
      kbd: 'G N',
      icon: Bell,
      dot: unread > 0,
      current: currentPage === 'notifications',
      onClick: go('/notifications'),
    },
    settings: {
      label: 'Settings',
      tooltip: 'Control panel',
      kbd: 'G ,',
      icon: Settings,
      current: currentPage === 'settings',
      onClick: go('/control-panel'),
    },
  }

  if (open) {
    return (
      <div
        ref={groupRef}
        role="group"
        aria-label="Rail actions"
        className="flex flex-col items-center gap-[2px] rounded-lg bg-[#E7E5E4] p-[3px]"
      >
        <TrayButton context="tray" {...items.team} />
        <TrayButton context="tray" {...items.notifications} />
        <TrayButton context="tray" {...items.settings} />
        <AutonomyPopover context="tray" open={autonomyOpen} onOpenChange={handleAutonomyOpen} />
        <button
          type="button"
          aria-label="Close tray"
          aria-expanded
          onClick={() => setOpen(false)}
          className="flex h-[18px] w-[30px] items-center justify-center rounded-sm text-muted outline-none transition hover:bg-[#FFFFFF99] focus-visible:ring-2 focus-visible:ring-ink active:scale-90"
        >
          <ChevronDown size={14} aria-hidden />
        </button>
      </div>
    )
  }

  const bellOut = unread > 0 || items.notifications.current
  return (
    <div ref={groupRef} role="group" aria-label="Rail actions" className="flex flex-col items-center gap-[10px] rounded-lg">
      {items.team.current && <TrayButton {...items.team} />}
      {bellOut && <TrayButton {...items.notifications} />}
      {items.settings.current && <TrayButton {...items.settings} />}
      {(autonomyOut || autonomyOpen) && (
        <AutonomyPopover context="rail" open={autonomyOpen} onOpenChange={handleAutonomyOpen} />
      )}
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
      className={`flex size-[28px] items-center justify-center rounded-btn outline-none transition focus-visible:ring-2 focus-visible:ring-ink active:scale-90 ${
        active ? 'bg-surface text-ink shadow-[0_1px_3px_#0C0A091F]' : 'text-muted hover:text-ink-2 hover:bg-[#FFFFFF80]'
      }`}
    >
      <Icon size={15} aria-hidden />
    </button>
  )
}

// ── Keyboard shortcuts dialog ─────────────────────────────────────────────────

const SHORTCUT_ROWS: { label: string; kbd: string }[] = [
  { label: 'Open Command Menu', kbd: '⌘ K' },
  { label: 'Talk to Chief', kbd: '⌘ J' },
  { label: 'New chat', kbd: 'C' },
  { label: 'Switch mode', kbd: '⌘ .' },
  { label: 'Go to Inbox', kbd: 'G  I' },
  { label: 'Go to Goals', kbd: 'G  G' },
  { label: 'Go to Flows', kbd: 'G  F' },
  { label: 'Go to Team', kbd: 'G  T' },
  { label: 'Go to Notifications', kbd: 'G  N' },
  { label: 'Go to Settings', kbd: 'G  ,' },
  { label: 'Ask Chief (command menu)', kbd: '⌘ ↵' },
]

function KeyboardShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Keyboard shortcuts"
      subtitle="Move around Omilo without the mouse."
      width={420}
    >
      <div className="flex flex-col divide-y divide-line">
        {SHORTCUT_ROWS.map((row) => (
          <div key={row.label} className="flex items-center justify-between py-[9px]">
            <span className="text-[13px] text-ink-2">{row.label}</span>
            <span className="font-mono text-[12px] text-muted">{row.kbd}</span>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

// ── Add company dialog ────────────────────────────────────────────────────────

const COMPANY_INDUSTRIES = ['Retail', 'Food & beverage', 'SaaS / Software', 'Services', 'Education', 'Nonprofit', 'Other'] as const
const COMPANY_ROLES = ['Founder / Owner', 'Operations', 'Marketing', 'Finance', 'Engineering', 'Support', 'Other'] as const
const COMPANY_SIZES = ['Just me', '2–10', '11–50', '51–200', '200+'] as const

const fieldInputClass =
  'h-[36px] w-full rounded-base bg-soft px-[10px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary placeholder:text-faint'

function DialogField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex w-full flex-col gap-[6px]">
      <span className="text-[12px] font-medium text-ink-2">{label}</span>
      {children}
    </label>
  )
}

function AddCompanyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState<string>(COMPANY_INDUSTRIES[0])
  const [role, setRole] = useState<string>(COMPANY_ROLES[0])
  const [size, setSize] = useState<string>(COMPANY_SIZES[1])
  const [region, setRegion] = useState('Asia/Jakarta (GMT+7)')
  const [code, setCode] = useState('')

  const [busy, setBusy] = useState(false)
  const { adapter } = useAuth()
  const applySignIn = useSession((s) => s.applySignIn)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const uiMode = useUIStore((s) => s.mode)

  async function submit() {
    if (busy) return
    if (mode === 'create') {
      const trimmed = name.trim()
      if (!trimmed) { notify('Enter a company name'); return }
      if (!adapter.createCompany) { notify('Creating companies needs the Omilo backend'); return }
      setBusy(true)
      try {
        const result = await adapter.createCompany({
          name: trimmed,
          industry,
          teamSize: size,
          picRole: role,
          timezone: region.split(' ')[0],
        })
        applySignIn(result)
        await qc.invalidateQueries()
        notify(`Company “${trimmed}” created`)
        onClose()
        void navigate({ to: MODE_HOME[uiMode] })
      } catch (e) {
        notify(e instanceof Error ? `Couldn't create the company — ${e.message}` : "Couldn't create the company")
      } finally {
        setBusy(false)
      }
    } else {
      const raw = code.trim()
      if (!raw) { notify('Paste an invite code'); return }
      // Accept a full invite link or the bare token.
      let token = raw
      try { token = new URL(raw).searchParams.get('token') ?? raw } catch { /* bare token */ }
      onClose()
      void navigate({ to: '/auth/invite', search: { token } } as never)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Add company"
      subtitle="Spin up a new workspace, or join one with an invite code."
      width={460}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="secondary" style={{ height: 32 }} onClick={onClose}>Cancel</Button>
          <Button variant="primary" style={{ height: 32 }} disabled={busy} onClick={() => void submit()}>
            {mode === 'create' ? (busy ? 'Creating…' : 'Create company') : 'Join'}
          </Button>
        </>
      }
    >
      {/* Create vs join */}
      <div className="flex gap-[4px] rounded-base bg-soft p-[3px] outline-1 -outline-offset-1 outline-line-strong">
        {([['create', 'Create new'], ['join', 'Join with code']] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-sm py-[6px] text-[12.5px] font-medium transition-colors ${
              mode === m ? 'bg-surface text-ink shadow-[0_1px_2px_#0000001a]' : 'text-muted hover:text-ink-2'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'create' ? (
        <>
          <DialogField label="Company name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Warung Bu Sri"
              aria-label="Company name"
              className={fieldInputClass}
            />
          </DialogField>
          <div className="grid grid-cols-2 gap-[10px]">
            <DialogField label="Industry">
              <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={fieldInputClass} aria-label="Industry">
                {COMPANY_INDUSTRIES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </DialogField>
            <DialogField label="Team size">
              <select value={size} onChange={(e) => setSize(e.target.value)} className={fieldInputClass} aria-label="Team size">
                {COMPANY_SIZES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </DialogField>
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <DialogField label="Your role">
              <select value={role} onChange={(e) => setRole(e.target.value)} className={fieldInputClass} aria-label="Your role">
                {COMPANY_ROLES.map((o) => <option key={o}>{o}</option>)}
              </select>
            </DialogField>
            <DialogField label="Region">
              <select value={region} onChange={(e) => setRegion(e.target.value)} className={fieldInputClass} aria-label="Region">
                <option>Asia/Jakarta (GMT+7)</option>
                <option>Asia/Singapore (GMT+8)</option>
                <option>Asia/Kuala_Lumpur (GMT+8)</option>
                <option>Australia/Sydney (GMT+11)</option>
                <option>Europe/London (GMT+0)</option>
                <option>America/New_York (GMT-5)</option>
              </select>
            </DialogField>
          </div>
        </>
      ) : (
        <DialogField label="Invite code">
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste the invite link or code"
            aria-label="Invite code"
            className={fieldInputClass}
          />
          <span className="text-[11.5px] text-faint">Ask a company owner for a code from Settings → Members &amp; roles.</span>
        </DialogField>
      )}
    </Dialog>
  )
}

// ── Profile menu (pen `Profile Menu` NqUoT) ──────────────────────────────────

function ProfileMenu() {
  const navigate = useNavigate()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const signOut = useSession((s) => s.signOut)
  const user = useSession((s) => s.user)
  const sub = useSubscription().data
  const storage = useStorage().data
  const initialsOf = (n: string) =>
    n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
  const userInitials = user ? initialsOf(user.name || user.email) : '?'
  const planLabel = sub ? `${sub.planName ?? sub.planId.replace(/^plan_/, '').replace(/^\w/, (c) => c.toUpperCase())} plan${sub.isTrial ? ' · trial' : ''}` : null
  // Cloud plans are sized by storage (docs, files, knowledge).
  const quota = storage?.quotaBytes ?? null
  const used = storage?.usedBytes ?? 0
  const pct = quota ? Math.min(100, Math.round((used / quota) * 100)) : 0
  const fmt = (n: number) =>
    n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1).replace(/\.0$/, '')} GB` : `${Math.max(0, Math.round(n / 1024 ** 2))} MB`

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label="User menu"
          className="flex size-[28px] shrink-0 items-center justify-center rounded-full bg-[#D6D3D1] text-[11px] font-semibold text-ink-2 outline-none transition hover:bg-[#C8C4C1] focus-visible:ring-2 focus-visible:ring-ink active:scale-90 data-[state=open]:ring-2 data-[state=open]:ring-ink"
        >
          {userInitials}
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
                {userInitials}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="truncate text-[14px] font-semibold text-ink">{user?.name || 'Signed in'}</span>
                <span className="truncate text-[12px] text-muted">{user?.email ?? ''}</span>
              </div>
            </div>
            {planLabel && (
            <div className="px-[6px] pb-[6px]">
              <div className="flex flex-col gap-[6px] rounded-base outline-1 -outline-offset-1 outline-line bg-soft px-[12px] py-[10px]">
                <div className="flex items-center gap-[6px]">
                  <span className="text-[12px] font-semibold text-ink">{planLabel}</span>
                  <span className="h-px flex-1" />
                  <span className="font-mono text-[11px] text-muted">
                    {storage ? (quota ? `${fmt(used)} / ${fmt(quota)}` : `${fmt(used)} · no limit`) : ''}
                  </span>
                </div>
                {!!quota && (
                <div className="h-[4px] overflow-hidden rounded-[2px] bg-line-strong">
                  <div className="h-full rounded-[2px] bg-ink" style={{ width: `${pct}%` }} />
                </div>
                )}
              </div>
            </div>
            )}
            <MenuSeparatorLine />
            {/* Group 1: account / billing / settings / notifications */}
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => void navigate({ to: '/control-panel/$section', params: { section: 'account' } })}
            >
              <MenuItemBody icon={UserRound} label="Account" />
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => void navigate({ to: '/control-panel/$section', params: { section: 'usage' } })}
            >
              <MenuItemBody icon={CreditCard} label="Subscription & billing" />
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => void navigate({ to: '/control-panel/$section', params: { section: 'general' } })}
            >
              <MenuItemBody icon={Settings} label="Settings" hint="⌘," />
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => void navigate({ to: '/control-panel/$section', params: { section: 'notifications' } })}
            >
              <MenuItemBody icon={Bell} label="Notification settings" />
            </DropdownMenu.Item>
            <MenuSeparatorLine />
            {/* Group 2: help / feedback / shortcuts */}
            <DropdownMenu.Item className={menuItemClass} onSelect={() => notify('Help & docs — coming soon')}>
              <MenuItemBody icon={CircleHelp} label="Help & docs" />
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItemClass} onSelect={() => setFeedbackOpen(true)}>
              <MenuItemBody icon={MessageSquareHeart} label="Send feedback" />
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => setShortcutsOpen(true)}
            >
              <MenuItemBody icon={Keyboard} label="Keyboard shortcuts" hint="?" />
            </DropdownMenu.Item>
            <MenuSeparatorLine />
            <DropdownMenu.Item
              className={menuItemClass}
              onSelect={() => setLogoutOpen(true)}
            >
              <MenuItemBody icon={LogOut} label="Log out" danger />
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <ConfirmDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title="Log out?"
        message="You'll need to sign in again to get back to your workspace. Chief will be here when you return."
        confirmLabel="Log out"
        onConfirm={() => {
          signOut()
          void navigate({ to: '/auth/sign-in' })
        }}
      />
    </>
  )
}

// ── Adapt live Company to CompanyDefaults ─────────────────────────────────────

/** Default color palette for company tiles when no live source provides one. */
const COMPANY_COLORS = [
  '#EB6834', '#6366F1', '#14B8A6', '#F97316', '#8B5CF6', '#EC4899', '#EAB308',
]

/**
 * Derive a stable CompanyDefaults from a live Company domain object.
 * - `initial`: first char of name, uppercased.
 * - `color`: deterministic color from COMPANY_COLORS palette (no live source).
 */
function toCompanyDefaults(c: Company, index: number): CompanyDefaults {
  return {
    id: c.id,
    name: c.name,
    initial: c.name[0]?.toUpperCase() ?? '?',
    color: COMPANY_COLORS[index % COMPANY_COLORS.length],
  }
}

// ── Rail ──────────────────────────────────────────────────────────────────────

/**
 * pen `Rail` (hyn98): 56 wide · fill app · padding 12/0 · gap 10 · centered.
 * Omilo mark → companies → spacer → tray (notifications, more) →
 * Chat/Office mode switch → you.
 */
export function Rail() {
  const navigate = useNavigate()
  const location = useLocation()
  const { mode, setMode } = useUIStore()
  const isChat = mode === 'chat'
  const [addCompanyOpen, setAddCompanyOpen] = useState(false)

  const { companies, company: activeCompany, applySignIn } = useSession()
  // Uploaded company logo (Control panel › General) for the active company.
  const activeLogo = useCompanyDetail().data?.logoUrl ?? null
  const { adapter } = useAuth()
  const qc = useQueryClient()

  const currentPage: RailPage | undefined = location.pathname.startsWith('/team')
    ? 'team'
    : location.pathname.startsWith('/notifications')
      ? 'notifications'
      : location.pathname.startsWith('/control-panel')
        ? 'settings'
        : undefined

  // Mode is persisted, route-free. Toggling flips the flag; we only navigate
  // when leaving a surface that belongs exclusively to the mode you're leaving
  // (chat sessions → office, or inbox → chat). Neutral platform pages stay put.
  function switchMode() {
    const next: Mode = isChat ? 'office' : 'chat'
    setMode(next)
    const p = location.pathname
    const leavingChat = next === 'office' && (p === '/chat' || p.startsWith('/chat/'))
    const leavingOffice = next === 'chat' && p.startsWith('/inbox')
    if (leavingChat || leavingOffice) void navigate({ to: MODE_HOME[next] })
  }

  // Clicking an inactive company tile: switch company, apply session, invalidate
  // all React Query caches so data reloads for the new company.
  async function selectCompany(id: string) {
    if (id === activeCompany?.id) return
    const result = await adapter.switchCompany(id)
    applySignIn(result)
    await qc.invalidateQueries()
    void navigate({ to: MODE_HOME[mode] })
  }

  return (
    <>
    <nav
      aria-label="main rail"
      className="flex h-full w-[56px] shrink-0 flex-col items-center gap-[10px] bg-app py-[12px]"
    >
      <Mascot size={30} radius={9} title="Omilo" />

      <div className="flex flex-col items-center gap-[8px] pt-[6px]">
        {companies.map((c, i) => (
          <CompanyTile
            key={c.id}
            company={{ ...toCompanyDefaults(c, i), image: c.id === activeCompany?.id ? activeLogo : null }}
            active={c.id === activeCompany?.id}
            onClick={() => void selectCompany(c.id)}
          />
        ))}
        <button
          type="button"
          aria-label="Add company"
          title="Add company"
          onClick={() => setAddCompanyOpen(true)}
          className="flex size-[30px] items-center justify-center rounded-[9px] text-muted outline-none transition hover:bg-hover hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-ink active:scale-90"
        >
          <Plus size={16} aria-hidden />
        </button>
      </div>

      <div className="w-px flex-1" />

      <BottomActions currentPage={currentPage} />

      <div role="group" aria-label="Mode" className="flex flex-col gap-[2px] rounded-md bg-[#E7E5E4] p-[3px]">
        <ModeSegment label="Chat" icon={MessageCircle} active={isChat} onClick={isChat ? undefined : switchMode} />
        <ModeSegment label="Office" icon={Building2} active={!isChat} onClick={isChat ? switchMode : undefined} />
      </div>

      <ProfileMenu />
    </nav>
    <AddCompanyDialog open={addCompanyOpen} onClose={() => setAddCompanyOpen(false)} />
    </>
  )
}
