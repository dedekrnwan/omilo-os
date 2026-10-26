import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './Button'
import { useEscapeKey } from './useEscapeKey'

/**
 * Shared styling for Radix-Dialog-based right drawers. All app "dialogs" render
 * as right-anchored, full-height drawers that slide in from the right. Swap a
 * centered Dialog.Content for these classes (keep width via style) to convert it.
 */

/** Scrim overlay (fade in/out). */
export const drawerOverlayClass =
  'fixed inset-0 z-50 bg-[#0C0A0940] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'

/**
 * Right-anchored, full-height drawer content (slide in/out from the right).
 * Apply width via `style={{ width }}`; it is capped to the viewport.
 */
export const drawerContentClass =
  'fixed inset-y-0 right-0 z-50 flex h-full max-w-[calc(100vw-32px)] flex-col overflow-hidden bg-surface shadow-[-24px_0_48px_#0C0A0929] outline-1 -outline-offset-1 outline-line-strong duration-200 ease-soft data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-right-8 data-[state=open]:slide-in-from-right-8'

/**
 * Canonical right-drawer shell (pen "Drawer"): a floating card 8px from the
 * right/top/bottom, r20, big shadow, over a dimming scrim. Header is a serif
 * title + muted subtitle + close; the body scrolls; the footer sits in a soft
 * bar and takes arbitrary content (helper text + actions).
 *
 * This is the one reusable drawer every "create / detail" panel should use so
 * Flows, Routines, Goals, etc. all look identical. Callers own the body and the
 * footer slot; pass actions as children of `footer`.
 */
export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 480,
  bodyClass = 'gap-[18px] px-[24px] py-[20px]',
}: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Drawer width in px (capped to the viewport). Defaults to 480. */
  width?: number
  /** Override body padding/gap. */
  bodyClass?: string
}) {
  useEscapeKey(onClose)
  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-[#0C0A0940] backdrop-blur-[2px] duration-150 ease-soft animate-in fade-in-0"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        style={{ width, maxWidth: 'calc(100vw - 16px)' }}
        className="fixed top-[8px] right-[8px] bottom-[8px] z-50 flex flex-col overflow-hidden rounded-dialog bg-surface shadow-[0_24px_64px_#0C0A0940] outline-1 -outline-offset-1 outline-line-strong duration-200 ease-soft animate-in fade-in-0 slide-in-from-right-6"
      >
        <header className="flex w-full shrink-0 gap-[12px] shadow-[inset_0_-1px_0_var(--color-line)] pt-[20px] pr-[16px] pb-[16px] pl-[24px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <h2 className="m-0 font-serif text-[22px] leading-[27px] font-medium tracking-[-0.22px] text-ink">
              {title}
            </h2>
            {subtitle && <p className="m-0 text-[13px] text-muted">{subtitle}</p>}
          </div>
          <IconButton icon={X} aria-label="Close" onClick={onClose} />
        </header>
        <div className={`flex min-h-0 w-full flex-1 flex-col overflow-y-auto ${bodyClass}`}>{children}</div>
        {footer && (
          <footer className="flex w-full shrink-0 items-center gap-[8px] shadow-[inset_0_1px_0_var(--color-line)] bg-soft px-[24px] py-[14px]">
            {footer}
          </footer>
        )}
      </aside>
    </>
  )
}
