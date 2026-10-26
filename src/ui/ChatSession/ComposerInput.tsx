import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { parseTrigger } from './composerModel'
import type { PickerItem, TriggerKind, TriggerMatch } from './composerModel'

export interface ComposerInputHandle {
  /** Plain-text value, with chips serialised as their `@value` / `#value` token. */
  getText(): string
  clear(): void
  focus(): void
  /** Replace the active trigger token at the caret with the chosen item (chip or text). */
  selectItem(item: PickerItem): void
  /** Insert a trigger char at the caret (used by the + menu) so its picker opens. */
  insertTrigger(sigil: '@' | '#' | '/'): void
}

interface ComposerInputProps {
  placeholder?: string
  initialText?: string
  onTextChange?: (text: string) => void
  /** Fired on every input/selection change with the active trigger token, or null. */
  onTriggerChange: (match: TriggerMatch | null) => void
  /** Forwarded keydown so the composer can drive picker nav / send. */
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void
}

const CHIP_CLASS: Record<Exclude<TriggerKind, 'command'>, string> = {
  mention:
    'mx-[1px] inline-flex items-center rounded-sm bg-[#EEF2FF] px-[4px] align-baseline text-[13px] font-medium text-helper-brand',
  context:
    'mx-[1px] inline-flex items-center rounded-sm bg-soft px-[4px] align-baseline text-[13px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line',
}

/** Text in the caret's own text node up to the caret — enough for trigger parsing (tokens never span a chip). */
function textBeforeCaret(root: HTMLElement): string {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return ''
  const node = sel.anchorNode
  if (!node || !root.contains(node)) return ''
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').slice(0, sel.anchorOffset)
  return ''
}

/**
 * contentEditable message input. Typing is native (browser owns the caret); React
 * never re-renders the text, so the caret never jumps. Mentions (@) and context (#)
 * are inserted as atomic `contenteditable=false` chips — the browser treats them as
 * a single character for caret movement and backspace.
 */
export const ComposerInput = forwardRef<ComposerInputHandle, ComposerInputProps>(function ComposerInput(
  { placeholder, initialText = '', onTextChange, onTriggerChange, onKeyDown },
  ref,
) {
  const elRef = useRef<HTMLDivElement>(null)
  const [empty, setEmpty] = useState(initialText.length === 0)

  // Seed initial text once (uncontrolled thereafter).
  useEffect(() => {
    const el = elRef.current
    if (el && initialText && el.textContent === '') {
      el.textContent = initialText
      setEmpty(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function getText(): string {
    return elRef.current?.textContent ?? ''
  }

  function emitInput() {
    const el = elRef.current
    if (!el) return
    setEmpty(el.textContent === '')
    onTextChange?.(getText())
    onTriggerChange(parseTrigger(textBeforeCaret(el)))
  }

  function placeCaretAfter(node: Node, offset: number) {
    const sel = window.getSelection()
    if (!sel) return
    const r = document.createRange()
    r.setStart(node, offset)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
  }

  function selectItem(item: PickerItem) {
    const el = elRef.current
    if (!el) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const node = sel.anchorNode
    const offset = sel.anchorOffset
    if (!node || node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return
    const match = parseTrigger((node.textContent ?? '').slice(0, offset))
    if (!match) return

    // Remove the typed token (`@query`) from the text node.
    const tokenLen = match.query.length + 1
    const range = document.createRange()
    range.setStart(node, offset - tokenLen)
    range.setEnd(node, offset)
    range.deleteContents()

    const frag = document.createDocumentFragment()
    let caretNode: Node
    let caretOffset: number
    if (item.chip) {
      const sigil = item.kind === 'mention' ? '@' : '#'
      const chip = document.createElement('span')
      chip.contentEditable = 'false'
      chip.setAttribute('data-chip', '')
      chip.setAttribute('data-sigil', sigil)
      chip.setAttribute('data-value', item.value)
      chip.className = CHIP_CLASS[item.kind === 'mention' ? 'mention' : 'context']
      chip.textContent = `${sigil}${item.value}`
      const space = document.createTextNode(' ')
      frag.appendChild(chip)
      frag.appendChild(space)
      caretNode = space
      caretOffset = 1
    } else {
      const text = document.createTextNode(`${item.value} `)
      frag.appendChild(text)
      caretNode = text
      caretOffset = text.length
    }
    range.insertNode(frag)
    placeCaretAfter(caretNode, caretOffset)
    el.focus()
    emitInput()
  }

  function insertTrigger(sigil: '@' | '#' | '/') {
    const el = elRef.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    // Ensure a leading space so the trigger starts a fresh token.
    const current = el.textContent ?? ''
    const needsSpace = current.length > 0 && !/\s$/.test(current)
    const insert = (needsSpace ? ' ' : '') + sigil
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      const node = document.createTextNode(insert)
      range.insertNode(node)
      placeCaretAfter(node, node.length)
    } else {
      el.textContent = current + insert
    }
    emitInput()
  }

  useImperativeHandle(ref, () => ({
    getText,
    clear() {
      const el = elRef.current
      if (el) {
        el.textContent = ''
        setEmpty(true)
        onTextChange?.('')
        onTriggerChange(null)
      }
    },
    focus() {
      elRef.current?.focus()
    },
    selectItem,
    insertTrigger,
  }))

  return (
    <div className="relative flex min-h-[36px] w-full items-center">
      {empty && placeholder && (
        <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-[14px] text-faint">
          {placeholder}
        </span>
      )}
      <div
        ref={elRef}
        role="textbox"
        aria-label="Message"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        onInput={emitInput}
        onKeyUp={emitInput}
        onKeyDown={onKeyDown}
        className="block max-h-[176px] w-full overflow-y-auto whitespace-pre-wrap break-words text-[14px] leading-[normal] text-ink outline-none"
      />
    </div>
  )
})
