import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Model } from '../../core/domain/types'
import { ModelMenu, DEFAULT_MODEL } from './ModelMenu'

interface ComposerProps {
  sessionId: string
}

export function Composer({ sessionId }: ComposerProps) {
  const [text, setText] = useState('')
  const [selectedModel, setSelectedModel] = useState<Model>(DEFAULT_MODEL)

  // Reset model when sessionId changes
  // (This is handled by the key prop on the parent instead, but we keep
  //  model state here so ModelMenu can be swapped without re-keying Composer)

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // No backend — visual affordance only
      setText('')
    }
  }

  // Suppress unused warning — sessionId will drive future send behavior
  void sessionId

  return (
    <div
      style={{
        borderTop: '1px solid var(--line-strong)',
        background: 'var(--surface)',
        padding: '12px 16px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* Affordance bar: @mention + thinking */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button
          type="button"
          aria-label="Mention a helper"
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--line-strong)',
            background: 'transparent',
            fontSize: '12px',
            color: 'var(--muted)',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          @
        </button>
        <button
          type="button"
          aria-label="Enable extended thinking"
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--line-strong)',
            background: 'transparent',
            fontSize: '12px',
            color: 'var(--muted)',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Think
        </button>
        <div style={{ flex: 1 }} />
        <ModelMenu selected={selectedModel} onSelect={setSelectedModel} />
      </div>

      {/* Text area */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message…"
        rows={3}
        style={{
          width: '100%',
          resize: 'none',
          border: '1px solid var(--line-strong)',
          borderRadius: 'var(--radius-base)',
          padding: '10px 12px',
          fontFamily: 'var(--font-sans)',
          fontSize: '14px',
          color: 'var(--ink)',
          background: 'var(--field-base)',
          outline: 'none',
          lineHeight: 1.5,
          boxSizing: 'border-box',
        }}
      />

      {/* Send row */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          disabled={!text.trim()}
          style={{
            padding: '6px 16px',
            borderRadius: 'var(--radius-btn)',
            background: text.trim() ? 'var(--primary)' : 'var(--disabled-bg)',
            color: text.trim() ? 'var(--primary-ink)' : 'var(--faint)',
            border: 'none',
            fontSize: '13px',
            fontFamily: 'var(--font-sans)',
            fontWeight: 500,
            cursor: text.trim() ? 'pointer' : 'default',
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}
