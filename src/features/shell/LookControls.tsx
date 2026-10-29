import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import type { Channel, Folder } from '../../core/domain/types'
import type { Look } from '../../app/appearance'
import { useUpdateArea, useUpdateFolder } from '../../app/queries'
import { LookPicker } from '../../ui/ds/LookPicker'
import { Folder as FolderIcon, FolderOpen } from 'lucide-react'
import type { CSSProperties } from 'react'
import { ICONS } from '../../ui/ds/iconCatalog'
import { useAreaLook, useFolderLook } from '../../ui/ds/looks'

/** Only the icon/colour keys a picker change touched (the API PATCHes just those). */
function lookPatch(patch: Look): { icon?: string; color?: string } {
  const out: { icon?: string; color?: string } = {}
  if (patch.icon !== undefined) out.icon = patch.icon
  if (patch.color !== undefined) out.color = patch.color
  return out
}

/** The folder's chosen icon, else the open/closed folder glyph. */
function FolderGlyph({ icon, open, size, className, style }: { icon?: string; open: boolean; size: number; className?: string; style?: CSSProperties }) {
  const props = { size, className, style, 'aria-hidden': true as const }
  const Chosen = icon ? ICONS[icon] : undefined
  if (Chosen) return <Chosen {...props} />
  return open ? <FolderOpen {...props} /> : <FolderIcon {...props} />
}

/** Coloured square with the area glyph (24px in the switcher, 26px in the popover, 48px on pages). */
export const AreaTile = forwardRef<HTMLSpanElement, { area: Channel; size: number } & ComponentPropsWithoutRef<'span'>>(
  function AreaTile({ area, size, className = '', ...rest }, ref) {
    const look = useAreaLook(area)
    const radius = size <= 24 ? 6 : size <= 26 ? 7 : Math.round(size * 0.25)
    return (
      <span
        ref={ref}
        data-testid="area-icon"
        className={`flex shrink-0 items-center justify-center text-white ${className}`}
        style={{ width: size, height: size, borderRadius: radius, background: look.color }}
        {...rest}
      >
        <look.Icon size={Math.round(size * 0.54)} aria-hidden />
      </span>
    )
  },
)

/**
 * The area icon badge, clickable: opens the icon + colour picker.
 * Use where the badge is not inside another button.
 */
export function AreaBadgeButton({
  area,
  size,
  open,
  onOpenChange,
}: {
  area: Channel
  size: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const look = useAreaLook(area)
  const updateArea = useUpdateArea()
  return (
    <LookPicker
      open={open}
      onOpenChange={onOpenChange}
      kind="area"
      title={`${area.name} icon`}
      value={{ icon: look.icon, color: look.color }}
      onChange={(patch) => updateArea.mutate({ id: area.id, input: lookPatch(patch) })}
      onReset={() => updateArea.mutate({ id: area.id, input: { icon: null, color: null } })}
    >
      <button
        type="button"
        aria-label={`Change ${area.name} icon`}
        title="Change icon"
        className="shrink-0 rounded-[7px] outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ink active:scale-95"
      >
        <AreaTile area={area} size={size} aria-hidden />
      </button>
    </LookPicker>
  )
}

/** Folder glyph in the sidebar row — click to pick an icon and colour for the folder. */
export function FolderIconButton({
  folder,
  open,
  active = false,
  pickerOpen,
  onPickerOpenChange,
}: {
  folder: Pick<Folder, 'id' | 'name' | 'icon' | 'color'>
  open: boolean
  active?: boolean
  /** Controlled picker (e.g. opened from the folder's menu) */
  pickerOpen?: boolean
  onPickerOpenChange?: (open: boolean) => void
}) {
  const look = useFolderLook(folder)
  const updateFolder = useUpdateFolder()
  return (
    <LookPicker
      open={pickerOpen}
      onOpenChange={onPickerOpenChange}
      kind="folder"
      title={`${folder.name} icon`}
      value={{ icon: look.icon ?? 'folder', color: look.color ?? '#78716C' }}
      onChange={(patch) => updateFolder.mutate({ id: folder.id, input: lookPatch(patch) })}
      onReset={() => updateFolder.mutate({ id: folder.id, input: { icon: null, color: null } })}
    >
      <button
        type="button"
        aria-label={`Change ${folder.name} icon`}
        title="Change icon"
        onClick={(e) => e.stopPropagation()}
        className="-m-[2px] flex rounded-xs p-[2px] outline-none hover:bg-[#FFFFFFB3] focus-visible:ring-2 focus-visible:ring-ink"
      >
        <FolderGlyph icon={look.icon} open={open} size={15} className={look.color ? '' : active ? 'text-ink' : 'text-muted'} style={look.color ? { color: look.color } : undefined} />
      </button>
    </LookPicker>
  )
}

/** Big folder tile on the folder page — clickable to change the icon. */
export function FolderTileButton({
  folder,
  defaultBg,
  defaultInk,
}: {
  folder: Pick<Folder, 'id' | 'name' | 'icon' | 'color'>
  defaultBg: string
  defaultInk: string
}) {
  const look = useFolderLook(folder)
  const updateFolder = useUpdateFolder()
  return (
    <LookPicker
      kind="folder"
      title={`${folder.name} icon`}
      side="bottom"
      value={{ icon: look.icon ?? 'folder', color: look.color ?? '#78716C' }}
      onChange={(patch) => updateFolder.mutate({ id: folder.id, input: lookPatch(patch) })}
      onReset={() => updateFolder.mutate({ id: folder.id, input: { icon: null, color: null } })}
    >
      <button
        type="button"
        aria-label={`Change ${folder.name} icon`}
        title="Change icon"
        className="flex size-[48px] shrink-0 items-center justify-center rounded-lg outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ink"
        style={{
          background: look.color ? `${look.color}1A` : defaultBg,
          color: look.color ?? defaultInk,
        }}
      >
        <FolderGlyph icon={look.icon} open size={22} />
      </button>
    </LookPicker>
  )
}
