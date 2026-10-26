/**
 * Shared centered modal dialog — the compact counterpart to the right `Drawer`.
 *
 * Use this for short, focused forms (create company, create area, new folder,
 * reference lists) where a full-height right drawer is too much. Rich, multi-
 * section flows should stay in `Drawer`. Same header/footer language as the
 * drawer (serif title + subtitle + close, scrolling body, soft footer slot) so
 * the two read as one family.
 */

import type { ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { IconButton } from './Button'

/** Dimming scrim shared with the drawer. */
const overlayClass =
  'fixed inset-0 z-50 bg-[#0C0A0940] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'

/** Centered card that zooms in. Width via `style`; capped to the viewport. */
const contentClass =
  'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-32px)] w-full max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-dialog bg-surface shadow-[0_24px_64px_#0C0A0940] outline-1 -outline-offset-1 outline-line-strong duration-200 ease-soft focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'

export function Dialog({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  width = 440,
  bodyClass = 'gap-[16px] px-[24px] py-[20px]',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Dialog width in px (capped to the viewport). Defaults to 440. */
  width?: number
  /** Override body padding/gap. */
  bodyClass?: string
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={overlayClass} />
        <RadixDialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          style={{ width }}
          className={contentClass}
        >
          <header className="flex w-full shrink-0 gap-[12px] shadow-[inset_0_-1px_0_var(--color-line)] pt-[20px] pr-[16px] pb-[16px] pl-[24px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
              <RadixDialog.Title className="m-0 font-serif text-[22px] leading-[27px] font-medium tracking-[-0.22px] text-ink">
                {title}
              </RadixDialog.Title>
              {subtitle && <p className="m-0 text-[13px] leading-[1.5] text-muted">{subtitle}</p>}
            </div>
            <RadixDialog.Close asChild>
              <IconButton icon={X} aria-label="Close" />
            </RadixDialog.Close>
          </header>
          <div className={`flex min-h-0 w-full flex-1 flex-col overflow-y-auto ${bodyClass}`}>{children}</div>
          {footer && (
            <footer className="flex w-full shrink-0 items-center gap-[8px] shadow-[inset_0_1px_0_var(--color-line)] bg-soft px-[24px] py-[14px]">
              {footer}
            </footer>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
