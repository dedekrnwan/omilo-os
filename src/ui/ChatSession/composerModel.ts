import type { ComponentType } from 'react'
import {
  CalendarClock,
  FileText,
  GitPullRequest,
  MessageCircle,
  Repeat,
  Sheet,
  Target,
  UserPlus,
  Users,
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

// ── Picker sources (live data: helpers, members, skills, goals, docs, chats) ──

export type ContextKind = 'doc' | 'goal' | 'chat' | 'file' | 'job'

/** What the @ / / / # pickers list. Built from live queries by `usePickerSource`. */
export interface PickerSource {
  helpers: { name: string; mention: string; area: HelperArea; sub: string }[]
  people: { name: string; initials: string; role: string }[]
  skills: { cmd: string; desc: string }[]
  context: { label: string; sub: string; trail: string; kind: ContextKind; tone?: 'soft' | 'ok' }[]
}

export const EMPTY_PICKER_SOURCE: PickerSource = { helpers: [], people: [], skills: [], context: [] }

/** Built-in slash commands (product commands, not data). */
const COMMANDS: { cmd: string; desc: string; icon: IconType }[] = [
  { cmd: '/loop', desc: 'Start a recurring job', icon: Repeat },
  { cmd: '/summarize', desc: 'Summarise this chat into a doc', icon: FileText },
  { cmd: '/hire', desc: 'Add a helper to this channel', icon: UserPlus },
  { cmd: '/remind', desc: 'Remind me or a helper later', icon: CalendarClock },
]

const CONTEXT_ICON: Record<ContextKind, IconType> = {
  doc: FileText,
  goal: Target,
  chat: MessageCircle,
  file: Sheet,
  job: GitPullRequest,
}

/** Build the full (unfiltered) item list for a picker kind. */
export function buildItems(kind: TriggerKind, source: PickerSource = EMPTY_PICKER_SOURCE): PickerItem[] {
  if (kind === 'mention') {
    return [
      {
        id: 'mention-all',
        kind: 'mention',
        value: 'all',
        title: 'Everyone',
        sub: 'Notify everyone in this channel',
        group: 'HELPERS',
        chip: true,
        icon: Users,
      },
      ...source.helpers.map((h): PickerItem => ({
        id: `mention-${h.mention}`,
        kind: 'mention',
        value: h.mention,
        title: h.name,
        sub: h.sub,
        group: 'HELPERS',
        chip: true,
        area: h.area,
      })),
      ...source.people.map((p): PickerItem => ({
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
      ...source.skills.map((sk): PickerItem => ({
        id: `command-${sk.cmd}`,
        kind: 'command',
        value: sk.cmd,
        title: sk.cmd,
        sub: sk.desc,
        group: 'SKILLS',
        chip: false,
        icon: WandSparkles,
        tone: 'skill',
      })),
    ]
  }
  return source.context.map((c): PickerItem => ({
    id: `context-${c.kind}-${c.label}`,
    kind: 'context',
    value: c.label,
    title: c.label,
    sub: c.sub,
    group: 'RECENT',
    chip: true,
    icon: CONTEXT_ICON[c.kind],
    tone: c.tone,
    trail: c.trail,
  }))
}

/** Items for a kind, filtered by a case-insensitive substring of the title or value. */
export function filterItems(kind: TriggerKind, query: string, source: PickerSource = EMPTY_PICKER_SOURCE): PickerItem[] {
  const items = buildItems(kind, source)
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) => i.title.toLowerCase().includes(q) || i.value.toLowerCase().includes(q))
}
