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

describe('interviewTurn', () => {
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
