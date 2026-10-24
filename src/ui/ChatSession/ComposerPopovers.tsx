import * as Popover from '@radix-ui/react-popover'
import { menuSurface } from '../ds/Menu'
import { Mascot } from '../ds/Mascot'
import type { HelperArea } from '../../core/domain/types'

// ── Composer popover types ─────────────────────────────────────────────────

export type ComposerPopoverKind = 'none' | 'mention' | 'command' | 'context'

// ── @mention popover (pen ref qx8jA) ─────────────────────────────────────────

interface MentionItem {
  name: string
  area: HelperArea
  sub: string
  isActive?: boolean
}

const HELPERS: MentionItem[] = [
  { name: 'Chief',   area: 'brand',   sub: 'In this chat',     isActive: false },
  { name: 'Builder', area: 'dev',     sub: 'Engineering · working now', isActive: true },
  { name: 'Grower',  area: 'marketing', sub: 'Growth' },
  { name: 'Support', area: 'support', sub: 'Customer support' },
]

interface PersonItem {
  initials: string
  color: string
  name: string
  role: string
}

const PEOPLE: PersonItem[] = [
  { initials: 'RA', color: '#F97316', name: 'Rina Ayu',    role: 'Engineering lead' },
  { initials: 'BS', color: '#6366F1', name: 'Budi Santoso', role: 'Product' },
]

function MentionRow({ item, onSelect }: { item: MentionItem; onSelect: (name: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.name)}
      className={`flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[7px] text-left transition-colors hover:bg-hover ${item.isActive ? 'bg-hover' : ''}`}
    >
      <Mascot size={24} radius={7} area={item.area} />
      <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
        <span className="text-[13px] font-medium text-ink">{item.name}</span>
        <span className="text-[11.5px] text-muted">{item.sub}</span>
      </span>
    </button>
  )
}

function PersonRow({ item, onSelect }: { item: PersonItem; onSelect: (name: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.name)}
      className="flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[7px] text-left transition-colors hover:bg-hover"
    >
      <span
        className="inline-flex size-[24px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: item.color }}
      >
        {item.initials}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
        <span className="text-[13px] font-medium text-ink">{item.name}</span>
        <span className="text-[11.5px] text-muted">{item.role}</span>
      </span>
    </button>
  )
}

interface MentionPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (name: string) => void
  children: React.ReactNode
}

export function MentionPopover({ open, onOpenChange, onSelect, children }: MentionPopoverProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>{children}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className={`z-50 w-[320px] ${menuSurface}`}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="px-[10px] pt-[6px] pb-[2px]">
            <span className="text-[11px] font-medium uppercase tracking-[0.55px] text-muted">Helpers</span>
          </div>
          {HELPERS.map((h) => (
            <MentionRow key={h.name} item={h} onSelect={onSelect} />
          ))}
          <div className="px-[10px] pt-[8px] pb-[2px]">
            <span className="text-[11px] font-medium uppercase tracking-[0.55px] text-muted">People</span>
          </div>
          {PEOPLE.map((p) => (
            <PersonRow key={p.name} item={p} onSelect={onSelect} />
          ))}
          {/* Keyboard hint footer */}
          <div className="flex items-center gap-[8px] px-[10px] py-[6px] text-[11px] text-faint">
            <span className="rounded-xs bg-app px-[4px] py-[2px] font-mono text-[10px]">↕</span>
            <span>navigate</span>
            <span className="rounded-xs bg-app px-[4px] py-[2px] font-mono text-[10px]">↵</span>
            <span>mention</span>
            <span className="rounded-xs bg-app px-[4px] py-[2px] font-mono text-[10px]">esc</span>
            <span>close</span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ── /command popover (pen ref DKIFQ) ─────────────────────────────────────────

interface CommandItem {
  cmd: string
  desc: string
  skill?: string
  skillDesc?: string
}

const COMMANDS: CommandItem[] = [
  { cmd: '/loop',    desc: 'Start a recurring job' },
  { cmd: '/summarise', desc: 'Summarise this chat into a doc' },
  { cmd: '/hire',   desc: 'Add a helper to this channel' },
  { cmd: '/remind', desc: 'Remind me or a helper later' },
]

const SKILLS: CommandItem[] = [
  { cmd: '/skill: weekly-report',   desc: 'Builder · writes the Friday report' },
  { cmd: '/skill: release-notes',   desc: 'Builder · from merged PRs' },
]

interface CommandPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (cmd: string) => void
  children: React.ReactNode
}

