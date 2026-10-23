import { useEffect, useRef, useState } from 'react'
import type { Model } from '../../core/domain/types'
import { useMessages } from '../../app/queries'
import { MessageList } from './MessageList'
import { DEFAULT_MODEL } from './ModelMenu'
import { Composer } from './Composer'

interface ChatSessionProps {
  sessionId: string
  /** Channel name to populate session-specific composer placeholder and footer */
  channelName?: string
}

export function ChatSession({ sessionId, channelName }: ChatSessionProps) {
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

      {/* Composer + footer — wrapped so footer note appears below the card */}
      <div style={{ flexShrink: 0, padding: '0 16px 12px' }}>
        <Composer
          sessionId={sessionId}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          placeholder="Reply — Chief and Dev are in this chat"
        />
        {/* Footer note — reflects channel scope */}
        <p
          style={{
            margin: '6px 0 0',
            textAlign: 'center',
            fontFamily: 'var(--font-sans)',
            fontSize: '12px',
            color: 'var(--faint)',
          }}
        >
          ◈ Agents here only read {channelName ?? 'channel'} goals, docs and chats
        </p>
      </div>
    </div>
  )
}
