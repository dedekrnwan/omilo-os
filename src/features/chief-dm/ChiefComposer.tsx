import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowUp, Mic, Plus } from 'lucide-react'
import type { Model } from '../../core/domain/types'
import { IconButton, SquareButton } from '../../ui/ds/Button'
import { ContextRing } from '../../ui/ds/ContextRing'
import { DEFAULT_MODEL, ModelMenu, ThinkingMenu } from '../../ui/ChatSession/ModelMenu'
import type { ThinkingLevel } from '../../ui/ChatSession/ModelMenu'

/**
 * pen `Composer` (qSGtP) as used inside the Chief drawer: input row 32 tall,
 * placeholder 13.5. `compact` drops the context ring — at 400px the full
 * control row does not fit (in pen the Send button is clipped by the panel).
 */
export function ChiefComposer({
  placeholder,
  onSend,
  compact = false,
  value,
  onChange,
}: {
  placeholder: string
  onSend?: (text: string) => void
  compact?: boolean
  value?: string
  onChange?: (v: string) => void
}) {
  const [own, setOwn] = useState('')
  const text = value ?? own
  const setText = onChange ?? setOwn
  const [model, setModel] = useState<Model>(DEFAULT_MODEL)
  const [thinking, setThinking] = useState<ThinkingLevel>('medium')
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 24), 160)}px`
  }, [text])

  function send() {
    const t = text.trim()
    if (!t) return
    onSend?.(t)
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex w-full flex-col gap-[8px] rounded-lg bg-surface p-[10px] shadow-[0_8px_12px_#0000001F] outline-1 -outline-offset-1 outline-line-strong">
      <div className="flex min-h-[32px] w-full p-[4px]">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Message Chief"
          className="block w-full resize-none bg-transparent text-[13.5px] leading-[1.25] text-ink outline-none placeholder:text-faint"
        />
      </div>
      <div className="flex w-full items-center gap-[8px]">
        <SquareButton icon={Plus} aria-label="Attach" />
        <div className="h-px flex-1" />
        {!compact && (
          <span className="inline-flex items-center gap-[5px] rounded-base px-[6px] py-[4px]">
            <ContextRing size={16} value={42} />
            <span className="font-mono text-[11px] text-muted">42%</span>
          </span>
        )}
        <ModelMenu selected={model} onSelect={setModel} />
        <ThinkingMenu model={model} level={thinking} onSelect={setThinking} />
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
