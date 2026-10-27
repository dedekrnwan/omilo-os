/**
 * Unit tests for the commands client (mutations over the P1 write API).
 * Uses the same mocked-fetch pattern as httpRepos.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCommands } from './commands'
import { ApiError } from './client'
import type { Message, Session } from '../../core/domain/types'

const BASE = 'http://api.test'
const TOKEN = 'test-token-xyz'

// ── helpers ──────────────────────────────────────────────────────────────────

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function errorJson(status: number, detail: string): Response {
  return new Response(
    JSON.stringify({ type: 'about:blank', status, detail }),
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  )
}

// Seed data

const seedSession: Session = {
  id: 'ses_1',
  title: 'Test session',
  channelId: 'ch_1',
  updated: 'now',
}

const seedMessage: Message = {
  id: 'msg_1',
  sessionId: 'ses_1',
  author: { kind: 'you', name: 'Dede' },
  content: 'hi',
  createdAt: '2026-10-27T10:00:00Z',
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('createCommands', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── sendMessage ─────────────────────────────────────────────────────────────

  it('sendMessage POSTs to /v1/sessions/{id}/messages with content + auth header', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ message: seedMessage, job_id: 'job_1' }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.sendMessage('ses_1', 'hi')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/sessions/ses_1/messages`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hi' })
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('sendMessage returns {message, jobId} with jobId mapped from job_id', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ message: seedMessage, job_id: 'job_42' }))

    const commands = createCommands(BASE, () => TOKEN)
    const { message, jobId, ...rest } = await commands.sendMessage('ses_1', 'hi')

    expect(message).toEqual(seedMessage)
    expect(jobId).toBe('job_42')
    expect((rest as Record<string, unknown>).job_id).toBeUndefined()
  })

  // ── createSession ────────────────────────────────────────────────────────────

  it('createSession POSTs to /v1/sessions and returns the Session', async () => {
    fetchMock.mockResolvedValueOnce(okJson(seedSession))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.createSession({ title: 'x' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/sessions`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ title: 'x' })
    expect(result).toEqual(seedSession)
  })

  it('createSession maps camelCase input to snake_case body keys', async () => {
    fetchMock.mockResolvedValueOnce(okJson(seedSession))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.createSession({ channelId: 'ch_1', goalId: 'goal_1', title: 'Test' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toEqual({ channel_id: 'ch_1', goal_id: 'goal_1', title: 'Test' })
    expect(body.channelId).toBeUndefined()
    expect(body.goalId).toBeUndefined()
  })

  // ── approveProposal ──────────────────────────────────────────────────────────

  it('approveProposal POSTs to /v1/proposals/{id}/approve with Idempotency-Key header', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ proposal: { id: 'prp_1', status: 'approved' }, execution_job_id: 'ejob_1' }),
    )

    const commands = createCommands(BASE, () => TOKEN)
    await commands.approveProposal('prp_1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/proposals/prp_1/approve`)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBeDefined()
    expect(headers['Idempotency-Key']).toMatch(/prp_1/)
  })

  it('approveProposal returns {executionJobId} mapped from execution_job_id', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ proposal: { id: 'prp_1' }, execution_job_id: 'ejob_99' }),
    )

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.approveProposal('prp_1')

    expect(result.executionJobId).toBe('ejob_99')
    expect((result as Record<string, unknown>).execution_job_id).toBeUndefined()
  })

  // ── rejectProposal ───────────────────────────────────────────────────────────

  it('rejectProposal POSTs to /v1/proposals/{id}/reject with note', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ proposal: { id: 'prp_1', status: 'rejected' } }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.rejectProposal('prp_1', 'Not needed')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/proposals/prp_1/reject`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ note: 'Not needed' })
  })

  // ── requestChanges ───────────────────────────────────────────────────────────

  it('requestChanges POSTs to /v1/proposals/{id}/request-changes with note', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ proposal: { id: 'prp_1' } }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.requestChanges('prp_1', 'Please revise')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/proposals/prp_1/request-changes`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ note: 'Please revise' })
  })

  // ── error propagation ────────────────────────────────────────────────────────

  it('throws ApiError on a non-OK response (e.g. 409 conflict)', async () => {
    fetchMock.mockResolvedValueOnce(errorJson(409, 'Already approved'))

    const commands = createCommands(BASE, () => TOKEN)
    let caughtError: unknown
    try {
      await commands.approveProposal('prp_1')
    } catch (err) {
      caughtError = err
    }
    expect(caughtError).toBeInstanceOf(ApiError)
    expect((caughtError as ApiError).message).toBe('Already approved')
    expect((caughtError as ApiError).status).toBe(409)
  })

  it('does NOT attach Authorization when token is null', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ message: seedMessage, job_id: 'j1' }))

    const commands = createCommands(BASE, () => null)
    await commands.sendMessage('ses_1', 'test')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })
})
