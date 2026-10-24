import type { LucideIcon } from 'lucide-react'
import { ChartLine, Clock, FileText, Hash, Mail, MessageCircle, Siren, Sparkles, UserCheck } from 'lucide-react'

// ── Flow chain (pen c1bDa) — source app → AI → destination app ────────────────

/** GitHub mark (lucide dropped brand glyphs; the pen uses the octocat). */
function GithubIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.31-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.86.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.21.7.82.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  )
}

export const FLOW_ICONS: Record<string, LucideIcon | typeof GithubIcon> = {
  github: GithubIcon,
  slack: Hash,
  mail: Mail,
  'user-check': UserCheck,
  'chart-line': ChartLine,
  siren: Siren,
  'message-circle': MessageCircle,
  'file-text': FileText,
  clock: Clock,
}

export type FlowIconId = keyof typeof FLOW_ICONS

/** Integration chain: source tile → sparkles + "+N" → destination tile (pen c1bDa). */
export function FlowChain({ from, to, count }: { from: FlowIconId; to: FlowIconId; count: number }) {
  const From = FLOW_ICONS[from]
  const To = FLOW_ICONS[to]
  return (
    <div className="flex items-center gap-[4px]" aria-hidden>
      <span className="flex size-[28px] items-center justify-center rounded-base bg-app">
        <From size={14} className="text-ink-2" />
      </span>
      <span className="h-[1.5px] w-[8px] rounded-pill bg-wire-strong" />
      <span className="flex h-[22px] items-center gap-[3px] rounded-pill bg-surface px-[7px] outline-1 -outline-offset-1 outline-line-strong">
        <Sparkles size={11} className="text-[#4338CA]" />
        <span className="text-[11.5px] font-medium text-ink-2">+{count}</span>
      </span>
      <span className="h-[1.5px] w-[8px] rounded-pill bg-wire-strong" />
      <span className="flex size-[28px] items-center justify-center rounded-base bg-app">
        <To size={14} className="text-ink-2" />
      </span>
    </div>
  )
}
