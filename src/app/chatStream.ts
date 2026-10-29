/**
 * Streaming chat turns (SSE) — shared by the chat thread, the Chief drawer and
 * new chats started from /chat.
 *
 * Live mode (VITE_USE_HTTP=1): POST /v1/sessions/{id}/messages/stream and
 * report events as they arrive. Mock mode: one `commands.sendMessage` call and
 * a single `done` — the screens behave the same, just without word-by-word.
 */
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Message, MessageAuthor } from '../core/domain/types'
import { postSse } from '../adapters/http/sse'
import { platform } from '../platform'
import { useCommands } from './CommandsProvider'

export interface StreamHandlers {
  /** The owner's message, saved server-side. */
  onUser?: (message: Message) => void
  /** Who answers (shown on the live bubble). */
  onHelper?: (author: MessageAuthor) => void
  /** Reply text as it is written. */
  onText?: (delta: string) => void
  /** "Searching the web…", "Reading saga.co.id…" */
  onActivity?: (label: string) => void
  /** The saved reply (null in mock mode when the server didn't return it). */
  onDone?: (message: Message | null) => void
  /** Something went wrong; `message` is the saved error note when there is one. */
  onError?: (error: string, message?: Message | null) => void
}

export const isLiveMode = () => import.meta.env.VITE_USE_HTTP === '1'

function baseUrl(): string {
  return import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
}

/** Map the API MessageDTO onto the domain Message (same field names; defensive defaults). */
function toMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<Message> & { session_id?: string; created_at?: string }
  if (!m.id) return null
  return {
    id: m.id,
    sessionId: m.sessionId ?? m.session_id ?? '',
    author: (m.author as MessageAuthor) ?? { kind: 'helper', name: 'Chief' },
    content: m.content ?? '',
    createdAt: m.createdAt ?? m.created_at ?? new Date().toISOString(),
    ...(m.attachment ? { attachment: m.attachment } : {}),
    ...(m.actions ? { actions: m.actions } : {}),
  }
}

export function useChatStream() {
  const commands = useCommands()
  const qc = useQueryClient()

  return useCallback(
    async (sessionId: string, content: string, opts: { model?: string; signal?: AbortSignal } & StreamHandlers) => {
      const refresh = () => {
        void qc.invalidateQueries({ queryKey: ['messages', sessionId] })
        void qc.invalidateQueries({ queryKey: ['sessionResults', sessionId] })
        void qc.invalidateQueries({ queryKey: ['sessions'] })
      }
      if (!isLiveMode()) {
        try {
          await commands.sendMessage(sessionId, content, { model: opts.model })
          opts.onDone?.(null)
        } catch (e) {
          opts.onError?.(e instanceof Error ? e.message : 'Couldn’t send the message')
        }
        refresh()
        return
      }
      let finished = false
      try {
        await postSse(
          `${baseUrl()}/v1/sessions/${encodeURIComponent(sessionId)}/messages/stream`,
          { content, ...(opts.model ? { model: opts.model } : {}) },
          () => platform.tokenStorage.getToken(),
          (event, data) => {
            const d = (data ?? {}) as Record<string, unknown>
            if (event === 'user') {
              const m = toMessage(d)
              if (m) opts.onUser?.(m)
            } else if (event === 'helper') {
              opts.onHelper?.({ kind: 'helper', name: String(d.name ?? 'Chief'), area: d.area as MessageAuthor['area'] })
            } else if (event === 'text') {
              opts.onText?.(String(d.delta ?? ''))
            } else if (event === 'activity') {
              opts.onActivity?.(String(d.label ?? ''))
            } else if (event === 'done') {
              finished = true
              opts.onDone?.(toMessage(d.message))
            } else if (event === 'error') {
              finished = true
              opts.onError?.(String(d.error ?? d.message ?? 'The AI couldn’t answer'), toMessage(d.message))
            }
          },
          opts.signal,
        )
        if (!finished) opts.onError?.('The answer was cut off — it may still appear in a moment.')
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
        opts.onError?.(e instanceof Error ? e.message : 'Couldn’t reach Omilo')
      } finally {
        refresh()
      }
    },
    [commands, qc],
  )
}

// ── First message of a brand-new chat ────────────────────────────────────────
// /chat creates the session, then the thread page sends the first message so
// the owner watches it stream there.

const firstMessages = new Map<string, { text: string; model?: string }>()

export function queueFirstMessage(sessionId: string, text: string, model?: string): void {
  firstMessages.set(sessionId, { text, model })
}

export function takeFirstMessage(sessionId: string): { text: string; model?: string } | undefined {
  const v = firstMessages.get(sessionId)
  firstMessages.delete(sessionId)
  return v
}
