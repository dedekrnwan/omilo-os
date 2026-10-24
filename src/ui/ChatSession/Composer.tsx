import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowUp, FoldVertical, Mic, Plus } from 'lucide-react'
import type { Model } from '../../core/domain/types'
import { IconButton, SquareButton } from '../ds/Button'
import { ModelMenu, ThinkingMenu } from './ModelMenu'
import type { ThinkingLevel } from './ModelMenu'
import { ContextMenu } from './ContextMenu'
import { ComposerPicker } from './ComposerPopovers'
import type { ComposerPopoverKind } from './ComposerPopovers'
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
}

const TRIGGERS: Record<string, ComposerPopoverKind> = { '@': 'mention', '/': 'command', '#': 'context' }

/** Which picker the text before the caret is in: the last trigger char not followed by a space. */
function pickerFor(value: string): ComposerPopoverKind {
  const m = /(^|\s)([@/#])([^\s@/#]*)$/.exec(value)
  return m ? TRIGGERS[m[2]] : 'none'
}

/**
 * pen `Composer` (qSGtP): surface card · radius 12 · 1px line-strong ·
 * shadow 0 8 12 #0000001F · padding 10 · gap 8.
 * Rows: input (h-44, p-4) → controls (Add · spacer · context · model · thinking · voice · send).
 * Typing @ / # opens the matching picker above the card.
 * The "almost full" banner (gHFPG) sits above the card in the composer area.
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
}: ComposerProps) {
  const [text, setText] = useState(initialText)
  const [thinking, setThinking] = useState<ThinkingLevel>('medium')
  const [activePopover, setActivePopover] = useState<ComposerPopoverKind>(initialPopover)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const prevSession = useRef(sessionId)
  useEffect(() => {
    if (prevSession.current !== sessionId) {
      prevSession.current = sessionId
      setText('')
      setThinking('medium')
      setActivePopover('none')
    }
  }, [sessionId])

  // Grow with content: one line at rest (inside the 44px input row), up to ~8 lines.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 36), 176)}px`
  }, [text])

  function send() {
    if (text.trim()) setText('')
    setActivePopover('none')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
    if (e.key === 'Escape') setActivePopover('none')
  }

  function handleTextChange(value: string) {
    setText(value)
    setActivePopover(pickerFor(value))
  }

  function insert(trigger: string, value: string) {
    const idx = text.lastIndexOf(trigger)
    if (idx !== -1) setText(text.slice(0, idx) + value + ' ')
    setActivePopover('none')
    inputRef.current?.focus()
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
        kind={activePopover}
        onClose={() => setActivePopover('none')}
        onSelect={(kind, v) => (kind === 'mention' ? insert('@', `@${v}`) : kind === 'command' ? insert('/', v) : insert('#', `#${v}`))}
      >
            {/* Composer card */}
            <div className="flex w-full flex-col gap-[8px] rounded-lg bg-surface p-[10px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_8px_12px_#0000001F]">
              <div className="flex min-h-[44px] w-full p-[4px]">
                <textarea
                  ref={inputRef}
                  value={text}
                  rows={1}
                  onChange={(e) => handleTextChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  aria-label="Message"
                  className="block w-full resize-none bg-transparent text-[14px] leading-[normal] text-ink outline-none placeholder:text-faint"
                />
              </div>

              {/* Controls */}
              <div className="flex w-full items-center gap-[8px]">
                <SquareButton icon={Plus} aria-label="Attach" />
                <div className="h-px flex-1" />
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
                <ModelMenu selected={selectedModel} onSelect={onModelChange} defaultOpen={initialMenu === 'model'} />
                <ThinkingMenu
                  model={selectedModel}
                  level={thinking}
                  onSelect={setThinking}
                  defaultOpen={initialMenu === 'thinking'}
                />
                <IconButton icon={Mic} aria-label="Voice input" />
                <SquareButton
                  variant="primary"
                  icon={ArrowUp}
                  aria-label="Send"
                  aria-disabled={!text.trim()}
                  onClick={send}
                />
              </div>
            </div>
      </ComposerPicker>
    </div>
  )
}
