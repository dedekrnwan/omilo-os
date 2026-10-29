/**
 * chatSocket.ts
 *
 * WebSocket adapter for the omilo-v2 live chat turn protocol.
 *
 * Backend route: WS /v1/ws/sessions/{session_id}?token=<jwt>
 * Authentication: query-param token (NOT a header — browsers cannot set WS headers).
 * Close code 4401 = auth failure (bad / missing / expired token, or no membership).
 *
 * Frame sequence per turn (client sends first):
 *   client → { type: "user_message", content: "..." }
 *   server → { type: "run_event",    kind: "...", data: {...} }  (one or more)
 *   server → { type: "message_saved", message: <MessageDTO> }
 *   server → { type: "job_done",     job_id: "..." }
 *            OR { type: "job_failed", job_id: "..." }
 *
 * There may also be an operator message_saved (user echo) — handled identically.
 */

import type { Message } from '../../core/domain/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatSocketHandlers {
  /** Called for each run_event frame (streaming progress, tool calls, etc.). */
  onRunEvent?: (kind: string, data: unknown) => void
  /**
   * Called when a message_saved frame is received (both assistant and user echoes).
   * The DTO from the server mirrors the shape returned by GET /v1/sessions/{id}/messages.
   */
  onMessageSaved: (message: Message) => void
  /** Called when the turn completes successfully. */
  onJobDone: (jobId: string) => void
  /**
   * Called when the turn fails.  Falls back to onJobDone when absent —
   * the turn still persists server-side either way.
   */
  onJobFailed?: (jobId: string) => void
  /** Called when the WebSocket itself fires an error event. */
  onError?: (ev: Event) => void
  /**
   * Called when the WebSocket closes.  Inspect ev.code for the reason:
   *   1000 = clean close
   *   4401 = auth failure (bad/missing/expired token or no membership)
   */
  onClose?: (ev: CloseEvent) => void
}

export interface ChatSocket {
  /** Send a user message — emits {type:"user_message", content} to the server. */
  send(content: string, opts?: { model?: string }): void
  /** Close the underlying WebSocket. */
  close(): void
}

// ── URL builder ───────────────────────────────────────────────────────────────

function buildWsUrl(baseUrl: string, sessionId: string, token: string | null): string {
  // Replace http(s) → ws(s) for the WebSocket scheme.
  const wsBase = baseUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://')
  const path = `${wsBase}/v1/ws/sessions/${sessionId}`
  if (token) {
    return `${path}?token=${encodeURIComponent(token)}`
  }
  return path
}

// ── Message DTO mapper ────────────────────────────────────────────────────────
//
// The server sends the same camelCase shape as GET /v1/sessions/{id}/messages,
// so the DTO is structurally identical to the domain Message type.  We do a
// best-effort cast with a safety fallback to avoid crashing on incomplete DTOs.

type RawMessageDto = {
  id?: string
  sessionId?: string
  author?: {
    kind?: string
    name?: string
    role?: string
    area?: string
  }
  content?: string
  createdAt?: string
  system?: boolean
  attachment?: { title: string; meta: string }
  actions?: { label: string; primary?: boolean }[]
}

function mapMessageDto(dto: RawMessageDto): Message | null {
  if (!dto.id || !dto.author || typeof dto.content !== 'string') {
    return null
  }
  return {
    id: dto.id,
    sessionId: dto.sessionId ?? '',
    author: {
      kind: (dto.author.kind ?? 'helper') as 'you' | 'helper',
      name: dto.author.name ?? '',
      role: dto.author.role,
      area: dto.author.area as Message['author']['area'],
    },
    content: dto.content,
    createdAt: dto.createdAt ?? new Date().toISOString(),
    system: dto.system,
    attachment: dto.attachment,
    actions: dto.actions,
  }
}

// ── openChatSocket ─────────────────────────────────────────────────────────────

/**
 * Opens a WebSocket to the omilo-v2 real-time chat endpoint and returns a
 * handle to send messages and close the connection.
 *
 * @param sessionId  - The session to connect to.
 * @param getToken   - Returns the current JWT (called once at open time).
 * @param baseUrl    - e.g. "http://localhost:8000" (converted to ws(s)://).
 * @param handlers   - Callbacks for the various frame types.
 */
export function openChatSocket(
  sessionId: string,
  getToken: () => string | null,
  baseUrl: string,
  handlers: ChatSocketHandlers,
): ChatSocket {
  const token = getToken()
  const url = buildWsUrl(baseUrl, sessionId, token)

  const ws = new WebSocket(url)

  ws.onmessage = (ev: MessageEvent) => {
    try {
      const frame = JSON.parse(ev.data as string) as Record<string, unknown>
      const type = frame.type

      switch (type) {
        case 'run_event': {
          handlers.onRunEvent?.(
            (frame.kind as string) ?? '',
            frame.data,
          )
          break
        }
        case 'message_saved': {
          const dto = frame.message as RawMessageDto | undefined
          if (dto) {
            const message = mapMessageDto(dto)
            if (message) {
              handlers.onMessageSaved(message)
            }
          }
          break
        }
        case 'job_done': {
          handlers.onJobDone((frame.job_id as string) ?? '')
          break
        }
        case 'job_failed': {
          const jobId = (frame.job_id as string) ?? ''
          if (handlers.onJobFailed) {
            handlers.onJobFailed(jobId)
          } else {
            // Fall back to onJobDone — the turn still persisted server-side.
            handlers.onJobDone(jobId)
          }
          break
        }
        default:
          // Unknown / future frame type — ignore silently.
          break
      }
    } catch {
      // Malformed (non-JSON) frame — ignore silently, do NOT crash.
    }
  }

  ws.onerror = (ev: Event) => {
    handlers.onError?.(ev)
  }

  ws.onclose = (ev: CloseEvent) => {
    handlers.onClose?.(ev)
  }

  return {
    send(content: string, opts?: { model?: string }) {
      ws.send(JSON.stringify({ type: 'user_message', content, ...(opts?.model ? { model: opts.model } : {}) }))
    },
    close() {
      ws.close()
    },
  }
}
