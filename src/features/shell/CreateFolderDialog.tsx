import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../../ui/ds/Button'
import { drawerOverlayClass, drawerContentClass } from '../../ui/ds/Drawer'

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
        <Dialog.Overlay className={drawerOverlayClass} />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          style={{ width: 360 }}
          className={`${drawerContentClass} gap-[16px] p-[24px] focus:outline-none`}
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
