import { useEffect, useRef } from 'react'
import { Archive, CircleCheck, Pencil, Play, RotateCcw, SkipForward, X } from 'lucide-react'
import { IconButton } from '../../ui/ds/Button'
import { Mascot } from '../../ui/ds/Mascot'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from '../../ui/ds/Menu'
import type { HelperArea } from '../../core/domain/types'
import { DELETE_COPY } from './data'
import { Chip, PrimaryButton, Scrim, SecondaryButton } from './ui'

function useDismiss(onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', down)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('pointerdown', down)
    }
  }, [onClose, ref])
}

export interface Anchor {
  left: number
  right: number
  top: number
  bottom: number
}

/** pen `Row Menu` (M2sNJi instance in aufEI): 220 wide, 2px under the ⋯ button, right-aligned 4px in. */
export function RowMenu({
  anchor,
  title,
  onClose,
  onEdit,
  onRun,
  onSkip,
  onDelete,
  skipHint,
}: {
  anchor: Anchor
  title: string
  /** Day of the run that Skip would drop, e.g. "Mon 27". */
  skipHint?: string
  onClose: () => void
  onEdit: () => void
  onRun: () => void
  onSkip: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(onClose, ref)
  const item = (label: string, fn: () => void, icon: typeof Pencil, hint?: string, danger?: boolean) => (
    <button
      type="button"
      role="menuitem"
      className={`${menuItemClass} focus-visible:bg-hover`}
      onClick={() => {
        onClose()
        fn()
      }}
    >
      <MenuItemBody icon={icon} label={label} hint={hint} danger={danger} />
    </button>
  )
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${title} actions`}
      className={`fixed z-50 flex w-[220px] flex-col ${menuSurface}`}
      style={{ top: anchor.bottom + 2, left: anchor.right - 224 }}
    >
      <div className="px-[10px] pt-[6px] pb-[2px] text-[11px] font-medium tracking-[0.55px] text-muted">
        {title.toUpperCase()}
      </div>
      {item('Edit', onEdit, Pencil)}
      {item('Run now', onRun, Play, 'R')}
      {item('Skip next run', onSkip, SkipForward, skipHint)}
      <MenuSeparatorLine />
      {item('Delete routine', onDelete, Archive, undefined, true)}
    </div>
  )
}

/** pen `Confirm delete` (x70TQk instance in o05E12). */
export function DeleteConfirm({ name, onPause, onDelete, onClose }: { name: string; onPause: () => void; onDelete: () => void; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <>
      <Scrim onClick={onClose} />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="routine-delete-title"
          className="pointer-events-auto flex w-[420px] flex-col items-center rounded-dialog bg-surface px-[24px] pt-[26px] pb-[20px] shadow-[0_30px_80px_#1C191747]"
        >
          <div
            className="flex size-[104px] items-center justify-center rounded-[37px]"
            style={{
              background:
                'radial-gradient(ellipse 50% 50% at 50% 35%, #F3EEFF 0%, #F8F5FF 60%, #F8F5FF00 70%)',
            }}
          >
            <Mascot size={64} radius={18} area="brand" helper />
          </div>
          <div className="h-[12px]" />
          <h2 id="routine-delete-title" className="m-0 font-serif text-[22px] leading-[1.25] font-medium tracking-[-0.22px] text-ink">
            Delete “{name}”?
          </h2>
          <div className="h-[8px]" />
          <p className="m-0 w-[340px] text-center text-[14px] leading-[1.55] text-ink-2">{DELETE_COPY.body}</p>
          <div className="flex w-full gap-[8px] pt-[20px]">
            <SecondaryButton height={40} className="flex-1 rounded-lg font-semibold" onClick={onPause}>
              Pause instead
            </SecondaryButton>
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex h-[32px] shrink-0 items-center justify-center rounded-btn bg-bad-solid px-[14px] text-[14px] font-medium text-primary-ink hover:brightness-95"
            >
              Delete routine
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export interface FailureInfo {
  title: string
  meta: string
  why: string
  area: HelperArea
  /** Primary action label, e.g. "Check connectors" or "View run". */
  actionLabel: string
}

/** pen `Failure Popover` (YtxGi in l6KQtK): 320 wide, under the failed chip. */
export function FailurePopover({
  anchor,
  failure,
  onClose,
  onAction,
  onRetry,
}: {
  anchor: Anchor
  failure: FailureInfo
  onClose: () => void
  onAction: () => void
  onRetry: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(onClose, ref)
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={failure.title}
      className="fixed z-50 flex w-[320px] flex-col gap-[10px] rounded-lg bg-surface p-[14px] shadow-[0_12px_28px_#0C0A0924] outline-1 -outline-offset-1"
      style={{ top: anchor.bottom + 8, left: Math.max(8, anchor.left - 149), outlineColor: '#FECACA' }}
    >
      <div className="flex w-full items-center gap-[8px]">
        <Mascot size={20} radius={6} area={failure.area} />
        <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
          <span className="text-[13px] font-semibold text-ink">{failure.title}</span>
          <span className="text-[11.5px] text-muted">{failure.meta}</span>
        </div>
        <Chip tone="bad" label="Failed" />
      </div>
      <p className="m-0 text-[12.5px] leading-[1.5] text-ink-2">{failure.why}</p>
      <div className="flex w-full gap-[6px]">
        <PrimaryButton height={30} fontSize={12.5} className="flex-1" onClick={onAction}>
          {failure.actionLabel}
        </PrimaryButton>
        <SecondaryButton height={30} fontSize={12.5} icon={RotateCcw} className="flex-1" onClick={onRetry}>
          Retry now
        </SecondaryButton>
      </div>
    </div>
  )
}

/** pen `Toast` (LZRbW instance in FcmwG): 380 wide, centred at the bottom of the inset. */
export function AppliedToast({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <div
      role="status"
      className="absolute bottom-[14px] left-1/2 z-30 flex w-[380px] -translate-x-1/2 gap-[10px] rounded-lg bg-surface py-[12px] pr-[8px] pl-[14px] shadow-[0_10px_24px_#0C0A0929] outline-1 -outline-offset-1 outline-line-strong"
    >
      <CircleCheck size={18} aria-hidden className="shrink-0 text-ok" />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[14px] font-medium text-ink">{title}</span>
        <span className="text-[13px] leading-[1.45] text-muted">{body}</span>
      </div>
      <IconButton icon={X} size={14} aria-label="Dismiss" onClick={onClose} />
    </div>
  )
}
