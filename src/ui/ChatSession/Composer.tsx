import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ArrowUp, AtSign, FoldVertical, Hash, Paperclip, Plus, Slash, X } from 'lucide-react'
import type { Model } from '../../core/domain/types'
import { SquareButton } from '../ds/Button'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from '../ds/Menu'
import { ModelMenu, ThinkingMenu } from './ModelMenu'
import type { ThinkingLevel } from './ModelMenu'
import { ContextMenu } from './ContextMenu'
import { ComposerPicker } from './ComposerPopovers'
import type { ComposerPopoverKind } from './ComposerPopovers'
import { ComposerInput } from './ComposerInput'
import type { ComposerInputHandle } from './ComposerInput'
import { filterItems, moveIndex } from './composerModel'
import type { PickerItem, TriggerMatch } from './composerModel'
import { Ring } from './Ring'

export type ComposerMenu = 'model' | 'thinking' | 'context'

export interface ComposerProps {
  sessionId: string
  selectedModel: Model
  onModelChange: (m: Model) => void
  /** Overrides the input placeholder. Defaults to the pen copy. */
  placeholder?: string
  /** Share of the context window in use (Context ring + %). 0-100. */
  contextUsed?: number
  /** Whether the context is almost full. Shows the warning banner and a red ring. */
  contextAlmostFull?: boolean
  onAutoCompactToggle?: () => void
  autoCompact?: boolean
  onCompactNow?: () => void
  /** Pre-filled text (screen states such as "Can you ask @bu"). */
  initialText?: string
  /** Popover open on mount (the @ / # pickers). */
  initialPopover?: ComposerPopoverKind
  /** Composer dropdown open on mount (model / thinking / context). */
  initialMenu?: ComposerMenu
  /** Fired with the trimmed text when the user sends (Enter or the send button). */
  onSend?: (text: string) => void
  autoFocus?: boolean
  /** Hide the context ring (narrow surfaces like the Chief drawer). */
  compact?: boolean
}

/**
 * pen `Composer` (qSGtP): surface card · radius 12 · 1px line-strong ·
 * shadow 0 8 12 #0000001F · padding 10 · gap 8.
 * Rows: input (contentEditable) → controls (Add · spacer · context · model · thinking · voice · send).
 * Typing @ / # / opens the matching picker above the card; ↑↓ navigate, ↵/tab select, esc close.
 * Selected @mentions / #context become atomic badge chips.
 */