export function CommandPopover({ open, onOpenChange, onSelect, children }: CommandPopoverProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>{children}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className={`z-50 w-[340px] ${menuSurface}`}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="px-[10px] pt-[6px] pb-[2px]">
            <span className="text-[11px] font-medium uppercase tracking-[0.55px] text-muted">Commands</span>
          </div>
          {COMMANDS.map((c) => (
            <button
              key={c.cmd}
              type="button"
              onClick={() => onSelect(c.cmd)}
              className="flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[7px] text-left transition-colors hover:bg-hover"
            >
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-xs bg-app text-[13px] text-muted">/</span>
              <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="text-[13px] font-medium text-ink">{c.cmd}</span>
                <span className="text-[11.5px] text-muted">{c.desc}</span>
              </span>
            </button>
          ))}

          <div className="px-[10px] pt-[8px] pb-[2px]">
            <span className="text-[11px] font-medium uppercase tracking-[0.55px] text-muted">Skills</span>
          </div>
          {SKILLS.map((s) => (
            <button
              key={s.cmd}
              type="button"
              onClick={() => onSelect(s.cmd)}
              className="flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[7px] text-left transition-colors hover:bg-hover"
            >
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-xs bg-app text-[13px] text-muted">⚡</span>
              <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="text-[13px] font-medium text-ink">{s.cmd}</span>
                <span className="text-[11.5px] text-muted">{s.desc}</span>
              </span>
            </button>
          ))}

          <div className="flex items-center gap-[8px] px-[10px] py-[6px] text-[11px] text-faint">
            <span className="rounded-xs bg-app px-[4px] py-[2px] font-mono text-[10px]">run</span>
            <span className="rounded-xs bg-app px-[4px] py-[2px] font-mono text-[10px]">tab</span>
            <span>fill</span>
            <span className="rounded-xs bg-app px-[4px] py-[2px] font-mono text-[10px]">esc</span>
            <span>close</span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ── #context popover (pen ref ON7HK) ─────────────────────────────────────────

interface ContextItem {
  icon: string
  label: string
  sub: string
  badge?: string
}

const CONTEXT_TABS = ['All', 'Docs', 'Files', 'Goals', 'Jobs', 'Apps'] as const
type ContextTab = (typeof CONTEXT_TABS)[number]

const RECENT_CONTEXT: ContextItem[] = [
  { icon: '📄', label: 'Passkey rollout plan',          sub: 'Doc · Engineering',  badge: 'Doc' },
  { icon: '📄', label: 'Passwordless login by Q4',      sub: 'Goal · Engineering', badge: 'Goal' },
  { icon: '📄', label: 'login-funnel-audit.csv',        sub: 'File · in this chat', badge: 'File' },
  { icon: '📄', label: 'fix/otp-retry',                 sub: 'Job · in progress',   badge: 'Job' },
]

const FROM_APPS: ContextItem[] = [
  { icon: '📋', label: 'Q4 launch plan', sub: 'Notion' },
  { icon: '🔗', label: 'PR #214 · Retry limit for OTP', sub: 'GitHub' },
]

interface ContextPickerPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (label: string) => void
  children: React.ReactNode
}

export function ContextPickerPopover({ open, onOpenChange, onSelect, children }: ContextPickerPopoverProps) {
  const [activeTab, setActiveTab] = [CONTEXT_TABS[0], (_: ContextTab) => {}] as [ContextTab, (t: ContextTab) => void]

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>{children}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className={`z-50 w-[340px] ${menuSurface} overflow-hidden`}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Tabs */}
          <div className="flex items-center gap-[4px] px-[8px] pt-[8px] pb-[4px]">
            {CONTEXT_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-sm px-[8px] py-[3px] text-[12px] font-medium transition-colors ${
                  tab === activeTab
                    ? 'bg-hover text-ink'
                    : 'text-muted hover:bg-hover'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Recent */}
          <div className="px-[10px] pt-[4px] pb-[2px]">
            <span className="text-[11px] font-medium uppercase tracking-[0.55px] text-muted">Recent</span>
          </div>
          {RECENT_CONTEXT.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => onSelect(item.label)}
              className="flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[6px] text-left transition-colors hover:bg-hover"
            >
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-xs bg-app text-[13px]">
                {item.icon}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="truncate text-[13px] font-medium text-ink">{item.label}</span>
                <span className="text-[11.5px] text-muted">{item.sub}</span>
              </span>
              {item.badge && (
                <span className="shrink-0 rounded-xs bg-soft px-[5px] py-[2px] text-[10.5px] text-faint">
                  {item.badge}
                </span>
              )}
            </button>
          ))}

          {/* From apps */}
          <div className="px-[10px] pt-[8px] pb-[2px]">
            <span className="text-[11px] font-medium uppercase tracking-[0.55px] text-muted">From apps</span>
          </div>
          {FROM_APPS.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => onSelect(item.label)}
              className="flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[6px] text-left transition-colors hover:bg-hover"
            >
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-xs bg-app text-[13px]">
                {item.icon}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="truncate text-[13px] font-medium text-ink">{item.label}</span>
                <span className="text-[11.5px] text-muted">{item.sub}</span>
              </span>
            </button>
          ))}

          <div className="flex items-center gap-[8px] px-[10px] py-[6px] text-[11px] text-faint">
            <span className="rounded-xs bg-app px-[4px] py-[2px] font-mono text-[10px]">↕</span>
            <span>navigate</span>
            <span className="rounded-xs bg-app px-[4px] py-[2px] font-mono text-[10px]">next type</span>
            <span className="rounded-xs bg-app px-[4px] py-[2px] font-mono text-[10px]">esc</span>
            <span>close</span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
