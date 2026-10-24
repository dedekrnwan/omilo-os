import { Briefcase, CodeXml, Hash, Megaphone } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ChannelAccent, HelperArea } from '../../core/domain/types'

export interface AccentStyle {
  /** Solid colour: channel icon tile, area dot */
  color: string
  /** Area chip background (colour at 10%) */
  chipBg: string
  /** Area chip label colour */
  chipInk: string
  icon: LucideIcon
}

/** Channel / company-area accents, exactly as used across omilo-v2.pen. */
export const accents: Record<ChannelAccent, AccentStyle> = {
  general:   { color: '#78716C',                         chipBg: '#78716C1A', chipInk: 'var(--color-ink-2)', icon: Hash },
  dev:       { color: 'var(--color-helper-dev)',       chipBg: '#14B8A61A', chipInk: '#0F766E',            icon: CodeXml },
  marketing: { color: 'var(--color-helper-marketing)', chipBg: '#F973161A', chipInk: '#C2410C',            icon: Megaphone },
  sales:     { color: 'var(--color-helper-sales)',     chipBg: '#8B5CF61A', chipInk: '#6D28D9',            icon: Briefcase },
}

/** Area dot colour for the Office sidebar "Areas" list. */
export const areaDot: Record<ChannelAccent, string> = {
  general: '#A8A29E',
  dev: 'var(--color-helper-dev)',
  marketing: 'var(--color-helper-marketing)',
  sales: 'var(--color-helper-sales)',
}

export type { HelperArea }
