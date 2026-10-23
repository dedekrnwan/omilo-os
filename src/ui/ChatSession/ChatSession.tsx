import { useEffect, useRef, useState } from 'react'
import type { Model } from '../../core/domain/types'
import { useMessages } from '../../app/queries'
import { MessageList } from './MessageList'
import { DEFAULT_MODEL, ModelMenu } from './ModelMenu'

interface ChatSessionProps {
  sessionId: string
}

export function ChatSession({ sessionId }: ChatSessionProps) {
  const { data: messages, isLoading } = useMessages(sessionId)

  // Model state keyed to sessionId — reset whenever sessionId changes
  const [selectedModel, setSelectedModel] = useState<Model>(DEFAULT_MODEL)
  const prevSessionId = useRef(sessionId)
  useEffect(() => {
    if (prevSessionId.current !== sessionId) {
      prevSessionId.current = sessionId
      setSelectedModel(DEFAULT_MODEL)
    }
  }, [sessionId])

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--surface)',
      }}
    >
      {/* Scrollable thread area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        {isLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--faint)',
              fontFamily: 'var(--font-sans)',
              fontSize: '14px',
            }}
          >
            Loading…
          </div>
        ) : !messages || messages.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '8px',
              padding: '40px 24px',
              color: 'var(--muted)',
              fontFamily: 'var(--font-sans)',
              fontSize: '14px',
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: '28px' }}>💬</span>
            <p style={{ margin: 0, fontWeight: 500, color: 'var(--ink-2)' }}>
              No messages yet
            </p>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              Start the conversation below.
            </p>
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
      </div>

      {/* Composer — model state lives here so it's scoped to this session */}
      <ComposerArea
        sessionId={sessionId}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />
    </div>
  )
}

// ── Composer area (composer + model toolbar, inline) ──────────────────────────

interface ComposerAreaProps {
  sessionId: string
  selectedModel: Model
  onModelChange: (m: Model) => void
}

function ComposerArea({ sessionId, selectedModel, onModelChange }: ComposerAreaProps) {
  const [text, setText] = useState('')

  // Reset text when session changes
  const prevSession = useRef(sessionId)
  useEffect(() => {
    if (prevSession.current !== sessionId) {
      prevSession.current = sessionId
      setText('')
    }
  }, [sessionId])

  return (
    <div
      style={{
        borderTop: '1px solid var(--line-strong)',
        background: 'var(--surface)',
        padding: '12px 16px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        flexShrink: 0,
      }}
    >
      {/* Affordance toolbar */}
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
        <ModelMenu selected={selectedModel} onSelect={onModelChange} />
      </div>

      {/* Input */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (text.trim()) setText('')
          }
        }}
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

      {/* Send */}
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
