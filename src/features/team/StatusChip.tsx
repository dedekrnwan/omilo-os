import { CircleDot, Users } from 'lucide-react'
import type { HelperStatus } from './teamData'
import { Chip } from './ui'
import type { ChipTone } from './ui'

const TONE: Record<HelperStatus, ChipTone> = {
  Working: 'info',
  'Needs you': 'warn',
  'Caught up': 'ok',
  Idle: 'idle',
  'Always on': 'ok',
  'Planning next week': 'info',
}

/** Helper status as the pen draws it: Chip/Run · Chip/Warn · Chip/Up · Chip/Idle. */
export function StatusChip({ status, className, label }: { status: HelperStatus; className?: string; label?: string }) {
  return (
    <Chip tone={TONE[status]} icon={status === 'Always on' ? CircleDot : undefined} className={className}>
      {label ?? status}
    </Chip>
  )
}

/**
 * pen `Topbar` as used on Team screens: users icon · "Team" · "/  <meta>".
 * Local copy of ds/Topbar because the meta keeps its double space.
 */
export function TeamTopbar({ meta }: { meta: string }) {
  return (
    <header className="flex h-[44px] w-full shrink-0 items-center gap-[8px] shadow-[inset_0_-1px_0_var(--color-line)] px-[16px]">
      <Users size={15} aria-hidden className="shrink-0 text-muted" />
      <h1 className="m-0 text-[13px] font-medium text-ink">Team</h1>
      <span className="text-[12.5px] whitespace-pre text-muted">{`/  ${meta}`}</span>
    </header>
  )
}
