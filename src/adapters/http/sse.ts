/**
 * POST + Server-Sent Events over fetch (EventSource can't POST or send a
 * Bearer header). Parses `event:` / `data:` frames as they arrive and calls
 * `onEvent(event, data)` with the JSON-decoded data.
 *
 * Used by chat turns (POST /v1/sessions/{id}/messages/stream) and the
 * onboarding interview (POST /v1/onboarding/interview/stream).
 */
import { ApiError } from './client'

export type SseHandler = (event: string, data: unknown) => void

export async function postSse(
  url: string,
  body: unknown,
  getToken: () => string | null,
  onEvent: SseHandler,
  signal?: AbortSignal,
): Promise<void> {
  const token = getToken()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
    signal,
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { detail?: unknown }
      if (typeof j?.detail === 'string') message = j.detail
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message)
  }
  if (!res.body) {
    parseFrames(await res.text(), onEvent)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let cut = buffer.indexOf('\n\n')
    while (cut !== -1) {
      parseFrames(buffer.slice(0, cut), onEvent)
      buffer = buffer.slice(cut + 2)
      cut = buffer.indexOf('\n\n')
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) parseFrames(buffer, onEvent)
}

/** Parse one or more complete SSE frames. Exported for tests. */
export function parseFrames(chunk: string, onEvent: SseHandler): void {
  for (const frame of chunk.split('\n\n')) {
    let event = 'message'
    const data: string[] = []
    for (const line of frame.split('\n')) {
      if (line.startsWith(':')) continue // comment / heartbeat
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (!data.length) continue
    const raw = data.join('\n')
    let parsed: unknown = raw
    try {
      parsed = JSON.parse(raw)
    } catch {
      // plain text data
    }
    onEvent(event, parsed)
  }
}
