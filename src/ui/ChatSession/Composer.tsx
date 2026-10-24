import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowUp, AtSign, Mic, Plus } from 'lucide-react'
import type { Model } from '../../core/domain/types'
import { IconButton, SquareButton } from '../ds/Button'
import { ContextRing } from '../ds/ContextRing'
import { Mascot } from '../ds/Mascot'
import { ModelMenu, ThinkingMenu } from './ModelMenu'
import type { ThinkingLevel } from './ModelMenu'

export interface ComposerProps {
  sessionId: string
  selectedModel: Model
  onModelChange: (m: Model) => void
  /** Overrides the input placeholder. Defaults to "Ask a helper, or type / for commands". */
  placeholder?: string
  /** Share of the context window in use (Context ring + %). */
  contextUsed?: number
}

/**
 * pen `Composer` (qSGtP): surface card · radius 12 · 1px line-strong ·
 * shadow 0 8 12 #0000001F · padding 10 · gap 8.
 * Rows: recipients (To · Chief · Mention agent) → input (h-44) → controls.
 */
export function Composer({
  sessionId,
  selectedModel,
  onModelChange,
  placeholder = 'Ask a helper, or type / for commands',
  contextUsed = 42,
}: ComposerProps) {
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState<ThinkingLevel>('medium')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const prevSession = useRef(sessionId)
  useEffect(() => {
    if (prevSession.current !== sessionId) {
      prevSession.current = sessionId
      setText('')
      setThinking('medium')
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
  }

  return (
    <div className="flex w-full flex-col gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[10px] shadow-[0_8px_12px_#0000001F]">
      {/* Recipients */}
      <div className="flex items-center gap-[6px]">
        <span className="text-[12px] text-faint">To</span>
        <span className="inline-flex items-center gap-[5px] rounded-pill bg-[#6366F114] py-[3px] pr-[8px] pl-[4px]">
          <Mascot size={16} radius={5} />
          <span className="text-[12px] font-medium text-[#4338CA]">Chief</span>
        </span>
        <button
          type="button"
          aria-label="Mention agent"
          className="inline-flex items-center gap-[4px] rounded-pill outline-1 -outline-offset-1 outline-line-strong px-[8px] py-[3px] transition-colors hover:bg-soft"
        >
          <AtSign size={12} aria-hidden className="text-muted" />
          <span className="text-[12px] text-muted">Mention agent</span>
        </button>
      </div>

      {/* Input */}
      <div className="flex min-h-[44px] w-full p-[4px]">
        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Message"
          className="block w-full resize-none bg-transparent text-[14px] leading-[1.25] text-ink outline-none placeholder:text-faint"
        />
      </div>

      {/* Controls */}
      <div className="flex w-full items-center gap-[8px]">
        <SquareButton icon={Plus} aria-label="Attach" />
        <div className="h-px flex-1" />
        <button
          type="button"
          aria-label={`Context ${contextUsed}% used`}
          className="inline-flex items-center gap-[5px] rounded-base px-[6px] py-[4px] transition-colors hover:bg-hover"
        >
          <ContextRing size={16} value={contextUsed} />
          <span className="font-mono text-[11px] text-muted">{contextUsed}%</span>
        </button>
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
  )
}
