import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import type { ComponentType } from 'react'
import {
  BookOpen,
  CalendarClock,
  FileText,
  GitPullRequest,
  Repeat,
  Sheet,
  Target,
  UserPlus,
  WandSparkles,
} from 'lucide-react'
import { Mascot } from '../ds/Mascot'
import type { HelperArea } from '../../core/domain/types'

type IconType = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>

/** lucide `github` (brand icons were dropped from lucide-react; same 24-grid stroke drawing). */
function Github({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  )
}

// ── Shared pieces of the composer popovers (pen rbE8i / X2OL01 / IaT5m) ──────

export type ComposerPopoverKind = 'none' | 'mention' | 'command' | 'context'

/** Popover surface: radius 10 · 1px line-strong · shadow 0 10 24 #0C0A0929 · padding 4. */
const surface =
  'z-50 flex flex-col rounded-md bg-surface p-[4px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_10px_24px_#0C0A0929]'

/** Row: radius 6 · gap 10 · padding 7 10; the first row is highlighted (hover fill). */
const rowClass =
  'flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[7px] text-left transition-colors hover:bg-hover'

/** pen `Kbd` (sDbNQ): surface · radius 4 · line-strong stroke 1/1/2/1 · padding 1 5 · mono 10.5 ink-2. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-xs bg-surface px-[5px] pt-[1px] pb-[2px] font-mono text-[10.5px] leading-[normal] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong),inset_0_-2px_0_var(--color-line-strong)]">
      {children}
    </span>
  )
}

function Heading({ label }: { label: string }) {
  return (
    <div className="flex w-full px-[10px] pt-[8px] pb-[4px]">
      <span className="text-[11px] font-semibold tracking-[0.6px] text-faint">{label}</span>
    </div>
  )
}

function RowText({ title, sub }: { title: string; sub: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
      <span className="truncate text-[13px] leading-[16px] font-medium text-ink">{title}</span>
      <span className="truncate text-[11px] leading-[13px] text-muted">{sub}</span>
    </span>
  )
}

/** Footer: top hairline · gap 12 · padding 8 10 6 10 · key hint + muted 11 label. */
function Footer({ hints }: { hints: [string, string][] }) {
  return (
    <div className="flex w-full items-center gap-[12px] px-[10px] pt-[8px] pb-[6px] shadow-[inset_0_1px_0_var(--color-line)]">
      {hints.map(([key, label]) => (
        <span key={label} className="flex items-center gap-[4px]">
          <Kbd>{key}</Kbd>
          <span className="text-[11px] text-muted">{label}</span>
        </span>
      ))}
    </div>
  )
}

/** pen `Icon Box`: 28×28 · radius 6 · soft (+ optional line stroke) · 14px icon. */
function IconBox({
  icon: Icon,
  tone = 'soft',
  stroked = false,
}: {
  icon: IconType
  tone?: 'soft' | 'ok' | 'skill'
  stroked?: boolean
}) {
  const look =
    tone === 'ok'
      ? 'bg-ok-tint text-ok'
      : tone === 'skill'
        ? 'bg-[#EEF2FF] text-helper-brand'
        : `bg-soft text-ink-2 ${stroked ? 'outline-1 -outline-offset-1 outline-line' : ''}`
  return (
    <span className={`flex size-[28px] shrink-0 items-center justify-center rounded-sm ${look}`}>
      <Icon size={14} aria-hidden />
    </span>
  )
}

const PICKERS = {
  mention: { width: 320, label: 'Mention someone', List: MentionList },
  command: { width: 380, label: 'Commands', List: CommandList },
  context: { width: 400, label: 'Add context', List: ContextList },
} as const

interface ComposerPickerProps {
  kind: ComposerPopoverKind
  onClose: () => void
  /** Called with the picker kind and the chosen value. */
  onSelect: (kind: Exclude<ComposerPopoverKind, 'none'>, value: string) => void
  /** The composer card the popover sits above. */
  children: ReactNode
}

