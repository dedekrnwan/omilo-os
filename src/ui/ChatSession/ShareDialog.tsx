import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, Copy, Link, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Mascot } from '../ds/Mascot'

// ── Share dialog (pen ref P334a) ─────────────────────────────────────────────

interface ShareDialogProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Permission = 'Owner' | 'Can talk' | 'Can view' | 'Restricted'

function PermissionSelect({ value }: { value: Permission }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-[4px] rounded-base px-[8px] py-[4px] text-[12.5px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
    >
      {value}
      <ChevronDown size={12} aria-hidden className="text-muted" />
    </button>
  )
}

function Row({
  avatar,
  name,
  sub,
  permission,
}: {
  avatar: ReactNode
  name: string
  sub?: string
  permission: Permission
}) {
  return (
    <div className="flex items-center gap-[10px] py-[6px]">
      {avatar}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium text-ink">{name}</span>
        {sub && <span className="text-[11.5px] text-muted">{sub}</span>}
      </div>
      {permission === 'Owner' ? (
        <span className="text-[12.5px] text-muted">Owner</span>
      ) : (
        <PermissionSelect value={permission} />
      )}
    </div>
  )
}

export function ShareDialog({ title, open, onOpenChange }: ShareDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
        <Dialog.Content
          aria-label={`Share "${title}"`}
          className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-dialog bg-surface shadow-[0_20px_60px_#0000002E] outline-none"
        >
          {/* Header */}
          <div className="flex items-start gap-[10px] px-[24px] pt-[24px] pb-[16px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
              <Dialog.Title className="m-0 text-[16px] font-semibold text-ink">
                Share &ldquo;{title}&rdquo;
              </Dialog.Title>
              <Dialog.Description className="m-0 text-[12.5px] text-muted">
                People you add see the whole chat and can talk to the helpers in it.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="inline-flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
              >
                <X size={16} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {/* Search */}
          <div className="px-[24px] pb-[12px]">
            <div className="flex items-center gap-[8px] rounded-base bg-app px-[10px] py-[8px] outline-1 -outline-offset-1 outline-line-strong">
              <input
                placeholder="Add people, emails or a channel…"
                aria-label="Add people, emails or a channel"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
              />
            </div>
          </div>

          {/* Who has access */}
          <div className="px-[24px]">
            <p className="mb-[4px] text-[11px] font-medium uppercase tracking-[0.55px] text-muted">
              Who has access
            </p>
            <Row
              avatar={<Mascot size={32} radius={9} area="brand" />}
              name="Dede Kurniawan (you)"
              sub="dede@sahabatwarga.id"
              permission="Owner"
            />
            <Row
              avatar={
                <span className="inline-flex size-[32px] shrink-0 items-center justify-center rounded-lg bg-[#F97316] text-[12px] font-bold text-white">
                  RA
                </span>
              }
              name="Rina Ayu"
              sub="rina@sahabatwarga.id"
              permission="Can talk"
            />
            <Row
              avatar={
                <span className="inline-flex size-[32px] shrink-0 items-center justify-center rounded-lg bg-app outline-1 -outline-offset-1 outline-line-strong text-[12px] font-semibold text-ink-2">
                  #
                </span>
              }
              name="#engineering"
              sub="12 people in the channel"
              permission="Can view"
            />
            <Row
              avatar={
                <span className="inline-flex size-[32px] shrink-0 items-center justify-center rounded-full bg-app outline-1 -outline-offset-1 outline-line-strong">
                  <Link size={14} aria-hidden className="text-muted" />
                </span>
              }
              name="Only people added"
              sub="Anyone in Sahabat Warga with the link can't open"
              permission="Restricted"
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-[24px] pt-[16px] pb-[20px]">
            <button
              type="button"
              className="inline-flex items-center gap-[6px] rounded-base px-[10px] py-[6px] text-[12.5px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
            >
              <Copy size={13} aria-hidden />
              Copy link
            </button>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-btn bg-primary px-[14px] py-[7px] text-[12.5px] font-medium text-primary-ink transition-colors hover:bg-primary-hover"
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
