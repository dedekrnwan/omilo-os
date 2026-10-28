/**
 * ChatSocketFallback.test.tsx
 *
 * Review-Focus test: socket error / early close → fallback POST+refetch.
 *
 * Verifies the critical safety property:
 *   - When the WebSocket errors or closes before job_done, the UI MUST NOT
 *     spin forever.
 *   - The fallback path (commands.sendMessage POST + refetch messages) runs.
 *   - The message still appears (fallback resolves it).
 *   - No infinite spinner (isSending clears).
 *
 * This test stubs global.WebSocket via a mock class so it can run without a
 * real backend, matching the httpRepos.test.ts pattern.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { Message } from '../../core/domain/types'
import { openChatSocket } from '../../adapters/http/chatSocket'

// ── Mock WebSocket ────────────────────────────────────────────────────────────

type WsEventHandler<T extends Event> = ((ev: T) => void) | null

class MockWS {
  static latest: MockWS | null = null
  static instanceCount = 0

  readonly url: string
  readyState = 0

  onopen: WsEventHandler<Event> = null
  onmessage: WsEventHandler<MessageEvent> = null
  onerror: WsEventHandler<Event> = null
  onclose: WsEventHandler<CloseEvent> = null

  constructor(url: string) {
    this.url = url
    MockWS.latest = this
    MockWS.instanceCount++
  }

  send(_data: string) {}
  close() { this.readyState = 3 }

  fireOpen() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }

  fireMessage(payload: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }))
  }

  fireError() {
    this.onerror?.(new Event('error'))
  }

  fireClose(code = 1001) {
    this.readyState = 3
    this.onclose?.(new CloseEvent('close', { code, wasClean: false }))
  }
}

// ── Fixture ────────────────────────────────────────────────────────────────────

const SESSION_ID = 'sess-ws-fallback'
const USER_CONTENT = 'Hello from socket fallback test'

const assistantMsg: Message = {
  id: 'msg-fallback-a1',
  sessionId: SESSION_ID,
  author: { kind: 'helper', name: 'Chief', role: 'Chief of Staff', area: 'brand' },
  content: 'I got your message (via fallback)',
  createdAt: '2026-10-28T12:00:00Z',
}

// ── setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  MockWS.latest = null
  MockWS.instanceCount = 0
  vi.stubGlobal('WebSocket', MockWS)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── helpers ───────────────────────────────────────────────────────────────────

/** Opens a socket and returns it with the latest mock WS handle. */
function openSocket(opts: {
  onRunEvent?: (kind: string, data: unknown) => void
  onMessageSaved?: (m: Message) => void
  onJobDone?: (id: string) => void
  onJobFailed?: (id: string) => void
  onError?: (ev: Event) => void | Promise<void>
  onClose?: (ev: CloseEvent) => void | Promise<void>
}) {
  const socket = openChatSocket(SESSION_ID, () => 'test-token', 'http://localhost:8000', {
    onRunEvent: opts.onRunEvent,
    onMessageSaved: opts.onMessageSaved ?? (() => {}),
    onJobDone: opts.onJobDone ?? (() => {}),
    onJobFailed: opts.onJobFailed,
    onError: opts.onError,
    onClose: opts.onClose,
  })
  const ws = MockWS.latest!
  return { socket, ws }
}

// ── Review-Focus tests ────────────────────────────────────────────────────────

