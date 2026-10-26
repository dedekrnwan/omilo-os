import { useState } from 'react'
import { Button } from '../../ui/ds/Button'
import { Drawer } from '../../ui/ds/Drawer'

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
  if (!open) return null
  return (
    <Drawer
      title="New folder"
      onClose={() => onOpenChange(false)}
      width={360}
      bodyClass="gap-[16px] px-[24px] py-[20px]"
      footer={
        <>
          <span className="flex-1" />
          <Button variant="secondary" style={{ height: 32 }} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" style={{ height: 32 }} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
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
    </Drawer>
  )
}
