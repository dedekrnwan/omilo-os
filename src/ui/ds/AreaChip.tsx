import type { ChannelAccent } from '../../core/domain/types'
import { accents } from './accents'

/** pen `Area Chip` (f54pfG): h-20 · pill · gap 5 · px 7 · dot 6 · label 11.5/500. */
export function AreaChip({ accent, label }: { accent: ChannelAccent; label: string }) {
  const a = accents[accent]
  return (
    <span
      className="inline-flex h-[20px] shrink-0 items-center gap-[5px] rounded-pill px-[7px]"
      style={{ background: a.chipBg }}
    >
      <span className="size-[6px] rounded-full" style={{ background: a.color }} />
      <span className="text-[11.5px] font-medium whitespace-nowrap" style={{ color: a.chipInk }}>
        {label}
      </span>
    </span>
  )
}
