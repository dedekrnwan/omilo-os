/**
 * Confirm dialog for negative / destructive actions.
 *
 * Instead of a static warning icon, it shows a *sad* mascot — the house way to
 * signal "this one's heavy, are you sure?". Built on the shared centered Dialog.
 */

import type { HelperArea } from '../../core/domain/types'
import { Dialog } from './Dialog'
import { Button } from './Button'
import { Mascot } from './Mascot'

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  area = 'brand',
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' paints the confirm button red; 'primary' keeps it the normal accent. */
  tone?: 'danger' | 'primary'
  /** Which helper's mascot mopes at you. Defaults to Chief (brand). */
  area?: HelperArea
  onConfirm: () => void
}) {
  function confirm() {
    onConfirm()
    onOpenChange(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      width={400}
      bodyClass="gap-[14px] px-[24px] pt-[18px] pb-[8px]"
      footer={
        <>
          <span className="flex-1" />
          <Button variant="secondary" style={{ height: 32 }} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          {tone === 'danger' ? (
            <button
              type="button"
              onClick={confirm}
              className="inline-flex h-[32px] shrink-0 items-center gap-[5px] rounded-btn bg-bad px-[12px] text-[12.5px] font-medium text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ink active:scale-[0.97]"
            >
              {confirmLabel}
            </button>
          ) : (
            <Button variant="primary" style={{ height: 32 }} onClick={confirm}>
              {confirmLabel}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col items-center gap-[12px] text-center">
        <Mascot helper size={64} radius={16} area={area} mood="sad" still />
        <p className="m-0 max-w-[300px] text-[13px] leading-[1.55] text-muted">{message}</p>
      </div>
    </Dialog>
  )
}