/**
 * Popover above the composer: left edge 11px in from the card (in line with the
 * typed text), 38px of air between the popover and the card.
 */
export function ComposerPicker({ kind, onClose, onSelect, children }: ComposerPickerProps) {
  const picker = kind === 'none' ? null : PICKERS[kind]
  return (
    <Popover.Root open={!!picker} onOpenChange={(o) => !o && onClose()}>
      <Popover.Anchor asChild>{children}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          alignOffset={11}
          sideOffset={38}
          avoidCollisions={false}
          aria-label={picker?.label}
          className={surface}
          style={{ width: picker?.width }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {picker && kind !== 'none' && <picker.List onSelect={(v) => onSelect(kind, v)} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

interface ListProps {
  onSelect: (value: string) => void
}

// ── @ mention (pen `Composer/Mention Popover` rbE8i) ──────────────────────────

const HELPERS: { name: string; mention: string; area: HelperArea; sub: string }[] = [
  { name: 'Chief of Staff', mention: 'Chief', area: 'brand', sub: 'In this chat' },
  { name: 'Builder', mention: 'Builder', area: 'dev', sub: 'Engineering · working now' },
  { name: 'Grower', mention: 'Grower', area: 'ops', sub: 'Growth' },
  { name: 'Support', mention: 'Support', area: 'support', sub: 'Customer support' },
]

const PEOPLE = [
  { initials: 'RA', name: 'Rina Ayu', role: 'Engineering lead' },
  { initials: 'BS', name: 'Budi Santoso', role: 'Product' },
]

function MentionList({ onSelect }: ListProps) {
  return (
        <>
          <Heading label="HELPERS" />
          {HELPERS.map((h, i) => (
            <button
              key={h.name}
              type="button"
              onClick={() => onSelect(h.mention)}
              className={`${rowClass} ${i === 1 ? 'bg-hover' : ''}`}
            >
              <Mascot helper size={24} radius={7} area={h.area} />
              <RowText title={h.name} sub={h.sub} />
            </button>
          ))}
          <Heading label="PEOPLE" />
          {PEOPLE.map((p) => (
            <button key={p.name} type="button" onClick={() => onSelect(p.name)} className={rowClass}>
              {/* pen `Avatar` (g7G2ne) at 24px: peach tile, rust initials 11/600 */}
              <span className="inline-flex size-[24px] shrink-0 items-center justify-center rounded-full bg-[#FED7AA] text-[11px] font-semibold text-[#9A3412]">
                {p.initials}
              </span>
              <RowText title={p.name} sub={p.role} />
            </button>
          ))}
          <Footer hints={[['↑↓', 'navigate'], ['↵', 'mention'], ['esc', 'close']]} />
        </>
  )
}

// ── / command (pen `Composer/Slash Popover` X2OL01) ───────────────────────────

const COMMANDS: { cmd: string; desc: string; icon: IconType }[] = [
  { cmd: '/loop', desc: 'Start a recurring job', icon: Repeat },
  { cmd: '/summarize', desc: 'Summarise this chat into a doc', icon: FileText },
  { cmd: '/hire', desc: 'Add a helper to this channel', icon: UserPlus },
  { cmd: '/remind', desc: 'Remind me or a helper later', icon: CalendarClock },
]

const SKILLS = [
  { cmd: '/skill: weekly-report', desc: 'Builder · writes the Friday report' },
  { cmd: '/skill: release-notes', desc: 'Builder · from merged PRs' },
]

function CommandList({ onSelect }: ListProps) {
  return (
        <>
          <Heading label="COMMANDS" />
          {COMMANDS.map((c, i) => (
            <button
              key={c.cmd}
              type="button"
              onClick={() => onSelect(c.cmd)}
              className={`${rowClass} ${i === 0 ? 'bg-hover' : ''}`}
            >
              <IconBox icon={c.icon} stroked />
              <RowText title={c.cmd} sub={c.desc} />
            </button>
          ))}
          <Heading label="SKILLS" />
          {SKILLS.map((s) => (
            <button key={s.cmd} type="button" onClick={() => onSelect(s.cmd)} className={rowClass}>
              <IconBox icon={WandSparkles} tone="skill" />
              <RowText title={s.cmd} sub={s.desc} />
            </button>
          ))}
          <Footer hints={[['↵', 'run'], ['tab', 'fill'], ['esc', 'close']]} />
        </>
  )
}

// ── # context (pen `Composer/Context Popover` IaT5m) ──────────────────────────

const CONTEXT_TABS = ['All', 'Docs', 'Files', 'Goals', 'Jobs', 'Apps'] as const

interface ContextItem {
  label: string
  sub: string
  trail: string
  icon: IconType
  tone?: 'soft' | 'ok'
}

const RECENT: ContextItem[] = [
  { label: 'Passkey rollout plan', sub: 'Doc · Engineering', trail: 'Doc', icon: FileText },
  { label: 'Passwordless login by Q4', sub: 'Goal · 64%', trail: 'Goal', icon: Target, tone: 'ok' },
  { label: 'login-funnel-audit.csv', sub: 'File · in this chat', trail: 'File', icon: Sheet },
  { label: 'fix/otp-retry', sub: 'Job · Builder · in progress', trail: 'Job', icon: GitPullRequest },
]

const FROM_APPS: ContextItem[] = [
  { label: 'Q4 launch plan', sub: 'Notion', trail: 'Notion', icon: BookOpen },
  { label: 'PR #214 · Retry limit for OTP', sub: 'GitHub', trail: 'GitHub', icon: Github },
]

function ContextRow({ item, active, onSelect }: { item: ContextItem; active?: boolean; onSelect: (v: string) => void }) {
  return (
    <button type="button" onClick={() => onSelect(item.label)} className={`${rowClass} ${active ? 'bg-hover' : ''}`}>
      <IconBox icon={item.icon} tone={item.tone} />
      <RowText title={item.label} sub={item.sub} />
      <span className="shrink-0 text-[11px] text-faint">{item.trail}</span>
    </button>
  )
}

const CONTEXT_ITEMS_BY_TAB: Record<string, ContextItem[]> = {
  All: [...RECENT, ...FROM_APPS],
  Docs: RECENT.filter(i => i.trail === 'Doc'),
  Files: RECENT.filter(i => i.trail === 'File'),
  Goals: RECENT.filter(i => i.trail === 'Goal'),
  Jobs: RECENT.filter(i => i.trail === 'Job'),
  Apps: FROM_APPS,
}

function ContextList({ onSelect }: ListProps) {
  const [activeTab, setActiveTab] = useState<typeof CONTEXT_TABS[number]>('All')
  const items = CONTEXT_ITEMS_BY_TAB[activeTab] ?? CONTEXT_ITEMS_BY_TAB['All']
  return (
        <>
          <div role="tablist" className="flex w-full gap-[4px] px-[6px] pt-[6px] pb-[8px] shadow-[inset_0_-1px_0_var(--color-line)]">
            {CONTEXT_TABS.map((tab) => {
              const active = tab === activeTab
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab)}
                  className={`flex h-[24px] items-center rounded-pill px-[9px] text-[12px] font-medium ${
                    active ? 'bg-ink text-primary-ink' : 'text-muted hover:bg-hover'
                  }`}
                >
                  {tab}
                </button>
              )
            })}
          </div>
          {items.length > 0 ? (
            <>
              <Heading label={activeTab === 'Apps' ? 'FROM YOUR APPS' : 'RECENT'} />
              {items.map((item, i) => (
                <ContextRow key={item.label} item={item} active={i === 0} onSelect={onSelect} />
              ))}
            </>
          ) : (
            <div className="px-[10px] py-[12px] text-[12px] text-muted">No items in this tab.</div>
          )}
          <Footer hints={[['↵', 'attach'], ['tab', 'next type'], ['esc', 'close']]} />
        </>
  )
}
