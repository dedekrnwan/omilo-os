import type { Channel, ChannelAccent } from '../../core/domain/types'
import { accents } from './accents'
import { useAreaChipLook } from './looks'

/**
 * pen `Area Chip` (f54pfG): h-20 · pill · gap 5 · px 7 · dot 6 · label 11.5/500.
 * Pass `area` so a colour the person picked for the area shows here too.
 */
export function AreaChip({ accent, label, area }: { accent: ChannelAccent; label: string; area?: Channel }) {
  const custom = useAreaChipLook(area)
  const a = accents[accent]
  const look = area ? custom : { dot: a.color, bg: a.chipBg, ink: a.chipInk }
  return (
    <span
      className="inline-flex h-[20px] shrink-0 items-center gap-[5px] rounded-pill px-[7px]"
      style={{ background: look.bg }}
    >
      <span className="size-[6px] rounded-full" style={{ background: look.dot }} />
      <span className="text-[11.5px] font-medium whitespace-nowrap" style={{ color: look.ink }}>
        {label}
      </span>
    </span>
  )
}
