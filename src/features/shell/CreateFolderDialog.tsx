import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../../ui/ds/Button'

/** Minimal create-folder dialog (local only). */
export function CreateFolderDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onConfirm: (name: string) => void
}) {
  const [name, setName] = useState('')
  function submit() {
    const trimmed = name.trim()
    if (trimmed) {
      onConfirm(trimmed)
      setName('')
      onOpenChange(false)
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#0C0A0926] duration-150 animate-in fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 flex w-[360px] -translate-x-1/2 -translate-y-1/2 flex-col gap-[16px] rounded-lg bg-surface p-[24px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_12px_32px_#0C0A0924] duration-200 ease-soft animate-in fade-in-0 zoom-in-95 focus:outline-none"
        >
          <Dialog.Title className="m-0 text-[16px] font-semibold text-ink">New folder</Dialog.Title>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') onOpenChange(false)
            }}
            placeholder="Folder name"
            aria-label="Folder name"
            className="h-[36px] w-full rounded-base bg-surface px-[9px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong"
          />
          <div className="flex justify-end gap-[8px]">
            <Button variant="secondary" style={{ height: 32 }} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" style={{ height: 32 }} onClick={submit}>
              Create
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
