import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowUp, AtSign, Mic, Plus, TriangleAlert, Zap } from 'lucide-react'
import type { Model } from '../../core/domain/types'
import { IconButton, SquareButton } from '../ds/Button'
import { ContextRing } from '../ds/ContextRing'
import { Mascot } from '../ds/Mascot'
import { ModelMenu, ThinkingMenu } from './ModelMenu'
import type { ThinkingLevel } from './ModelMenu'
import { ContextMenu } from './ContextMenu'
import { MentionPopover, CommandPopover, ContextPickerPopover } from './ComposerPopovers'
import type { ComposerPopoverKind } from './ComposerPopovers'

export interface ComposerProps {
  sessionId: string
  selectedModel: Model
  onModelChange: (m: Model) => void
  /** Overrides the input placeholder. Defaults to "Ask a helper, or type / for commands". */
  placeholder?: string
  /**
   * Show the "To · Chief · Mention agent" recipient row. True for a new chat
   * (pen gTI4y), false for a reply inside an existing session (pen b3vqC5) where
   * participants are already established.
   */
  showRecipients?: boolean
  /** Share of the context window in use (Context ring + %). 0-100. */
  contextUsed?: number
  /** Whether the context is almost full (≥85%). Shows a warning banner. */
  contextAlmostFull?: boolean
  /** Whether this chat has been compacted. Shows a compacted system line. */
  isCompacted?: boolean
  onAutoCompactToggle?: () => void
  autoCompact?: boolean
  onCompactNow?: () => void
}

/**
 * pen `Composer` (qSGtP): surface card · radius 12 · 1px line-strong ·
 * shadow 0 8 12 #0000001F · padding 10 · gap 8.
 * Rows: recipients (To · Chief · Mention agent) → input (h-44) → controls.
 *
 * Also renders:
 * - Context almost full banner (gHFPG) when contextAlmostFull
 * - @mention / /command / #context popovers on typing trigger chars
 */
