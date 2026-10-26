import {
  CircleCheck,
  Clock,
  CreditCard,
  GitBranch,
  Inbox,
  ListTree,
  Mail,
  MessageCircle,
  MessageSquare,
  ScanText,
  Sheet,
  Sparkles,
  Timer,
  Plug,
  UserCheck,
  Webhook,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GithubIcon, SlackIcon } from '../../../../ui/ds/brandIcons'
import type { FlowNode, PaletteTone } from './data'

export const PALETTE_ICON: Record<string, LucideIcon> = {
  clock: Clock,
  zap: Zap,
  webhook: Webhook,
  sparkles: Sparkles,
  'list-tree': ListTree,
  'scan-text': ScanText,
  'git-fork': GitBranch,
  timer: Timer,
  'user-check': UserCheck,
  github: GithubIcon,
  slack: SlackIcon,
  mail: Mail,
  'credit-card': CreditCard,
  sheet: Sheet,
  'message-circle': MessageCircle,
}

export const TONE: Record<PaletteTone, { bg: string; ink: string; ring?: boolean }> = {
  amber: { bg: '#FEF3C7', ink: '#C2410C' },
  indigo: { bg: '#E0E7FF', ink: '#4F46E5' },
  neutral: { bg: '#F5F5F4', ink: '#44403C' },
}

/** 22–24px tinted square with the step glyph. */
export function StepTile({ icon: Icon, tone, size = 22 }: { icon: LucideIcon; tone: PaletteTone; size?: number }) {
  const t = TONE[tone]
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-sm"
      style={{ width: size, height: size, background: t.bg, color: t.ink }}
    >
      <Icon size={Math.round(size * 0.58)} aria-hidden strokeWidth={1.75} />
    </span>
  )
}

/** Icon + tone for a canvas node. */
export function nodeGlyph(n: FlowNode): { icon: LucideIcon; tone: PaletteTone } {
  switch (n.kind) {
    case 'trigger':
      return { icon: Zap, tone: 'amber' }
    case 'ai':
      return { icon: Sparkles, tone: 'indigo' }
    case 'approval':
      return { icon: UserCheck, tone: 'amber' }
    case 'if':
      return { icon: GitBranch, tone: 'neutral' }
    default:
      return { icon: Plug, tone: 'neutral' }
  }
}

export const APP_ICON: Record<NonNullable<FlowNode['app']>, LucideIcon> = {
  github: GithubIcon,
  slack: SlackIcon,
  chat: MessageSquare,
  inbox: Inbox,
}

export { CircleCheck }