export function Composer({
  sessionId,
  selectedModel,
  onModelChange,
  placeholder = 'Ask a helper — @ to bring someone in, / for commands',
  contextUsed = 42,
  contextAlmostFull = false,
  onAutoCompactToggle,
  autoCompact = true,
  onCompactNow,
  initialText = '',
  initialPopover = 'none',
  initialMenu,
  onSend,
  autoFocus = false,
  compact = false,
}: ComposerProps) {
  const [thinking, setThinking] = useState<ThinkingLevel>('medium')
  const [plusOpen, setPlusOpen] = useState(false)
  const [picker, setPicker] = useState<TriggerMatch | null>(
    initialPopover === 'none' ? null : { kind: initialPopover, query: '', index: 0 },
  )
  const [activeIndex, setActiveIndex] = useState(0)
  const [hasText, setHasText] = useState(initialText.trim().length > 0)
  // Attached files are retained (as removable chips) until send. The send path
  // is text-only today, so files are cleared on send; the chips make the
  // Attach affordance honest instead of silently discarding the selection.
  const [attachments, setAttachments] = useState<File[]>([])

  const inputRef = useRef<ComposerInputHandle>(null)
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => (picker ? filterItems(picker.kind, picker.query) : []), [picker])

  function onTriggerChange(match: TriggerMatch | null) {
    // Reset the highlight only when the token itself changes — otherwise a keyUp
    // from an arrow/nav key (which re-parses the same token) would clobber it.
    const sameToken = !!match && !!picker && match.kind === picker.kind && match.query === picker.query
    if (!sameToken) setActiveIndex(0)
    setPicker((prev) => {
      const same = !!match && !!prev && match.kind === prev.kind && match.query === prev.query
      return same ? prev : match
    })
  }

  function closePicker() {
    setPicker(null)
  }

  function handleSelect(item: PickerItem) {
    inputRef.current?.selectItem(item)
    setPicker(null)
  }

  function send() {
    const text = inputRef.current?.getText() ?? ''
    const trimmed = text.trim()
    if (trimmed) {
      onSend?.(trimmed)
      inputRef.current?.clear()
      setAttachments([])
    }
    setHasText(false)
    setPicker(null)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (picker && items.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => moveIndex(i, items.length, 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => moveIndex(i, items.length, -1))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        handleSelect(items[activeIndex] ?? items[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closePicker()
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
    if (e.key === 'Escape') closePicker()
  }

  function pickTrigger(sigil: '@' | '#' | '/') {
    // Defer until the + dropdown has closed and released focus/selection — then
    // focusing the input and inserting the sigil opens its picker exactly like
    // typing the sigil directly would.
    setTimeout(() => inputRef.current?.insertTrigger(sigil), 0)
  }

  const full = contextAlmostFull
  const ringColor = full ? 'var(--color-bad)' : undefined

  return (
    <div className="flex w-full flex-col gap-[8px]">
      {/* Context almost full banner (gHFPG) */}
      {full && (
        <div
          role="alert"
          className="flex w-full items-center gap-[10px] rounded-md bg-bad-tint py-[8px] pr-[10px] pl-[12px] outline-1 -outline-offset-1 outline-bad-line"
        >
          <Ring size={18} value={contextUsed} color={ringColor} />
          <span className="flex-1 text-[12.5px] text-ink-2">
            This chat is {contextUsed}% full. Chief will summarise older messages at the next reply.
          </span>
          <button
            type="button"
            onClick={onAutoCompactToggle}
            className="inline-flex h-[28px] shrink-0 items-center rounded-btn px-[8px] text-[12.5px] text-muted transition-colors hover:bg-hover"
          >
            Turn off auto
          </button>
          <button
            type="button"
            onClick={onCompactNow}
            className="inline-flex h-[28px] shrink-0 items-center gap-[6px] rounded-btn bg-surface px-[14px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
          >
            <FoldVertical size={16} aria-hidden />
            Compact now
          </button>
        </div>
      )}

      <ComposerPicker
        kind={picker?.kind ?? 'none'}
        items={items}
        activeIndex={activeIndex}
        onClose={closePicker}
        onSelect={handleSelect}
        onHover={setActiveIndex}
      >
        {/* Composer card */}
        <div className="flex w-full flex-col gap-[8px] rounded-lg bg-surface p-[10px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_8px_12px_#0000001F]">
          <div className="flex min-h-[44px] w-full p-[4px]">
            <ComposerInput
              key={sessionId}
              ref={inputRef}
              placeholder={placeholder}
              initialText={initialText}
              onTextChange={(t) => setHasText(t.trim().length > 0)}
              onTriggerChange={onTriggerChange}
              onKeyDown={handleKeyDown}
            />
          </div>

          {/* Hidden file input for Attach — selected files are retained as chips. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            aria-label="File input"
            className="sr-only"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? [])
              if (picked.length) setAttachments((prev) => [...prev, ...picked])
              e.target.value = ''
            }}
          />

          {/* Attached-file chips */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-[6px] px-[4px]">
              {attachments.map((file, i) => (
                <span
                  key={`${file.name}-${i}`}
                  className="inline-flex items-center gap-[6px] rounded-base bg-soft px-[8px] py-[4px] text-[11.5px] text-ink-2 outline-1 -outline-offset-1 outline-line"
                >
                  <Paperclip size={12} aria-hidden className="text-muted" />
                  <span className="max-w-[160px] truncate">{file.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    className="inline-flex text-muted transition-colors hover:text-ink"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Controls */}
          <div className="flex w-full items-center gap-[8px]">
            <DropdownMenu.Root open={plusOpen} onOpenChange={setPlusOpen}>
              <DropdownMenu.Trigger asChild>
                <SquareButton icon={Plus} aria-label="Add" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side="top"
                  align="start"
                  sideOffset={8}
                  className={`z-50 w-[220px] ${menuSurface}`}
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => pickTrigger('@')}>
                    <MenuItemBody icon={AtSign} label="Mention someone" />
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => pickTrigger('#')}>
                    <MenuItemBody icon={Hash} label="Add context" />
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => pickTrigger('/')}>
                    <MenuItemBody icon={Slash} label="Commands" />
                  </DropdownMenu.Item>
                  <MenuSeparatorLine />
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => fileInputRef.current?.click()}>
                    <MenuItemBody icon={Paperclip} label="Attach file" />
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            <div className="h-px flex-1" />
            {!compact && (
              <ContextMenu
                contextUsed={contextUsed}
                onAutoCompactToggle={onAutoCompactToggle}
                autoCompact={autoCompact}
                onCompactNow={onCompactNow}
                defaultOpen={initialMenu === 'context'}
              >
                <button
                  type="button"
                  aria-label={`Context ${contextUsed}% used`}
                  className="inline-flex items-center gap-[5px] rounded-base px-[6px] py-[4px] transition-colors hover:bg-hover data-[state=open]:bg-hover"
                >
                  <Ring size={16} value={contextUsed} color={ringColor} />
                  <span className={`font-mono text-[11px] ${full ? 'font-semibold text-bad' : 'text-muted'}`}>
                    {contextUsed}%
                  </span>
                </button>
              </ContextMenu>
            )}
            <ModelMenu selected={selectedModel} onSelect={onModelChange} defaultOpen={initialMenu === 'model'} />
            <ThinkingMenu
              model={selectedModel}
              level={thinking}
              onSelect={setThinking}
              defaultOpen={initialMenu === 'thinking'}
            />
            <SquareButton
              variant="primary"
              icon={ArrowUp}
              aria-label="Send"
              aria-disabled={!hasText}
              onClick={send}
            />
          </div>
        </div>
      </ComposerPicker>
    </div>
  )
}
