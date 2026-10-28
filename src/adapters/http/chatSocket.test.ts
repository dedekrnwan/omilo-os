/**
 * chatSocket.test.ts
 *
 * Tests for the WebSocket chat adapter (chatSocket.ts).
 * Uses a mock WebSocket class — no real network connections.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openChatSocket } from './chatSocket'
import type { Message } from '../../core/domain/types'

// ── Mock WebSocket ─────────────────────────────────────────────────────────────

class MockWebSocket {
  static instances: MockWebSocket[] = []

  readonly url: string
  readyState: number = 0 // CONNECTING

  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null

  sentFrames: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sentFrames.push(data)
  }

  close() {
    this.readyState = 3 // CLOSED
  }

  // Test helpers — simulate server events
  simulateOpen() {
    this.readyState = 1 // OPEN
    this.onopen?.(new Event('open'))
  }

  simulateMessage(data: unknown) {
    const ev = new MessageEvent('message', { data: JSON.stringify(data) })
    this.onmessage?.(ev)
  }

  simulateRawMessage(raw: string) {
    const ev = new MessageEvent('message', { data: raw })
    this.onmessage?.(ev)
  }

  simulateError() {
    const ev = new Event('error')
    this.onerror?.(ev)
  }

  simulateClose(code = 1000, reason = '') {
    this.readyState = 3
    const ev = new CloseEvent('close', { code, reason, wasClean: code === 1000 })
    this.onclose?.(ev)
  }
}

// (Instances are accessed via MockWebSocket.instances[])

// ── setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Helper to get the last created mock WS instance
function getWs(): MockWebSocket {
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
  if (!ws) throw new Error('No MockWebSocket instance created')
  return ws
}

const BASE_HTTP = 'http://localhost:8000'
const BASE_HTTPS = 'https://api.example.com'
const SESSION_ID = 'sess-abc123'
const TOKEN = 'jwt-test-token'

const getToken = () => TOKEN
const getTokenNull = () => null

// ── URL construction ──────────────────────────────────────────────────────────

describe('openChatSocket — URL construction', () => {
  it('converts http → ws scheme', () => {
    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: () => {},
      onJobDone: () => {},
    })
    const ws = getWs()
    expect(ws.url).toMatch(/^ws:\/\//)
  })

  it('converts https → wss scheme', () => {
    openChatSocket(SESSION_ID, getToken, BASE_HTTPS, {
      onMessageSaved: () => {},
      onJobDone: () => {},
    })
    const ws = getWs()
    expect(ws.url).toMatch(/^wss:\/\//)
  })

  it('appends /v1/ws/sessions/{sessionId}?token=<jwt>', () => {
    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: () => {},
      onJobDone: () => {},
    })
    const ws = getWs()
    expect(ws.url).toBe(`ws://localhost:8000/v1/ws/sessions/${SESSION_ID}?token=${TOKEN}`)
  })

  it('omits ?token when token is null', () => {
    openChatSocket(SESSION_ID, getTokenNull, BASE_HTTP, {
      onMessageSaved: () => {},
      onJobDone: () => {},
    })
    const ws = getWs()
    expect(ws.url).not.toContain('token=')
    expect(ws.url).toContain(`/v1/ws/sessions/${SESSION_ID}`)
  })
})

// ── send() ─────────────────────────────────────────────────────────────────────

describe('openChatSocket — send()', () => {
  it('emits {type:"user_message", content} JSON frame', () => {
    const socket = openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: () => {},
      onJobDone: () => {},
    })
    socket.send('Hello Chief!')
    const ws = getWs()
    expect(ws.sentFrames).toHaveLength(1)
    const parsed = JSON.parse(ws.sentFrames[0]!)
    expect(parsed).toEqual({ type: 'user_message', content: 'Hello Chief!' })
  })
})

// ── frame dispatch — in order ─────────────────────────────────────────────────

describe('openChatSocket — frame dispatch order', () => {
  it('dispatches run_event → message_saved → job_done IN ORDER', () => {
    const events: string[] = []

    const onRunEvent = vi.fn((_kind: string, _data: unknown) => {
      events.push('run_event')
    })
    const onMessageSaved = vi.fn((_message: Message) => {
      events.push('message_saved')
    })
    const onJobDone = vi.fn((_jobId: string) => {
      events.push('job_done')
    })

    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onRunEvent,
      onMessageSaved,
      onJobDone,
    })

    const ws = getWs()
    ws.simulateOpen()

    // 1. run_event
    ws.simulateMessage({ type: 'run_event', kind: 'thinking', data: { content: 'Processing...' } })
    // 2. message_saved (assistant)
    ws.simulateMessage({
      type: 'message_saved',
      message: {
        id: 'msg-1',
        sessionId: SESSION_ID,
        author: { kind: 'helper', name: 'Chief', role: 'Chief of Staff', area: 'brand' },
        content: 'Here is my response.',
        createdAt: '2026-10-28T10:00:00Z',
      },
    })
    // 3. job_done
    ws.simulateMessage({ type: 'job_done', job_id: 'job-xyz' })

    expect(events).toEqual(['run_event', 'message_saved', 'job_done'])
    expect(onRunEvent).toHaveBeenCalledWith('thinking', { content: 'Processing...' })
    expect(onJobDone).toHaveBeenCalledWith('job-xyz')
  })

  it('dispatches user message_saved (echo) the same way', () => {
    const savedMessages: Message[] = []
    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: (m) => savedMessages.push(m),
      onJobDone: () => {},
    })
    const ws = getWs()
    ws.simulateOpen()

    ws.simulateMessage({
      type: 'message_saved',
      message: {
        id: 'msg-user-1',
        sessionId: SESSION_ID,
        author: { kind: 'you', name: 'You' },
        content: 'Hello',
        createdAt: '2026-10-28T09:59:00Z',
      },
    })
    expect(savedMessages).toHaveLength(1)
    expect(savedMessages[0]!.author.kind).toBe('you')
  })

  it('handles job_failed by calling onJobFailed', () => {
    const onJobFailed = vi.fn()
    const onJobDone = vi.fn()

    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: () => {},
      onJobDone,
      onJobFailed,
    })

    const ws = getWs()
    ws.simulateOpen()
    ws.simulateMessage({ type: 'job_failed', job_id: 'job-failed-99' })

    expect(onJobFailed).toHaveBeenCalledWith('job-failed-99')
    expect(onJobDone).not.toHaveBeenCalled()
  })

  it('falls back to onJobDone when onJobFailed is not provided', () => {
    const onJobDone = vi.fn()

    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: () => {},
      onJobDone,
    })

    const ws = getWs()
    ws.simulateOpen()
    ws.simulateMessage({ type: 'job_failed', job_id: 'job-no-handler' })

    expect(onJobDone).toHaveBeenCalledWith('job-no-handler')
  })
})

// ── message_saved maps DTO → domain Message ───────────────────────────────────

describe('openChatSocket — message_saved DTO mapping', () => {
  it('maps a camelCase DTO from the server into a domain Message', () => {
    const saved: Message[] = []

    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: (m) => saved.push(m),
      onJobDone: () => {},
    })

    const ws = getWs()
    ws.simulateOpen()

    const dto = {
      id: 'msg-mapped',
      sessionId: SESSION_ID,
      author: { kind: 'helper', name: 'Chief', role: 'Chief of Staff', area: 'brand' },
      content: 'Mapped response.',
      createdAt: '2026-10-28T11:00:00Z',
    }
    ws.simulateMessage({ type: 'message_saved', message: dto })

    expect(saved).toHaveLength(1)
    const m = saved[0]!
    expect(m.id).toBe('msg-mapped')
    expect(m.sessionId).toBe(SESSION_ID)
    expect(m.author).toEqual({ kind: 'helper', name: 'Chief', role: 'Chief of Staff', area: 'brand' })
    expect(m.content).toBe('Mapped response.')
    expect(m.createdAt).toBe('2026-10-28T11:00:00Z')
  })
})

// ── malformed frame safety ─────────────────────────────────────────────────────

describe('openChatSocket — malformed frame safety', () => {
  it('does NOT throw when a frame is invalid JSON', () => {
    const onError = vi.fn()

    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: () => {},
      onJobDone: () => {},
      onError,
    })

    const ws = getWs()
    ws.simulateOpen()

    // Should not throw — onmessage catches internally
    expect(() => ws.simulateRawMessage('not json {{')).not.toThrow()
    // onError is NOT called for malformed frames — those are silently ignored
  })

  it('does NOT throw when a known-type frame has unexpected data shape', () => {
    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: () => {},
      onJobDone: () => {},
    })

    const ws = getWs()
    ws.simulateOpen()

    // message_saved with no message field — should not crash
    expect(() => ws.simulateMessage({ type: 'message_saved' })).not.toThrow()
  })

  it('silently ignores unknown frame types', () => {
    const onRunEvent = vi.fn()
    const onMessageSaved = vi.fn()
    const onJobDone = vi.fn()

    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onRunEvent,
      onMessageSaved,
      onJobDone,
    })

    const ws = getWs()
    ws.simulateOpen()
    expect(() => ws.simulateMessage({ type: 'unknown_future_type', foo: 'bar' })).not.toThrow()

    expect(onRunEvent).not.toHaveBeenCalled()
    expect(onMessageSaved).not.toHaveBeenCalled()
    expect(onJobDone).not.toHaveBeenCalled()
  })
})

// ── error and close handlers ──────────────────────────────────────────────────

describe('openChatSocket — onerror / onclose', () => {
  it('calls onError when the WebSocket fires an error event', () => {
    const onError = vi.fn()

    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: () => {},
      onJobDone: () => {},
      onError,
    })

    const ws = getWs()
    ws.simulateError()

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Event)
  })

  it('calls onClose when the WebSocket closes normally (1000)', () => {
    const onClose = vi.fn()

    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: () => {},
      onJobDone: () => {},
      onClose,
    })

    const ws = getWs()
    ws.simulateClose(1000, 'Done')

    expect(onClose).toHaveBeenCalledOnce()
    const ev = onClose.mock.calls[0]![0] as CloseEvent
    expect(ev.code).toBe(1000)
  })

  it('calls onClose with code 4401 on auth failure', () => {
    const onClose = vi.fn()

    openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: () => {},
      onJobDone: () => {},
      onClose,
    })

    const ws = getWs()
    ws.simulateClose(4401, 'Unauthorized')

    expect(onClose).toHaveBeenCalledOnce()
    const ev = onClose.mock.calls[0]![0] as CloseEvent
    expect(ev.code).toBe(4401)
  })
})

// ── close() ───────────────────────────────────────────────────────────────────

describe('openChatSocket — close()', () => {
  it('closes the underlying WebSocket when close() is called', () => {
    const socket = openChatSocket(SESSION_ID, getToken, BASE_HTTP, {
      onMessageSaved: () => {},
      onJobDone: () => {},
    })

    const ws = getWs()
    socket.close()
    expect(ws.readyState).toBe(3)
  })
})
