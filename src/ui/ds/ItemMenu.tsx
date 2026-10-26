import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef, MouseEvent, ReactElement } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Ellipsis } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from './Menu'

/**
 * One list of actions per thing — used by BOTH its ⋯ button and right-click.
 * Nothing should live only in the context menu.
 */
export type MenuEntry =
  | {
      type?: 'item'
      label: string
      icon?: LucideIcon
      hint?: string
      danger?: boolean
      disabled?: boolean
      /** Shows a check (toggle-like items: Pin, Mute…) */
      checked?: boolean
      onSelect: () => void
    }
  | { type: 'separator' }
  | { type: 'label'; label: string }
  | { type: 'sub'; label: string; icon?: LucideIcon; disabled?: boolean; items: MenuEntries }

/** Falsy entries are skipped, so lists can use `cond && {...}`. */
export type MenuEntries = ReadonlyArray<MenuEntry | false | null | undefined | '' | 0>

type Kit = typeof DropdownMenu | typeof ContextMenu

const itemClass = `${menuItemClass} data-[disabled]:pointer-events-none data-[disabled]:opacity-45`

/** Drop leading/trailing/double separators left over from conditional items. */
function clean(entries: MenuEntries): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const e of entries) {
    if (!e) continue
    if (e.type === 'separator' && (out.length === 0 || out.at(-1)?.type === 'separator')) continue
    out.push(e)
  }
  while (out.at(-1)?.type === 'separator') out.pop()
  return out
}

function Entries({ kit, entries }: { kit: Kit; entries: MenuEntries }) {
  const K = kit as typeof DropdownMenu
  return (
    <>
      {clean(entries).map((e, i) => {
        if (e.type === 'separator') return <MenuSeparatorLine key={`s${i}`} />
        if (e.type === 'label')
          return (
            <K.Label key={`l${i}`} className="px-[10px] pt-[6px] pb-[3px] text-[11px] font-medium tracking-[0.55px] text-faint">
              {e.label}
            </K.Label>
          )
        if (e.type === 'sub')
          return (
            <K.Sub key={`u${i}-${e.label}`}>
              <K.SubTrigger disabled={e.disabled} className={`${itemClass} data-[state=open]:bg-hover`}>
                <MenuItemBody icon={e.icon} label={e.label} />
                <ChevronRight size={14} aria-hidden className="-mr-[2px] text-faint" />
              </K.SubTrigger>
              <K.Portal>
                <K.SubContent sideOffset={6} alignOffset={-4} collisionPadding={8} className={`z-[60] max-h-[420px] w-[220px] overflow-y-auto ${menuSurface}`}>
                  <Entries kit={kit} entries={e.items} />
                </K.SubContent>
              </K.Portal>
            </K.Sub>
          )
        return (
          <K.Item key={`i${i}-${e.label}`} disabled={e.disabled} className={itemClass} onSelect={e.onSelect}>
            <MenuItemBody icon={e.icon} label={e.label} hint={e.hint} danger={e.danger} />
            {e.checked && <Check size={14} aria-hidden className="text-ink-2" />}
          </K.Item>
        )
      })}
    </>
  )
}

/** Right-click (and long-press, and the context-menu key) on the child opens the item's menu. */
export function ContextMenuArea({
  items,
  children,
  label,
  onOpenChange,
  disabled,
}: {
  items: MenuEntries
  children: ReactElement
  /** Accessible name for the menu, e.g. "Q3 launch plan actions" */
  label?: string
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
}) {
  const empty = clean(items).length === 0
  return (
    <ContextMenu.Root modal={false} onOpenChange={onOpenChange}>
      <ContextMenu.Trigger
        asChild
        disabled={disabled || empty}
        onContextMenuCapture={(e: MouseEvent) => {
          // Text fields and selected text keep the browser's own menu (copy, paste, spellcheck)
          const t = e.target as HTMLElement
          const selected = window.getSelection?.()?.toString()
          if (t.closest('input, textarea, [contenteditable="true"], a[href]') || selected) e.stopPropagation()
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content aria-label={label} collisionPadding={8} className={`z-50 w-[220px] ${menuSurface}`}>
          <Entries kit={ContextMenu} entries={items} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

/** The ⋯ button for an item — opens the same entries as right-click. */
export const MoreMenu = forwardRef<
  HTMLButtonElement,
  {
    items: MenuEntries
    label: string
    /** Custom trigger; defaults to a 22px ⋯ icon button */
    trigger?: ReactElement
    align?: 'start' | 'end'
    side?: 'bottom' | 'right'
    onOpenChange?: (open: boolean) => void
    size?: number
  } & Omit<ComponentPropsWithoutRef<'button'>, 'children'>
>(function MoreMenu({ items, label, trigger, align = 'end', side = 'bottom', onOpenChange, size = 22, className = '', ...rest }, ref) {
  return (
    <DropdownMenu.Root modal={false} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        {trigger ?? (
          <button
            ref={ref}
            type="button"
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className={`flex shrink-0 items-center justify-center rounded-xs text-muted outline-none hover:bg-[#0C0A090F] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink data-[state=open]:bg-[#0C0A090F] data-[state=open]:text-ink ${className}`}
            style={{ width: size, height: size }}
            {...rest}
          >
            <Ellipsis size={14} aria-hidden />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side={side} align={align} sideOffset={4} collisionPadding={8} className={`z-50 w-[220px] ${menuSurface}`}>
          <Entries kit={DropdownMenu} entries={items} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
})

/** Copy text and tell the caller (for "Copy link" items). */
export function copyText(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => {})
}

