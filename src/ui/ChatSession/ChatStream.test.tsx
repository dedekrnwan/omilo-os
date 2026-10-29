/**
 * ChatSession streams a live turn over SSE (POST /v1/sessions/{id}/messages/stream).
 *
 * fetch is stubbed with a ReadableStream that sends the frames in pieces, so the
 * SSE parser, the live reply bubble and the saved messages are all exercised.
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { parseFrames } from '../../adapters/http/sse'

const enc = new TextEncoder()

function sseResponse(frames: string[], delayMs = 5): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const f of frames) {
        controller.enqueue(enc.encode(f))
        await new Promise((r) => setTimeout(r, delayMs))
      }
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('parseFrames', () => {
  test('parses event + JSON data, skips comments, joins multi-line data', () => {
    const seen: [string, unknown][] = []
    parseFrames(': heartbeat\n\nevent: text\ndata: {"delta":"Hi"}\n\ndata: plain\ndata: two', (e, d) => seen.push([e, d]))
    expect(seen).toEqual([['text', { delta: 'Hi' }], ['message', 'plain\ntwo']])
  })
})

async function renderLive(sessionId: string, fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  vi.stubEnv('VITE_USE_HTTP', '1')
  vi.stubEnv('VITE_API_URL', 'http://api.test')
  const fetchMock = vi.fn(fetchImpl)
  vi.stubGlobal('fetch', fetchMock)
  const { ChatSession } = await import('./ChatSession')
  const { createMockRepos } = await import('../../adapters/mock/mockRepos')
  const { render, screen, cleanup: cleanupFresh } = await import('@testing-library/react')
  cleanupFresh()
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
  const { ReposProvider } = await import('../../app/ReposProvider')
  const userEvent = (await import('@testing-library/user-event')).default
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ReposProvider repos={createMockRepos()}>
        <ChatSession sessionId={sessionId} />
      </ReposProvider>
    </QueryClientProvider>,
  )
  return { screen, user: userEvent.setup(), fetchMock }
}

describe('ChatSession over SSE', () => {
  test('streams the reply word by word, then shows the saved messages', async () => {
    const sid = 'sess-stream-ok'
    const { screen, user, fetchMock } = await renderLive(sid, async () =>
      sseResponse([
        frame('user', { id: 'm-user', sessionId: sid, author: { kind: 'you', name: 'You' }, content: 'Halo Chief', createdAt: '2026-10-29T10:00:00Z' }),
        frame('helper', { name: 'Chief', area: 'brand' }),
        frame('activity', { label: 'Searching the web…' }),
        frame('text', { delta: 'Halo! ' }),
        frame('text', { delta: 'Saya siap membantu.' }),
        frame('done', { message: { id: 'm-reply', sessionId: sid, author: { kind: 'helper', name: 'Chief', area: 'brand' }, content: 'Halo! Saya siap membantu.', createdAt: '2026-10-29T10:00:02Z' }, jobId: 'job-1' }),
      ]),
    )
    await user.type(await screen.findByRole('textbox'), 'Halo Chief')
    await user.click(screen.getByRole('button', { name: /send/i }))
    expect(await screen.findByText('Halo! Saya siap membantu.')).toBeInTheDocument()
    expect(screen.getByText('Halo Chief')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`http://api.test/v1/sessions/${sid}/messages/stream`)
    expect(JSON.parse(String(init.body))).toMatchObject({ content: 'Halo Chief' })
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream')
  })

  test('an AI error is shown as a notice, not an endless spinner', async () => {
    const sid = 'sess-stream-err'
    const { screen, user } = await renderLive(sid, async () =>
      sseResponse([
        frame('user', { id: 'm-u2', sessionId: sid, author: { kind: 'you', name: 'You' }, content: 'hi', createdAt: '2026-10-29T10:00:00Z' }),
        frame('error', { error: 'Claude didn’t accept the API key.', message: null, jobId: 'job-2' }),
      ]),
    )
    await user.type(await screen.findByRole('textbox'), 'hi')
    await user.click(screen.getByRole('button', { name: /send/i }))
    expect(await screen.findByText(/didn’t accept the API key/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Chief is thinking…')).toBeNull()
  })
})
