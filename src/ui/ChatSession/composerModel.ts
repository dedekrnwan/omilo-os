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
import type { HelperArea } from '../../core/domain/types'

export type IconType = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>

export type TriggerKind = 'mention' | 'command' | 'context'

export interface TriggerMatch {
  kind: TriggerKind
  /** Text typed after the trigger char, up to the caret. */
  query: string
  /** Index of the trigger char (@ / #) in the source string. */
  index: number
}

const TRIGGER_KIND: Record<string, TriggerKind> = { '@': 'mention', '/': 'command', '#': 'context' }

/**
 * Detect the active trigger token the caret sits in. A token is a trigger char
 * (@ / #) at the start of the text or after whitespace, followed by non-space,
 * non-trigger characters up to the caret. Returns null when the caret is not in
 * a token (e.g. a trailing space closed it, or it is glued to a word like a@b).
 */
export function parseTrigger(before: string): TriggerMatch | null {
  const m = /(^|\s)([@/#])([^\s@/#]*)$/.exec(before)
  if (!m) return null
  const query = m[3]
  return { kind: TRIGGER_KIND[m[2]], query, index: before.length - query.length - 1 }
}

/** Move an active index within a list, wrapping around; clamps to 0 for an empty list. */
export function moveIndex(cur: number, len: number, dir: 1 | -1): number {
  if (len <= 0) return 0
  return (cur + dir + len) % len
}

// ── Picker items ────────────────────────────────────────────────────────────

export interface PickerItem {
  id: string
  kind: TriggerKind
  /** Bare value inserted (e.g. 'Chief', '/loop', 'Passkey rollout plan'). */
  value: string
  title: string
  sub?: string
  group: string
  /** True when selecting inserts an atomic badge chip (@mention / #context). */
  chip: boolean
  // rendering hints
  area?: HelperArea
  initials?: string
  icon?: IconType
  tone?: 'soft' | 'ok' | 'skill'
  trail?: string
}

const MENTION_HELPERS: { name: string; mention: string; area: HelperArea; sub: string }[] = [
  { name: 'Chief of Staff', mention: 'Chief', area: 'brand', sub: 'In this chat' },
  { name: 'Builder', mention: 'Builder', area: 'dev', sub: 'Engineering · working now' },
  { name: 'Grower', mention: 'Grower', area: 'ops', sub: 'Growth' },
  { name: 'Support', mention: 'Support', area: 'support', sub: 'Customer support' },
]

const MENTION_PEOPLE = [
  { initials: 'RA', name: 'Rina Ayu', role: 'Engineering lead' },
  { initials: 'BS', name: 'Budi Santoso', role: 'Product' },
]

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

interface RawContext {
  label: string
  sub: string
  trail: string
  icon: IconType
  tone?: 'soft' | 'ok'
}

const CONTEXT_RECENT: RawContext[] = [
  { label: 'Passkey rollout plan', sub: 'Doc · Engineering', trail: 'Doc', icon: FileText },
  { label: 'Passwordless login by Q4', sub: 'Goal · 64%', trail: 'Goal', icon: Target, tone: 'ok' },
  { label: 'login-funnel-audit.csv', sub: 'File · in this chat', trail: 'File', icon: Sheet },
  { label: 'fix/otp-retry', sub: 'Job · Builder · in progress', trail: 'Job', icon: GitPullRequest },
]

const CONTEXT_APPS: RawContext[] = [
  { label: 'Q4 launch plan', sub: 'Notion', trail: 'Notion', icon: BookOpen },
  { label: 'PR #214 · Retry limit for OTP', sub: 'GitHub', trail: 'GitHub', icon: FileText },
]

/** Build the full (unfiltered) item list for a picker kind. */
export function buildItems(kind: TriggerKind): PickerItem[] {
  if (kind === 'mention') {
    return [
      ...MENTION_HELPERS.map((h): PickerItem => ({
        id: `mention-${h.mention}`,
        kind: 'mention',
        value: h.mention,
        title: h.name,
        sub: h.sub,
        group: 'HELPERS',
        chip: true,
        area: h.area,
      })),
      ...MENTION_PEOPLE.map((p): PickerItem => ({
        id: `mention-${p.name}`,
        kind: 'mention',
        value: p.name,
        title: p.name,
        sub: p.role,
        group: 'PEOPLE',
        chip: true,
        initials: p.initials,
      })),
    ]
  }
  if (kind === 'command') {
    return [
      ...COMMANDS.map((c): PickerItem => ({
        id: `command-${c.cmd}`,
        kind: 'command',
        value: c.cmd,
        title: c.cmd,
        sub: c.desc,
        group: 'COMMANDS',
        chip: false,
        icon: c.icon,
      })),
      ...SKILLS.map((s): PickerItem => ({
        id: `command-${s.cmd}`,
        kind: 'command',
        value: s.cmd,
        title: s.cmd,
        sub: s.desc,
        group: 'SKILLS',
        chip: false,
        icon: WandSparkles,
        tone: 'skill',
      })),
    ]
  }
  return [
    ...CONTEXT_RECENT.map((c): PickerItem => ({
      id: `context-${c.label}`,
      kind: 'context',
      value: c.label,
      title: c.label,
      sub: c.sub,
      group: 'RECENT',
      chip: true,
      icon: c.icon,
      tone: c.tone,
      trail: c.trail,
    })),
    ...CONTEXT_APPS.map((c): PickerItem => ({
      id: `context-${c.label}`,
      kind: 'context',
      value: c.label,
      title: c.label,
      sub: c.sub,
      group: 'FROM YOUR APPS',
      chip: true,
      icon: c.icon,
      tone: c.tone,
      trail: c.trail,
    })),
  ]
}

/** Items for a kind, filtered by a case-insensitive substring of the title or value. */
export function filterItems(kind: TriggerKind, query: string): PickerItem[] {
  const items = buildItems(kind)
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) => i.title.toLowerCase().includes(q) || i.value.toLowerCase().includes(q))
}
