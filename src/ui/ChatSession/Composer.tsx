import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Model } from '../../core/domain/types'
import { ModelMenu } from './ModelMenu'
import { helperColor } from '../tokens'

export interface ComposerProps {
  sessionId: string
  selectedModel: Model
  onModelChange: (m: Model) => void
  /** Overrides the textarea placeholder. Defaults to "Ask a helper, or type / for commands". */
  placeholder?: string
}

export function Composer({ sessionId, selectedModel, onModelChange, placeholder }: ComposerProps) {
  const [text, setText] = useState('')

  // Reset text when session changes
  const prevSession = useRef(sessionId)
  useEffect(() => {
    if (prevSession.current !== sessionId) {
      prevSession.current = sessionId
      setText('')
    }
  }, [sessionId])

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.trim()) setText('')
    }
  }

  const resolvedPlaceholder = placeholder ?? 'Ask a helper, or type / for commands'

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line-strong)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        overflow: 'hidden',
      }}
    >
      {/* Top row — assignee + mention */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px 6px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: 'var(--muted)',
            fontFamily: 'var(--font-sans)',
            marginRight: 2,
          }}
        >
          To
        </span>

        {/* Chief chip */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            background: helperColor.brand + '18',
            border: `1px solid ${helperColor.brand}40`,
            fontSize: 12,
            fontFamily: 'var(--font-sans)',
            fontWeight: 500,
            color: helperColor.brand,
          }}
        >
          <span aria-hidden style={{ fontSize: 13 }}>⚡</span>
          Chief
        </span>

        {/* Mention affordance */}
        <button
          type="button"
          aria-label="Mention agent"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--line-strong)',
            background: 'transparent',
            fontSize: 12,
            color: 'var(--muted)',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <span aria-hidden>@</span>
          Mention agent
        </button>
      </div>

      {/* Textarea */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={resolvedPlaceholder}
        rows={3}
        style={{
          display: 'block',
          width: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          padding: '12px 14px 8px',
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          color: 'var(--ink)',
          background: 'transparent',
          lineHeight: 1.5,
          boxSizing: 'border-box',
        }}
      />

      {/* Bottom control row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px 10px',
        }}
      >
        {/* + attach button */}
        <button
          type="button"
          aria-label="Attach"
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-base)',
            border: '1px solid var(--line-strong)',
            background: 'transparent',
            fontSize: 16,
            color: 'var(--muted)',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          +
        </button>

        {/* Thinking control — crescent + token count */}
        <button
          type="button"
          aria-label="Extended thinking"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--line-strong)',
            background: 'transparent',
            fontSize: 12,
            color: 'var(--muted)',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            flexShrink: 0,
          }}
        >
          <span aria-hidden style={{ fontSize: 13 }}>☽</span>
          <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>429</span>
        </button>

        {/* Model menu */}
        <ModelMenu selected={selectedModel} onSelect={onModelChange} />

        {/* Effort menu */}
        <button
          type="button"
          aria-label="Effort level"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            borderRadius: 'var(--radius-btn)',
            border: '1px solid var(--line-strong)',
            background: 'transparent',
            fontSize: 12,
            color: 'var(--ink-2)',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            flexShrink: 0,
          }}
        >
          <span aria-hidden style={{ fontSize: 11 }}>◈</span>
          Medium
          <span aria-hidden style={{ fontSize: 10, color: 'var(--faint)' }}>▾</span>
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Mic button */}
        <button
          type="button"
          aria-label="Voice input"
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-base)',
            border: '1px solid var(--line-strong)',
            background: 'transparent',
            fontSize: 14,
            color: 'var(--muted)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          🎙
        </button>

        {/* Send button */}
        <button
          type="button"
          aria-label="Send"
          disabled={!text.trim()}
          onClick={() => { if (text.trim()) setText('') }}
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            background: text.trim() ? 'var(--primary)' : 'var(--disabled-bg)',
            color: 'var(--primary-ink)',
            cursor: text.trim() ? 'pointer' : 'default',
            fontSize: 16,
            flexShrink: 0,
            transition: 'background 120ms ease',
          }}
        >
          ↑
        </button>
      </div>
    </div>
  )
}