export function Composer({
  sessionId,
  selectedModel,
  onModelChange,
  placeholder = 'Ask a helper, or type / for commands',
  showRecipients = true,
  contextUsed = 42,
  contextAlmostFull = false,
  isCompacted = false,
  onAutoCompactToggle,
  autoCompact = true,
  onCompactNow,
}: ComposerProps) {
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState<ThinkingLevel>('medium')
  const [activePopover, setActivePopover] = useState<ComposerPopoverKind>('none')
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
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
    if (e.key === 'Escape') {
      setActivePopover('none')
    }
  }

  function handleTextChange(value: string) {
    setText(value)
    // Detect trigger characters to open popovers
    const last = value.slice(-1)
    if (last === '@') {
      setActivePopover('mention')
    } else if (last === '/') {
      setActivePopover('command')
    } else if (last === '#') {
      setActivePopover('context')
    } else if (activePopover !== 'none') {
      // Keep popover open while typing after the trigger char
      // Close only when the user clears the trigger or presses Escape
      const triggers: Record<ComposerPopoverKind, string> = {
        mention: '@',
        command: '/',
        context: '#',
        none: '',
      }
      const trigger = triggers[activePopover]
      if (trigger && !value.includes(trigger)) {
        setActivePopover('none')
      }
    }
  }

  function closePopover() {
    setActivePopover('none')
  }

  function insertMention(name: string) {
    // Replace trailing @... with @Name
    const idx = text.lastIndexOf('@')
    if (idx !== -1) {
      setText(text.slice(0, idx) + `@${name} `)
    }
    setActivePopover('none')
    inputRef.current?.focus()
  }

  function insertCommand(cmd: string) {
    const idx = text.lastIndexOf('/')
    if (idx !== -1) {
      setText(text.slice(0, idx) + cmd + ' ')
    }
    setActivePopover('none')
    inputRef.current?.focus()
  }

  function insertContext(label: string) {
    const idx = text.lastIndexOf('#')
    if (idx !== -1) {
      setText(text.slice(0, idx) + `#${label} `)
    }
    setActivePopover('none')
    inputRef.current?.focus()
  }

  // Context warning styling
  const contextWarn = contextAlmostFull || contextUsed >= 85
  const contextPct = contextUsed

  return (
    <div className="flex w-full flex-col gap-[8px]">
      {/* Compacted system indicator (GNF2E) */}
      {isCompacted && (
        <div
          role="note"
          aria-label="Context compacted"
          className="flex items-center justify-center gap-[6px] rounded-base bg-soft px-[12px] py-[7px] outline-1 -outline-offset-1 outline-line-strong"
        >
          <Zap size={12} aria-hidden className="text-muted" />
          <span className="text-[12px] text-muted">
            Context compacted · 39 messages summarised · 94k → 30×
          </span>
          <button
            type="button"
            className="ml-auto text-[11.5px] text-link hover:underline"
          >
            View full history
          </button>
        </div>
      )}

      {/* Context almost full banner (gHFPG) */}
      {contextWarn && (
        <div
          role="alert"
          className="flex items-center gap-[8px] rounded-base bg-warn-tint px-[12px] py-[8px] outline-1 -outline-offset-1 outline-warn-line"
        >
          <TriangleAlert size={14} aria-hidden className="shrink-0 text-warn" />
          <span className="flex-1 text-[12.5px] text-warn">
            This chat is {contextPct}% full. Chief will summarise older messages at the next reply.
          </span>
          <button
            type="button"
            className="shrink-0 text-[12px] font-medium text-warn hover:underline"
          >
            Turn off auto
          </button>
          <button
            type="button"
            onClick={onCompactNow}
            className="shrink-0 inline-flex items-center gap-[4px] rounded-btn bg-warn-tint px-[8px] py-[4px] text-[12px] font-medium text-warn outline-1 -outline-offset-1 outline-warn-line transition-colors hover:bg-warn-line"
          >
            <Zap size={11} aria-hidden />
            Compact now
          </button>
        </div>
      )}

      {/* Composer card */}
      {/* Wrap the textarea in a Popover.Anchor via the popover components below */}
      <div className="flex w-full flex-col gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[10px] shadow-[0_8px_12px_#0000001F]">
        {/* Recipients — only for a new chat; a session reply omits this row (pen b3vqC5) */}
        {showRecipients && (
          <div className="flex items-center gap-[6px]">
            <span className="text-[12px] text-faint">To</span>
            <span className="inline-flex items-center gap-[5px] rounded-pill bg-[#6366F114] py-[3px] pr-[8px] pl-[4px]">
              <Mascot size={16} radius={5} />
              <span className="text-[12px] font-medium text-[#4338CA]">Chief</span>
            </span>
            {/* Mention agent button — triggers the @mention popover anchored to the input */}
            <button
              type="button"
              aria-label="Mention agent"
              onClick={() => setActivePopover(activePopover === 'mention' ? 'none' : 'mention')}
              className="inline-flex items-center gap-[4px] rounded-pill outline-1 -outline-offset-1 outline-line-strong px-[8px] py-[3px] transition-colors hover:bg-soft"
            >
              <AtSign size={12} aria-hidden className="text-muted" />
              <span className="text-[12px] text-muted">Mention agent</span>
            </button>
          </div>
        )}

        {/* Input — wrap in Popover anchors for mention + command + context */}
        <MentionPopover
          open={activePopover === 'mention'}
          onOpenChange={(open) => !open && closePopover()}
          onSelect={insertMention}
        >
          <CommandPopover
            open={activePopover === 'command'}
            onOpenChange={(open) => !open && closePopover()}
            onSelect={insertCommand}
          >
            <ContextPickerPopover
              open={activePopover === 'context'}
              onOpenChange={(open) => !open && closePopover()}
              onSelect={insertContext}
            >
              <div className="flex min-h-[44px] w-full p-[4px]">
                <textarea
                  ref={inputRef}
                  value={text}
                  rows={1}
                  onChange={(e) => handleTextChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  aria-label="Message"
                  className="block w-full resize-none bg-transparent text-[14px] leading-[1.25] text-ink outline-none placeholder:text-faint"
                />
              </div>
            </ContextPickerPopover>
          </CommandPopover>
        </MentionPopover>

        {/* Controls */}
        <div className="flex w-full items-center gap-[8px]">
          <SquareButton icon={Plus} aria-label="Attach" />
          <div className="h-px flex-1" />
          {/* Context button with menu (C9Glat) */}
          <ContextMenu
            contextUsed={contextUsed}
            onAutoCompactToggle={onAutoCompactToggle}
            autoCompact={autoCompact}
            onCompactNow={onCompactNow}
          >
            <button
              type="button"
              aria-label={`Context ${contextPct}% used`}
              className={`inline-flex items-center gap-[5px] rounded-base px-[6px] py-[4px] transition-colors hover:bg-hover ${contextWarn ? 'text-warn' : ''}`}
            >
              <ContextRing size={16} value={contextPct} />
              <span className={`font-mono text-[11px] ${contextWarn ? 'text-warn font-semibold' : 'text-muted'}`}>
                {contextPct}%
              </span>
            </button>
          </ContextMenu>
          <ModelMenu selected={selectedModel} onSelect={onModelChange} />
          <ThinkingMenu model={selectedModel} level={thinking} onSelect={setThinking} />
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
    </div>
  )
}
