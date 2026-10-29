import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Hash } from 'lucide-react'
import { Field } from './ControlPanelShared'
import { menuItemClass, menuSurface } from '../../ui/ds/Menu'
import { useChannels } from '../../app/queries'

/**
 * Multi-select of channels rendered as a pen Select field. An empty selection
 * means "All channels".
 */
export function ChannelPicker({
  value,
  onChange,
  label = 'Channels',
  width = 'auto',
  className = 'min-w-0 flex-1',
}: {
  value: string[]
  onChange: (ids: string[]) => void
  label?: string
  width?: number | string
  className?: string
}) {
  const { data: channels = [] } = useChannels()
  const names = channels.filter((c) => value.includes(c.id)).map((c) => c.name)
  const display = value.length === 0 ? 'All channels' : names.join(', ') || `${value.length} channels`

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  }

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={`text-left ${className}`} aria-label={`${label}: ${display}`}>
          <Field width={width} label={label} icon={Hash} value={display} fs={13} select />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="start" sideOffset={4} className={`z-50 w-[220px] ${menuSurface}`}>
          <DropdownMenu.Item className={menuItemClass} onSelect={(e) => { e.preventDefault(); onChange([]) }}>
            <span className="flex w-full items-center gap-[8px] text-[13px] text-ink">
              <span className="w-[14px]">{value.length === 0 && <Check size={14} aria-hidden />}</span>
              All channels
            </span>
          </DropdownMenu.Item>
          {channels.map((c) => (
            <DropdownMenu.Item key={c.id} className={menuItemClass} onSelect={(e) => { e.preventDefault(); toggle(c.id) }}>
              <span className="flex w-full items-center gap-[8px] text-[13px] text-ink">
                <span className="w-[14px]">{value.includes(c.id) && <Check size={14} aria-hidden />}</span>
                {c.name}
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
