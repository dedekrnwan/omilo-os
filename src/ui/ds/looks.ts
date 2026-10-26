import { Folder, FolderOpen } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Channel, Folder as FolderT } from '../../core/domain/types'
import { useAppearance } from '../../app/appearance'
import type { Look } from '../../app/appearance'
import { accents } from './accents'
import { ICONS } from './iconCatalog'

/** Default area colours as hex (accents use CSS vars, which can't take an alpha suffix). */
const ACCENT_HEX: Record<Channel['accent'], string> = {
  general: '#78716C',
  dev: '#14B8A6',
  marketing: '#F97316',
  sales: '#8B5CF6',
}

const ACCENT_ICON_KEY: Record<Channel['accent'], string> = {
  general: 'hash',
  dev: 'code-xml',
  marketing: 'megaphone',
  sales: 'briefcase',
}

export interface ResolvedLook {
  icon: string
  Icon: LucideIcon
  color: string
  /** 10% tint for chips and soft tiles */
  tint: string
  /** Whether anything was customised */
  custom: boolean
}

function resolve(defaultIcon: string, defaultColor: string, look: Look | undefined, fallbackIcon: LucideIcon): ResolvedLook {
  const icon = look?.icon && ICONS[look.icon] ? look.icon : defaultIcon
  const color = look?.color ?? defaultColor
  return {
    icon,
    Icon: ICONS[icon] ?? fallbackIcon,
    color,
    tint: `${color}1A`,
    custom: Boolean(look && (look.icon || look.color)),
  }
}

/** An area's icon + colour: the person's choice, else the area's accent. */
export function useAreaLook(area: Channel | undefined): ResolvedLook {
  const look = useAppearance((s) => (area ? s.areas[area.id] : undefined))
  const accent = area?.accent ?? 'general'
  return resolve(ACCENT_ICON_KEY[accent], ACCENT_HEX[accent], look, accents[accent].icon)
}

/** Look used by area chips: customised areas use their own colour, others keep the design's chip colours. */
export function useAreaChipLook(area: Channel | undefined) {
  const look = useAreaLook(area)
  const a = accents[area?.accent ?? 'general']
  return look.custom
    ? { dot: look.color, bg: look.tint, ink: look.color }
    : { dot: a.color, bg: a.chipBg, ink: a.chipInk }
}

/**
 * A folder's look. Undefined icon = the classic open/closed folder glyph in the
 * sidebar's muted colour; a chosen icon/colour replaces it.
 */
export function useFolderLook(folder: Pick<FolderT, 'id'> | undefined) {
  const look = useAppearance((s) => (folder ? s.folders[folder.id] : undefined))
  return {
    Icon: look?.icon && ICONS[look.icon] ? ICONS[look.icon] : undefined,
    icon: look?.icon,
    color: look?.color,
    custom: Boolean(look && (look.icon || look.color)),
    /** Glyph to draw for an open/closed folder when no icon is chosen */
    glyph: (open: boolean): LucideIcon => (look?.icon && ICONS[look.icon]) || (open ? FolderOpen : Folder),
  }
}

export interface CompanyDefaults {
  id: string
  name: string
  initial: string
  color: string
}

/** A company's logo: uploaded image, or initials on a colour tile. */
export function useCompanyLook(c: CompanyDefaults) {
  const look = useAppearance((s) => s.companies[c.id])
  return {
    color: look?.color ?? c.color,
    initial: look?.initial || c.initial,
    image: look?.image,
  }
}
