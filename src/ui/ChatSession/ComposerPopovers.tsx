import * as Popover from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import { Mascot } from '../ds/Mascot'
import { buildItems } from './composerModel'
import type { IconType, PickerItem, TriggerKind } from './composerModel'

// Re-exported so the composer keeps a single source for the picker kind union.
export type ComposerPopoverKind = TriggerKind | 'none'

/** Popover surface: radius 10 · 1px line-strong · shadow 0 10 24 #0C0A0929 · padding 4. */
const surface =
  'z-50 flex flex-col rounded-md bg-surface p-[4px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_10px_24px_#0C0A0929]'

/** Row: radius 6 · gap 10 · padding 7 10; the active row gets the hover fill. */
const rowClass =
  'flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[7px] text-left transition-colors'

/** pen `Kbd` (sDbNQ): surface · radius 4 · line-strong stroke 1/1/2/1 · padding 1 5 · mono 10.5 ink-2. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-xs bg-surface px-[5px] pt-[1px] pb-[2px] font-mono text-[10.5px] leading-[normal] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong),inset_0_-2px_0_var(--color-line-strong)]">
      {children}
    </span>
  )
}

function Heading({ label }: { label: string }) {
  return (
    <div className="flex w-full px-[10px] pt-[8px] pb-[4px]">
      <span className="text-[11px] font-semibold tracking-[0.6px] text-faint">{label}</span>
    </div>
  )
}

function RowText({ title, sub }: { title: string; sub?: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
      <span className="truncate text-[13px] leading-[16px] font-medium text-ink">{title}</span>
      {sub && <span className="truncate text-[11px] leading-[13px] text-muted">{sub}</span>}
    </span>
  )
}

/** Footer: top hairline · gap 12 · padding 8 10 6 10 · key hint + muted 11 label. */
function Footer({ hints }: { hints: [string, string][] }) {
  return (
    <div className="flex w-full items-center gap-[12px] px-[10px] pt-[8px] pb-[6px] shadow-[inset_0_1px_0_var(--color-line)]">
      {hints.map(([key, label]) => (
        <span key={label} className="flex items-center gap-[4px]">
          <Kbd>{key}</Kbd>
          <span className="text-[11px] text-muted">{label}</span>
        </span>
      ))}
    </div>
  )
}

/** pen `Icon Box`: 28×28 · radius 6 · soft (+ optional line stroke) · 14px icon. */
function IconBox({ icon: Icon, tone = 'soft', stroked = false }: { icon: IconType; tone?: 'soft' | 'ok' | 'skill'; stroked?: boolean }) {
  const look =
    tone === 'ok'
      ? 'bg-ok-tint text-ok'
      : tone === 'skill'
        ? 'bg-[#EEF2FF] text-helper-brand'
        : `bg-soft text-ink-2 ${stroked ? 'outline-1 -outline-offset-1 outline-line' : ''}`
  return (
    <span className={`flex size-[28px] shrink-0 items-center justify-center rounded-sm ${look}`}>
      <Icon size={14} aria-hidden />
    </span>
  )
}

/** Leading visual for a row: helper mascot, person avatar, or icon box. */
function RowLeading({ item, kind }: { item: PickerItem; kind: TriggerKind }) {
  if (item.area) return <Mascot helper size={24} radius={7} area={item.area} />
  if (item.initials)
    return (
      <span className="inline-flex size-[24px] shrink-0 items-center justify-center rounded-full bg-[#FED7AA] text-[11px] font-semibold text-[#9A3412]">
        {item.initials}
      </span>
    )
  if (item.icon) return <IconBox icon={item.icon} tone={item.tone} stroked={kind === 'command'} />
  return null
}

const FOOTER_HINTS: Record<TriggerKind, [string, string][]> = {
  mention: [['↑↓', 'navigate'], ['↵', 'mention'], ['esc', 'close']],
  command: [['↑↓', 'navigate'], ['↵', 'run'], ['esc', 'close']],
  context: [['↑↓', 'navigate'], ['↵', 'attach'], ['esc', 'close']],
}

interface PickerListProps {
  kind: TriggerKind
  items: PickerItem[]
  activeIndex: number
  onSelect: (item: PickerItem) => void
  onHover: (index: number) => void
}

/**
 * Pure list renderer for the composer pickers. The caret stays in the editor, so
 * keyboard navigation lives in the editor and is reflected here via `activeIndex`
 * (the active row gets aria-selected + hover fill). Grouped by `item.group`.
 */
export function PickerList({ kind, items, activeIndex, onSelect, onHover }: PickerListProps) {
  if (items.length === 0) {
    return <div className="px-[10px] py-[12px] text-[12px] text-muted">No matches.</div>
  }
  let lastGroup = ''
  return (
    <div role="listbox" aria-label="Suggestions" className="flex w-full flex-col">
      {items.map((item, i) => {
        const showHeading = item.group !== lastGroup
        lastGroup = item.group
        const active = i === activeIndex
        return (
          <div key={item.id} className="contents">
            {showHeading && <Heading label={item.group} />}
            <button
              type="button"
              role="option"
              aria-selected={active}
              // Mouse down (not click) so the editor keeps focus/selection for chip insertion.
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(item)
              }}
              onMouseEnter={() => onHover(i)}
              className={`${rowClass} ${active ? 'bg-hover' : ''}`}
            >
              <RowLeading item={item} kind={kind} />
              <RowText title={item.title} sub={item.sub} />
              {item.trail && <span className="shrink-0 text-[11px] text-faint">{item.trail}</span>}
            </button>
          </div>
        )
      })}
      <Footer hints={FOOTER_HINTS[kind]} />
    </div>
  )
}

const PICKER_WIDTH: Record<TriggerKind, number> = { mention: 320, command: 380, context: 400 }
const PICKER_LABEL: Record<TriggerKind, string> = {
  mention: 'Mention someone',
  command: 'Commands',
  context: 'Add context',
}

interface ComposerPickerProps {
  kind: ComposerPopoverKind
  items: PickerItem[]
  activeIndex: number
  onClose: () => void
  onSelect: (item: PickerItem) => void
  onHover: (index: number) => void
  /** The composer card the popover sits above. */
  children: ReactNode
}

/**
 * Popover above the composer: left edge 11px in from the card (in line with the
 * typed text), 38px of air between the popover and the card. The list it renders
 * is driven by `items`/`activeIndex` computed in the composer.
 */
export function ComposerPicker({ kind, items, activeIndex, onClose, onSelect, onHover, children }: ComposerPickerProps) {
  const open = kind !== 'none'
  return (
    <Popover.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Popover.Anchor asChild>{children}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          alignOffset={11}
          sideOffset={38}
          avoidCollisions={false}
          aria-label={open ? PICKER_LABEL[kind] : undefined}
          className={surface}
          style={{ width: open ? PICKER_WIDTH[kind] : undefined }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {open && (
            <PickerList kind={kind} items={items} activeIndex={activeIndex} onSelect={onSelect} onHover={onHover} />
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// Re-export for convenience.
export { buildItems }