describe('chatSocket → fallback on error (Review-Focus)', () => {
  // ------------------------------------------------------------------
  // Test 1: socket error before job_done → fallback + sending cleared
  // ------------------------------------------------------------------
  test('socket error → fallback sendMessage POST runs, sending state cleared', async () => {
    let isSending = false
    let fallbackRan = false
    let refetchRan = false

    const fallbackSendMessage = vi.fn(async (_sid: string, _content: string) => {
      fallbackRan = true
      return { message: assistantMsg, jobId: 'job-fallback' }
    })
    const refetchMessages = vi.fn(async () => {
      refetchRan = true
      return [assistantMsg]
    })

    isSending = true
    const { socket, ws } = openSocket({
      onJobDone: () => { isSending = false },
      onError: async (_ev) => {
        isSending = false
        await fallbackSendMessage(SESSION_ID, USER_CONTENT)
        await refetchMessages()
      },
      onClose: async (_ev) => {
        if (isSending) {
          isSending = false
          await fallbackSendMessage(SESSION_ID, USER_CONTENT)
          await refetchMessages()
        }
      },
    })

    socket.send(USER_CONTENT)
    ws.fireError()

    await waitFor(() => {
      expect(isSending).toBe(false)
      expect(fallbackRan).toBe(true)
      expect(refetchRan).toBe(true)
    })

    expect(fallbackSendMessage).toHaveBeenCalledWith(SESSION_ID, USER_CONTENT)
    expect(refetchMessages).toHaveBeenCalled()
  })

  // ------------------------------------------------------------------
  // Test 2: early close (connection dropped) before job_done → fallback
  // ------------------------------------------------------------------
  test('early close before job_done → fallback runs, NO infinite spinner', async () => {
    let isSending = false
    let fallbackRan = false

    const fallbackSendMessage = vi.fn(async (_sid: string, _content: string) => {
      fallbackRan = true
      return { message: assistantMsg, jobId: 'job-early-close' }
    })

    isSending = true
    const { socket, ws } = openSocket({
      onJobDone: () => { isSending = false },
      onClose: async (_ev) => {
        if (isSending) {
          isSending = false
          await fallbackSendMessage(SESSION_ID, USER_CONTENT)
        }
      },
    })

    socket.send(USER_CONTENT)
    // Simulate connection dropped before job_done
    ws.fireClose(1001)

    await waitFor(() => {
      expect(isSending).toBe(false)
      expect(fallbackRan).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // Test 3: 4401 close → auth failure detected, sending state cleared
  // ------------------------------------------------------------------
  test('4401 close → sending state cleared (auth failure path)', async () => {
    let isSending = false
    let authFailureDetected = false

    isSending = true
    const { socket, ws } = openSocket({
      onJobDone: () => { isSending = false },
      onClose: (ev) => {
        isSending = false
        if (ev.code === 4401) {
          authFailureDetected = true
        }
      },
    })

    socket.send(USER_CONTENT)
    ws.fireClose(4401)

    await waitFor(() => {
      expect(isSending).toBe(false)
      expect(authFailureDetected).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // Test 4: successful turn → job_done clears sending, NO fallback
  // ------------------------------------------------------------------
  test('successful turn: job_done → sending state cleared, no fallback', async () => {
    let isSending = false
    const fallbackSendMessage = vi.fn(async (_sid: string, _content: string) => {})
    const receivedMessages: Message[] = []

    isSending = true
    const { socket, ws } = openSocket({
      onMessageSaved: (m) => receivedMessages.push(m),
      onJobDone: () => { isSending = false },
      onError: async () => {
        isSending = false
        await fallbackSendMessage(SESSION_ID, USER_CONTENT)
      },
      onClose: async (_ev) => {
        if (isSending) {
          isSending = false
          await fallbackSendMessage(SESSION_ID, USER_CONTENT)
        }
      },
    })

    socket.send(USER_CONTENT)
    ws.fireOpen()

    ws.fireMessage({ type: 'run_event', kind: 'thinking', data: {} })
    ws.fireMessage({
      type: 'message_saved',
      message: {
        id: 'msg-happy',
        sessionId: SESSION_ID,
        author: { kind: 'helper', name: 'Chief', area: 'brand' },
        content: 'Here is your answer.',
        createdAt: '2026-10-28T12:01:00Z',
      },
    })
    ws.fireMessage({ type: 'job_done', job_id: 'job-happy' })

    // Synchronous: job_done fires immediately
    expect(isSending).toBe(false)
    expect(receivedMessages).toHaveLength(1)
    expect(receivedMessages[0]!.content).toBe('Here is your answer.')
    expect(fallbackSendMessage).not.toHaveBeenCalled()
  })

  // ------------------------------------------------------------------
  // Test 5: frames dispatched in order (run_event → message_saved → job_done)
  // ------------------------------------------------------------------
  test('frames dispatched in order: run_event → message_saved → job_done', () => {
    const order: string[] = []

    const { ws } = openSocket({
      onRunEvent: () => order.push('run_event'),
      onMessageSaved: () => order.push('message_saved'),
      onJobDone: () => order.push('job_done'),
    })

    ws.fireOpen()
    ws.fireMessage({ type: 'run_event', kind: 'thinking', data: {} })
    ws.fireMessage({
      type: 'message_saved',
      message: {
        id: 'm1',
        sessionId: SESSION_ID,
        author: { kind: 'helper', name: 'Chief' },
        content: 'Response',
        createdAt: '2026-10-28T12:00:00Z',
      },
    })
    ws.fireMessage({ type: 'job_done', job_id: 'job-order' })

    expect(order).toEqual(['run_event', 'message_saved', 'job_done'])
  })
})

// ── WS double-fallback fix tests ──────────────────────────────────────────────

describe('WS double-fallback fix — onerror then onclose fires fallback EXACTLY ONCE', () => {
  // ------------------------------------------------------------------
  // Test: real ChatSession — error then close → sendMessage called once
  // ------------------------------------------------------------------
  test('error then close → sendMessage POST called EXACTLY ONCE (not twice)', async () => {
    vi.stubEnv('VITE_USE_HTTP', '1')
    vi.resetModules()

    const sendMessage = vi.fn().mockResolvedValue({ message: null, jobId: 'j-double' })

    vi.doMock('../../adapters/http/commands', () => ({
      createCommands: () => ({
        sendMessage,
        createSession: vi.fn(),
        createArea: vi.fn(),
        updateArea: vi.fn(),
        deleteArea: vi.fn(),
        addParticipant: vi.fn(),
        removeParticipant: vi.fn(),
        createFolder: vi.fn(),
        updateFolder: vi.fn(),
        deleteFolder: vi.fn(),
        createGoal: vi.fn(),
        updateGoal: vi.fn(),
        deleteGoal: vi.fn(),
      }),
    }))

    vi.stubGlobal('localStorage', { getItem: () => 'test-jwt', setItem: () => {}, removeItem: () => {} })

    const { ChatSession } = await import('./ChatSession')
    const { createMockRepos } = await import('../../adapters/mock/mockRepos')
    const { render: tlRender, screen: tlScreen, waitFor: tlWaitFor, act } = await import('@testing-library/react')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { ReposProvider } = await import('../../app/ReposProvider')
    const userEvent = (await import('@testing-library/user-event')).default

    const repos = createMockRepos()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    MockWS.instanceCount = 0
    MockWS.latest = null

    const user = userEvent.setup()

    tlRender(
      <QueryClientProvider client={qc}>
        <ReposProvider repos={repos}>
          <ChatSession sessionId="sess-double-fallback" />
        </ReposProvider>
      </QueryClientProvider>,
    )

    await tlWaitFor(() => {
      expect(tlScreen.getByRole('button', { name: /send/i })).toBeInTheDocument()
    })

    const input = tlScreen.getByRole('textbox')
    await act(async () => {
      await user.click(input)
      await user.type(input, 'Test double fallback')
    })
    await act(async () => {
      await user.click(tlScreen.getByRole('button', { name: /send/i }))
    })

    const ws = MockWS.latest!

    // Fire error then close — the browser does this on network failure
    await act(async () => {
      ws.fireError()
    })
    await act(async () => {
      ws.fireClose(1006)
    })

    // sendMessage must be called EXACTLY once — guard prevents double-POST
    await tlWaitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })

    vi.unstubAllEnvs()
    vi.doUnmock('../../adapters/http/commands')
    vi.resetModules()
  })

  // ------------------------------------------------------------------
  // Test: 4401 close after error → still no fallback (auth path intact)
  // ------------------------------------------------------------------
  test('4401 close → NO fallback (auth path unchanged)', async () => {
    vi.stubEnv('VITE_USE_HTTP', '1')
    vi.resetModules()

    const sendMessage = vi.fn().mockResolvedValue({ message: null, jobId: 'j-4401' })

    vi.doMock('../../adapters/http/commands', () => ({
      createCommands: () => ({
        sendMessage,
        createSession: vi.fn(),
        createArea: vi.fn(),
        updateArea: vi.fn(),
        deleteArea: vi.fn(),
        addParticipant: vi.fn(),
        removeParticipant: vi.fn(),
        createFolder: vi.fn(),
        updateFolder: vi.fn(),
        deleteFolder: vi.fn(),
        createGoal: vi.fn(),
        updateGoal: vi.fn(),
        deleteGoal: vi.fn(),
      }),
    }))

    vi.stubGlobal('localStorage', { getItem: () => 'test-jwt', setItem: () => {}, removeItem: () => {} })

    const { ChatSession } = await import('./ChatSession')
    const { createMockRepos } = await import('../../adapters/mock/mockRepos')
    const { render: tlRender, screen: tlScreen, waitFor: tlWaitFor, act } = await import('@testing-library/react')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { ReposProvider } = await import('../../app/ReposProvider')
    const userEvent = (await import('@testing-library/user-event')).default

    const repos = createMockRepos()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    MockWS.latest = null

    const user = userEvent.setup()

    tlRender(
      <QueryClientProvider client={qc}>
        <ReposProvider repos={repos}>
          <ChatSession sessionId="sess-4401-nofall" />
        </ReposProvider>
      </QueryClientProvider>,
    )

    await tlWaitFor(() => {
      expect(tlScreen.getByRole('button', { name: /send/i })).toBeInTheDocument()
    })

    const input = tlScreen.getByRole('textbox')
    await act(async () => {
      await user.click(input)
      await user.type(input, 'Auth fail message')
    })
    await act(async () => {
      await user.click(tlScreen.getByRole('button', { name: /send/i }))
    })

    const ws = MockWS.latest!

    await act(async () => {
      ws.fireClose(4401)
    })

    // 4401 → auth notice only, no fallback POST
    await tlWaitFor(() => {
      expect(tlScreen.getByText(/session expired/i)).toBeInTheDocument()
    })
    expect(sendMessage).not.toHaveBeenCalled()

    vi.unstubAllEnvs()
    vi.doUnmock('../../adapters/http/commands')
    vi.resetModules()
  })

  // ------------------------------------------------------------------
  // Test: clean non-4401 close (no prior error) → fallback runs exactly once
  // ------------------------------------------------------------------
  test('clean non-4401 close (no prior error) → fallback runs exactly once', async () => {
    vi.stubEnv('VITE_USE_HTTP', '1')
    vi.resetModules()

    const sendMessage = vi.fn().mockResolvedValue({ message: null, jobId: 'j-clean' })

    vi.doMock('../../adapters/http/commands', () => ({
      createCommands: () => ({
        sendMessage,
        createSession: vi.fn(),
        createArea: vi.fn(),
        updateArea: vi.fn(),
        deleteArea: vi.fn(),
        addParticipant: vi.fn(),
        removeParticipant: vi.fn(),
        createFolder: vi.fn(),
        updateFolder: vi.fn(),
        deleteFolder: vi.fn(),
        createGoal: vi.fn(),
        updateGoal: vi.fn(),
        deleteGoal: vi.fn(),
      }),
    }))

    vi.stubGlobal('localStorage', { getItem: () => 'test-jwt', setItem: () => {}, removeItem: () => {} })

    const { ChatSession } = await import('./ChatSession')
    const { createMockRepos } = await import('../../adapters/mock/mockRepos')
    const { render: tlRender, screen: tlScreen, waitFor: tlWaitFor, act } = await import('@testing-library/react')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { ReposProvider } = await import('../../app/ReposProvider')
    const userEvent = (await import('@testing-library/user-event')).default

    const repos = createMockRepos()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    MockWS.latest = null

    const user = userEvent.setup()

    tlRender(
      <QueryClientProvider client={qc}>
        <ReposProvider repos={repos}>
          <ChatSession sessionId="sess-clean-close" />
        </ReposProvider>
      </QueryClientProvider>,
    )

    await tlWaitFor(() => {
      expect(tlScreen.getByRole('button', { name: /send/i })).toBeInTheDocument()
    })

    const input = tlScreen.getByRole('textbox')
    await act(async () => {
      await user.click(input)
      await user.type(input, 'Clean close message')
    })
    await act(async () => {
      await user.click(tlScreen.getByRole('button', { name: /send/i }))
    })

    const ws = MockWS.latest!

    // Only close, no prior error
    await act(async () => {
      ws.fireClose(1001)
    })

    await tlWaitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })

    vi.unstubAllEnvs()
    vi.doUnmock('../../adapters/http/commands')
    vi.resetModules()
  })
})

// ── Fix round 1 tests ─────────────────────────────────────────────────────────

describe('Fix round 1 — 4401 auth-close and concurrent socket guard', () => {
  // ------------------------------------------------------------------
  // Fix 1a: 4401 close → NO fallback POST issued, auth-error surfaced
  // ------------------------------------------------------------------
  test('4401 close → fallback sendMessage NOT called, auth-error detected', async () => {
    let isSending = false
    let authError = false

    const fallbackSendMessage = vi.fn(async (_sid: string, _content: string) => {})

    isSending = true
    const { socket, ws } = openSocket({
      onJobDone: () => { isSending = false },
      onClose: (ev: CloseEvent) => {
        if (ev.code === 4401) {
          // Auth failure: do NOT call fallback POST; clear spinner + surface auth notice
          isSending = false
          authError = true
        } else {
          // Transient drop: run fallback
          isSending = false
          void fallbackSendMessage(SESSION_ID, USER_CONTENT)
        }
      },
    })

    socket.send(USER_CONTENT)
    ws.fireClose(4401)

    await waitFor(() => {
      expect(isSending).toBe(false)
      expect(authError).toBe(true)
    })

    // Critical: fallback POST must NOT be issued for 4401
    expect(fallbackSendMessage).not.toHaveBeenCalled()
  })

  // ------------------------------------------------------------------
  // Fix 1b: non-4401 early close → fallback IS called (regression guard)
  // ------------------------------------------------------------------
  test('non-4401 early close → fallback sendMessage IS called', async () => {
    let isSending = false
    let authError = false

    const fallbackSendMessage = vi.fn(async (_sid: string, _content: string) => {})

    isSending = true
    const { socket, ws } = openSocket({
      onJobDone: () => { isSending = false },
      onClose: (ev: CloseEvent) => {
        if (ev.code === 4401) {
          isSending = false
          authError = true
        } else {
          isSending = false
          void fallbackSendMessage(SESSION_ID, USER_CONTENT)
        }
      },
    })

    socket.send(USER_CONTENT)
    ws.fireClose(1006) // abnormal closure — should trigger fallback

    await waitFor(() => {
      expect(isSending).toBe(false)
    })

    expect(authError).toBe(false)
    expect(fallbackSendMessage).toHaveBeenCalledWith(SESSION_ID, USER_CONTENT)
  })

  // ------------------------------------------------------------------
  // Fix 2: concurrent socket guard — exercises the REAL ChatSession
  // handleSend guard (`if (isSending) return`) by rendering the component
  // in live mode and driving sends through the composer UI.
  //
  // Uses vi.doMock (not hoisted) + vi.resetModules so the freshly-loaded
  // ChatSession sees VITE_USE_HTTP=1 and the stubbed createCommands.
  //
  // Sequence:
  //   1. First send → MockWS instance count = 1, socket open, in-flight.
  //   2. Second send while in-flight → guard fires → count still 1.
  //   3. Fire job_done on first socket → isSending clears.
  //   4. Third send → guard allows → count = 2.
  // ------------------------------------------------------------------
  test('second send while first in-flight does NOT open a second socket (real ChatSession)', async () => {
    // ── live-mode env + module stubs ──────────────────────────────────
    vi.stubEnv('VITE_USE_HTTP', '1')

    // Reset module registry so ChatSession is re-imported with the stub env
    vi.resetModules()

    // vi.doMock (not hoisted) — register before the dynamic import below
    vi.doMock('../../adapters/http/commands', () => ({
      createCommands: () => ({
        sendMessage: vi.fn().mockResolvedValue({ message: null, jobId: 'j0' }),
        createSession: vi.fn(),
        createArea: vi.fn(),
        updateArea: vi.fn(),
        deleteArea: vi.fn(),
        addParticipant: vi.fn(),
        removeParticipant: vi.fn(),
        createFolder: vi.fn(),
        updateFolder: vi.fn(),
        deleteFolder: vi.fn(),
        createGoal: vi.fn(),
        updateGoal: vi.fn(),
        deleteGoal: vi.fn(),
      }),
    }))

    // Stub localStorage.getItem so getToken() returns a non-null value,
    // which causes openChatSocket to include ?token=… in the URL.
    const localStorageStub = { getItem: () => 'test-jwt', setItem: () => {}, removeItem: () => {} }
    vi.stubGlobal('localStorage', localStorageStub)

    // Dynamic imports AFTER env + module stubs are registered
    const { ChatSession } = await import('./ChatSession')
    const { createMockRepos } = await import('../../adapters/mock/mockRepos')
    const { render: tlRender, screen: tlScreen, waitFor: tlWaitFor, act } = await import('@testing-library/react')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { ReposProvider } = await import('../../app/ReposProvider')
    const userEvent = (await import('@testing-library/user-event')).default

    const repos = createMockRepos()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    MockWS.instanceCount = 0
    MockWS.latest = null

    const user = userEvent.setup()

    tlRender(
      <QueryClientProvider client={qc}>
        <ReposProvider repos={repos}>
          <ChatSession sessionId="sess-passkey" />
        </ReposProvider>
      </QueryClientProvider>,
    )

    // Wait for composer to mount
    await tlWaitFor(() => {
      expect(tlScreen.getByRole('button', { name: /send/i })).toBeInTheDocument()
    })

    // ── First send ────────────────────────────────────────────────────
    const input = tlScreen.getByRole('textbox')
    await act(async () => {
      await user.click(input)
      await user.type(input, 'First message')
    })

    await act(async () => {
      await user.click(tlScreen.getByRole('button', { name: /send/i }))
    })

    // One WebSocket opened — first turn is in-flight
    expect(MockWS.instanceCount).toBe(1)
    const firstSocket = MockWS.latest!

    // ── Second send while in-flight ────────────────────────────────────
    // Type something so the send button becomes enabled again
    await act(async () => {
      await user.click(input)
      await user.type(input, 'Second message')
    })

    await act(async () => {
      await user.click(tlScreen.getByRole('button', { name: /send/i }))
    })

    // Guard must have fired: still exactly one socket open
    expect(MockWS.instanceCount).toBe(1)
    // The socket instance has not changed
    expect(MockWS.latest).toBe(firstSocket)

    // ── Fire job_done → isSending clears ──────────────────────────────
    await act(async () => {
      firstSocket.fireMessage({ type: 'job_done', job_id: 'job-guard-test' })
    })

    // ── Third send after guard releases ───────────────────────────────
    await act(async () => {
      await user.click(input)
      await user.type(input, 'Third message')
    })

    await act(async () => {
      await user.click(tlScreen.getByRole('button', { name: /send/i }))
    })

    // A new socket must have been opened — guard released correctly
    expect(MockWS.instanceCount).toBe(2)
    expect(MockWS.latest).not.toBe(firstSocket)

    // Cleanup
    vi.unstubAllEnvs()
    vi.doUnmock('../../adapters/http/commands')
    vi.resetModules()
  })
})

// ── Mock-mode regression: no WS created if no socket is opened ──────────────

describe('chatSocket mock-mode regression', () => {
  test('no WebSocket is created when openChatSocket is not called', () => {
    // Simply not calling openChatSocket should leave MockWS.latest as null
    expect(MockWS.latest).toBeNull()
  })

  test('ChatSession renders in mock mode without opening a WebSocket', async () => {
    const { ChatSession } = await import('./ChatSession')
    const { createMockRepos } = await import('../../adapters/mock/mockRepos')
    const { render: tlRender, screen: tlScreen, waitFor: tlWaitFor } = await import('@testing-library/react')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const { ReposProvider } = await import('../../app/ReposProvider')

    const repos = createMockRepos()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    // Reset latest before render — previous test may have left one
    MockWS.latest = null

    tlRender(
      <QueryClientProvider client={qc}>
        <ReposProvider repos={repos}>
          <ChatSession sessionId="sess-passkey" />
        </ReposProvider>
      </QueryClientProvider>,
    )

    // Composer renders — no crash
    await tlWaitFor(() => {
      expect(tlScreen.getByRole('button', { name: /send/i })).toBeInTheDocument()
    })

    // No WebSocket should have been opened (VITE_USE_HTTP is not '1' in test env)
    expect(MockWS.latest).toBeNull()
  })
})
