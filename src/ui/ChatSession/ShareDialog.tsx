import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, Link, Lock, Search, UserPlus, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from '../ds/Button'
import { drawerOverlayClass, drawerContentClass } from '../ds/Drawer'

// ── Share dialog (pen `Chat · Session · Share` P334a, dialog frhtA) ───────────

interface ShareDialogProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** pen `Select` (gVDns) field only: 130 × 36 · radius 8 · line-strong · value 13 ink · chevron 16 muted. */
function PermissionSelect({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-[36px] w-[130px] shrink-0 items-center gap-[8px] rounded-base bg-surface px-[10px] text-left outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
    >
      <span className="flex-1 text-[13px] text-ink">{value}</span>
      <ChevronDown size={16} aria-hidden className="text-muted" />
    </button>
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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={drawerOverlayClass} />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          style={{ width: 500 }}
          className={drawerContentClass}
        >
          {/* Head */}
          <div className="flex w-full items-center gap-[12px] py-[14px] pr-[12px] pl-[20px] shadow-[inset_0_-1px_0_var(--color-line)]">
            <span className="flex size-[32px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
              <UserPlus size={16} aria-hidden className="text-ink-2" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <Dialog.Title className="m-0 text-[16px] font-semibold text-ink">Share &ldquo;{title}&rdquo;</Dialog.Title>
              <p className="m-0 text-[12.5px] text-muted">
                People you add see the whole chat and can talk to the helpers in it.
              </p>
            </div>
            <Dialog.Close asChild>
              <IconButton icon={X} aria-label="Close" />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex w-full flex-col gap-[16px] p-[20px]">
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
          </div>

          {/* Footer */}
          <div className="flex w-full items-center gap-[8px] px-[20px] py-[12px] shadow-[inset_0_1px_0_var(--color-line)]">
            <button
              type="button"
              className="inline-flex h-[32px] items-center gap-[6px] rounded-btn px-[14px] text-[13px] text-muted transition-colors hover:bg-hover"
            >
              <Link size={16} aria-hidden />
              Copy link
            </button>
            <span className="h-px flex-1" />
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-[32px] items-center justify-center rounded-btn bg-primary px-[14px] text-[13px] font-medium text-primary-ink outline-1 -outline-offset-1 outline-primary transition-colors hover:bg-primary-hover"
              >
                Done
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
