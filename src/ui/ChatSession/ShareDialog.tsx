import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Link, Lock, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Drawer } from '../ds/Drawer'
import { notify } from '../ds/Toaster'
import { copyText } from '../ds/ItemMenu'
import { menuSurface, menuItemClass } from '../ds/Menu'

// ── Share dialog (pen `Chat · Session · Share` P334a, dialog frhtA) ───────────

interface ShareDialogProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const PERMISSION_OPTIONS = ['Owner', 'Can talk', 'Can view', 'Restricted', 'No access']

/** pen `Select` (gVDns) field only: 130 × 36 · radius 8 · line-strong · value 13 ink · chevron 16 muted. */
function PermissionSelect({ value: initialValue, label }: { value: string; label: string }) {
  const [value, setValue] = useState(initialValue)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex h-[36px] w-[130px] shrink-0 items-center gap-[8px] rounded-base bg-surface px-[10px] text-left outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft data-[state=open]:outline-[1.5px] data-[state=open]:-outline-offset-[1.5px] data-[state=open]:outline-ink"
        >
          <span className="flex-1 text-[13px] text-ink">{value}</span>
          <ChevronDown size={16} aria-hidden className="text-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={`z-[60] w-[140px] ${menuSurface}`}>
          {PERMISSION_OPTIONS.filter((o) => o !== 'Owner').map((opt) => (
            <DropdownMenu.Item
              key={opt}
              onSelect={() => setValue(opt)}
              className={menuItemClass}
            >
              <span className="flex-1 text-[13px] text-ink">{opt}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function Person({ avatar, bg, name, sub, right }: { avatar: string; bg: string; name: string; sub: string; right: ReactNode }) {
  return (
    <div className="flex w-full items-center gap-[10px]">
      <span
        className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-ink-2"
        style={{ background: bg }}
      >
        {avatar}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
        <span className="text-[13px] font-medium text-ink">{name}</span>
        <span className="text-[12px] text-muted">{sub}</span>
      </div>
      {right}
    </div>
  )
}

export function ShareDialog({ title, open, onOpenChange }: ShareDialogProps) {
  if (!open) return null
  return (
    <Drawer
      title={`Share "${title}"`}
      subtitle="People you add see the whole chat and can talk to the helpers in it."
      onClose={() => onOpenChange(false)}
      width={500}
      bodyClass="gap-[16px] p-[20px]"
      footer={
        <>
          <button
            type="button"
            onClick={() => { copyText(window.location.href); notify('Link copied') }}
            className="inline-flex h-[32px] items-center gap-[6px] rounded-btn px-[14px] text-[13px] text-muted transition-colors hover:bg-hover"
          >
            <Link size={16} aria-hidden />
            Copy link
          </button>
          <span className="h-px flex-1" />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-[32px] items-center justify-center rounded-btn bg-primary px-[14px] text-[13px] font-medium text-primary-ink outline-1 -outline-offset-1 outline-primary transition-colors hover:bg-primary-hover"
          >
            Done
          </button>
        </>
      }
    >
      <label className="flex h-[36px] w-full items-center gap-[8px] rounded-base bg-surface px-[10px] outline-1 -outline-offset-1 outline-line-strong">
        <Search size={16} aria-hidden className="text-muted" />
        <input
          placeholder="Add people, emails or a channel…"
          aria-label="Add people, emails or a channel"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
        />
      </label>

      <span className="text-[10.5px] font-semibold tracking-[1px] text-faint">WHO HAS ACCESS</span>

      <div className="flex w-full flex-col gap-[10px]">
        <Person
          avatar="DK"
          bg="#D6D3D1"
          name="Dede Kurniawan (you)"
          sub="dede@sahabatwarga.id"
          right={<span className="text-[12.5px] text-muted">Owner</span>}
        />
        <Person
          avatar="RA"
          bg="#FDE68A"
          name="Rina Ayu"
          sub="rina@sahabatwarga.id"
          right={<PermissionSelect value="Can talk" label="Rina Ayu access" />}
        />
        <Person
          avatar="#"
          bg="var(--color-soft)"
          name="#engineering"
          sub="12 people in the channel"
          right={<PermissionSelect value="Can view" label="#engineering access" />}
        />
      </div>

      <div className="flex w-full items-center gap-[10px] rounded-md bg-soft px-[12px] py-[10px]">
        <Lock size={15} aria-hidden className="shrink-0 text-muted" />
        <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
          <span className="text-[13px] font-medium text-ink">Only people added</span>
          <span className="truncate text-[12px] text-muted">Anyone in Sahabat Warga with the link can&apos;t open it</span>
        </div>
        <PermissionSelect value="Restricted" label="General access" />
      </div>
    </Drawer>
  )
}
