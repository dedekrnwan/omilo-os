/**
 * Tests for Task 3: interviewTurn carries file + base64 reader.
 *
 * readFileBase64 — converts a File to a FilePayload with base64 data (no prefix).
 * interviewTurn  — in HTTP mode, forwards the file field in the SSE body.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileBase64, interviewTurn } from './interviewApi'

// ── interviewTurn SSE spy ─────────────────────────────────────────────────────

let capturedBody: unknown = undefined

vi.mock('../../adapters/http/sse', () => ({
  postSse: vi.fn((_url: string, body: unknown) => {
    capturedBody = body
    // Resolve without emitting any events; interviewTurn handles !finished gracefully.
    return Promise.resolve()
  }),
}))

// ── tests ─────────────────────────────────────────────────────────────────────

describe('readFileBase64', () => {
  test('returns base64 without data: prefix', async () => {
    const f = new File([new Uint8Array([65, 66, 67])], 'a.txt', { type: 'text/plain' })
    const p = await readFileBase64(f)
    expect(p).toEqual({ name: 'a.txt', mime: 'text/plain', data: 'QUJD' })
  })

  test('defaults mime when blank', async () => {
    const f = new File([new Uint8Array([1])], 'x.bin', { type: '' })
    expect((await readFileBase64(f)).mime).toBe('application/octet-stream')
  })
})

describe('interviewTurn (HTTP mode)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_USE_HTTP', '1')
    capturedBody = undefined
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('posts the file in the SSE body', async () => {
    await interviewTurn(
      { file: { name: 'a.pdf', mime: 'application/pdf', data: 'QUJD' } },
      {},
    )
    expect(capturedBody).toMatchObject({
      file: { name: 'a.pdf', mime: 'application/pdf', data: 'QUJD' },
    })
  })
})

describe('interviewTurn (mock mode)', () => {
  // Mock mode is default (VITE_USE_HTTP !== '1').
  // Each test uses a fresh getInterview() to read the current mock view.
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  test('file turn: owner history entry has attachment.name, topic note not overwritten', async () => {
    // Import here so we pick up the same module instance as the mock state.
    const { interviewTurn: turn, getInterview } = await import('./interviewApi')

    // Capture what the mock view looks like after the turn.
    let capturedView: Awaited<ReturnType<typeof getInterview>> | null = null

    await turn(
      { file: { name: 'brief.pdf', mime: 'application/pdf', data: 'QUJD' } },
      {
        onDone: (v) => {
          capturedView = v
        },
      },
    )

    expect(capturedView).not.toBeNull()

    // The last owner entry must carry attachment metadata.
    const ownerEntries = capturedView!.history.filter((e) => e.role === 'owner')
    const lastOwner = ownerEntries[ownerEntries.length - 1]
    expect(lastOwner?.attachment?.name).toBe('brief.pdf')

    // The file label must NOT have been written into any topic note.
    const notesValues = Object.values(capturedView!.notes ?? {})
    for (const note of notesValues) {
      expect(note).not.toMatch(/📎/)
    }
  })
})
