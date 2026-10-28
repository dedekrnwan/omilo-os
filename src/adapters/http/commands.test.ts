/**
 * Unit tests for the commands client (mutations over the P1 write API).
 * Uses the same mocked-fetch pattern as httpRepos.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCommands } from './commands'
import { ApiError } from './client'
import type { Connector, McpToken, Message, Session } from '../../core/domain/types'

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

  // ── mintMcpToken ─────────────────────────────────────────────────────────────

  const seedMcpToken: McpToken & { token: string } = {
    id: 'mct_1',
    label: 'My Token',
    helperId: 'hlp_1',
    scopes: ['tools:read'],
    token: 'raw-secret-once',
    active: true,
  }

  it('mintMcpToken POSTs to /v1/mcp-access-tokens with snake_case body + Bearer', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: seedMcpToken.id,
      label: seedMcpToken.label,
      helper_id: seedMcpToken.helperId,
      scopes: seedMcpToken.scopes,
      token: seedMcpToken.token,
      active: true,
    }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.mintMcpToken({ label: 'My Token', helperId: 'hlp_1', scopes: ['tools:read'] })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/mcp-access-tokens`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({ label: 'My Token', helper_id: 'hlp_1', scopes: ['tools:read'] })
    expect(body.helperId).toBeUndefined()
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('mintMcpToken returns raw token + mapped McpToken fields', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: 'mct_1',
      label: 'My Token',
      helper_id: 'hlp_1',
      scopes: ['tools:read'],
      token: 'raw-secret-once',
      expires_at: null,
      active: true,
    }))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.mintMcpToken({ label: 'My Token', helperId: 'hlp_1', scopes: ['tools:read'] })

    expect(result.token).toBe('raw-secret-once')
    expect(result.helperId).toBe('hlp_1')
    expect(result.id).toBe('mct_1')
    expect((result as unknown as Record<string, unknown>).helper_id).toBeUndefined()
  })

  it('mintMcpToken includes expiresAt as expires_at when provided', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: 'mct_2', label: 'Expiring', helper_id: 'hlp_1',
      scopes: [], token: 'tok', active: true, expires_at: '2027-01-01T00:00:00Z',
    }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.mintMcpToken({ label: 'Expiring', helperId: 'hlp_1', scopes: [], expiresAt: '2027-01-01T00:00:00Z' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.expires_at).toBe('2027-01-01T00:00:00Z')
    expect(body.expiresAt).toBeUndefined()
  })

  // ── revokeMcpToken ───────────────────────────────────────────────────────────

  it('revokeMcpToken DELETEs /v1/mcp-access-tokens/{id} with Bearer', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.revokeMcpToken('mct_1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/mcp-access-tokens/mct_1`)
    expect(init.method).toBe('DELETE')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('revokeMcpToken returns void on success', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.revokeMcpToken('mct_1')
    expect(result).toBeUndefined()
  })

  // ── installConnector ─────────────────────────────────────────────────────────

  const seedConnector: Connector = {
    id: 'con_1',
    pieceId: 'slack',
    label: 'Slack',
    source: 'marketplace',
    status: 'needs_auth',
    enabled: false,
  }

  it('installConnector POSTs to /v1/connectors/install with piece_id body + Bearer', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: seedConnector.id,
      piece_id: seedConnector.pieceId,
      label: seedConnector.label,
      source: seedConnector.source,
      status: seedConnector.status,
      enabled: seedConnector.enabled,
    }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.installConnector('slack')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/connectors/install`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toEqual({ piece_id: 'slack' })
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('installConnector returns a mapped Connector (pieceId camelCase)', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: 'con_1', piece_id: 'slack', label: 'Slack',
      source: 'marketplace', status: 'needs_auth', enabled: false,
    }))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.installConnector('slack')

    expect(result.pieceId).toBe('slack')
    expect((result as unknown as Record<string, unknown>).piece_id).toBeUndefined()
  })

  // ── updateConnector ──────────────────────────────────────────────────────────

  it('updateConnector PATCHes /v1/connectors/{id} with enabled body + Bearer', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: 'con_1', piece_id: 'slack', label: 'Slack',
      source: 'marketplace', status: 'connected', enabled: true,
    }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.updateConnector('con_1', { enabled: true })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/connectors/con_1`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ enabled: true })
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  // ── connectorCredentials ─────────────────────────────────────────────────────

  it('connectorCredentials POSTs to /v1/connectors/{id}/credentials with fields + Bearer', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: 'con_1', piece_id: 'slack', label: 'Slack',
      source: 'marketplace', status: 'connected', enabled: true,
    }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.connectorCredentials('con_1', { api_key: 'secret123' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/connectors/con_1/credentials`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ fields: { api_key: 'secret123' } })
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  // ── disconnectConnector ──────────────────────────────────────────────────────

  it('disconnectConnector DELETEs /v1/connectors/{id} with Bearer', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.disconnectConnector('con_1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/connectors/con_1`)
    expect(init.method).toBe('DELETE')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('disconnectConnector returns void on success (204)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.disconnectConnector('con_1')
    expect(result).toBeUndefined()
  })

  // ── createArea ───────────────────────────────────────────────────────────────
  // NOTE: POST /v1/channels does NOT exist on the backend (only GET). createArea
  // is implemented targeting POST /v1/channels with a forward-compatible payload;
  // the endpoint is flagged as absent (T5 blocker). Tests verify the client emits
  // the correct URL and snake_case body.

  it('createArea POSTs to /v1/channels with snake_case body + Bearer', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: 'ch_new', name: 'Dev', accent: 'dev',
      agent_count: 0, chat_count: 0, open_items: 0,
    }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.createArea({ name: 'Dev', color: 'dev', contextScope: 'team' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/channels`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({ name: 'Dev', accent: 'dev', context_scope: 'team' })
    expect(body.color).toBeUndefined()
    expect(body.contextScope).toBeUndefined()
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('createArea maps optional icon and purpose to snake_case when provided', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: 'ch_new', name: 'Dev', accent: 'dev',
      agent_count: 0, chat_count: 0, open_items: 0,
    }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.createArea({ name: 'Dev', color: 'dev', icon: '🛠', purpose: 'Build things', contextScope: 'team' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.icon).toBe('🛠')
    expect(body.purpose).toBe('Build things')
  })

  it('createArea returns a Channel with agentCount/chatCount/openItems mapped', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: 'ch_new', name: 'Dev', accent: 'dev',
      agent_count: 2, chat_count: 5, open_items: 3,
    }))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.createArea({ name: 'Dev', color: 'dev', contextScope: 'team' })

    expect(result.id).toBe('ch_new')
    expect(result.agentCount).toBe(2)
    expect(result.chatCount).toBe(5)
    expect(result.openItems).toBe(3)
    expect((result as unknown as Record<string, unknown>).agent_count).toBeUndefined()
  })

  // ── updateWallet ─────────────────────────────────────────────────────────────

  it('updateWallet PUTs to /v1/wallet with snake_case body + Bearer', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      auto_topup_enabled: true,
      auto_topup_threshold_credits: 100,
      auto_topup_pack: 'small',
    }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.updateWallet({ autoTopupEnabled: true, autoTopupThresholdCredits: 100, autoTopupPack: 'small' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/wallet`)
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toEqual({ auto_topup_enabled: true, auto_topup_threshold_credits: 100, auto_topup_pack: 'small' })
    expect(body.autoTopupEnabled).toBeUndefined()
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('updateWallet returns a mapped WalletSettings (camelCase)', async () => {
    const raw = { auto_topup_enabled: true, auto_topup_threshold_credits: 200, auto_topup_pack: null }
    fetchMock.mockResolvedValueOnce(okJson(raw))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.updateWallet({ autoTopupEnabled: true, autoTopupThresholdCredits: 200 })

    expect(result.autoTopupEnabled).toBe(true)
    expect(result.autoTopupThresholdCredits).toBe(200)
    expect((result as unknown as Record<string, unknown>).auto_topup_enabled).toBeUndefined()
  })

  // ── topup ────────────────────────────────────────────────────────────────────

  it('topup POSTs to /v1/billing/topup with {pack} body + Bearer', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ balance: 500, hosted_url: null }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.topup('small')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/billing/topup`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ pack: 'small' })
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('topup returns the raw response body as-is', async () => {
    const rawRes = { payment_id: 'pay_1', hosted_url: 'https://pay.test', status: 'pending', credits: 100 }
    fetchMock.mockResolvedValueOnce(okJson(rawRes))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.topup('medium')

    expect(result).toEqual(rawRes)
  })

  // ── changePlan ───────────────────────────────────────────────────────────────

  it('changePlan POSTs to /v1/billing/change-plan with {plan_id, interval} body + Bearer', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ subscription: { id: 'sub_1' } }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.changePlan('plan_pro', 'yearly')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/billing/change-plan`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ plan_id: 'plan_pro', interval: 'yearly' })
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('changePlan sends monthly interval when specified', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ subscription: { id: 'sub_1' } }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.changePlan('plan_pro', 'monthly')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ plan_id: 'plan_pro', interval: 'monthly' })
  })

  it('changePlan returns the raw response body as-is', async () => {
    const rawRes = { subscription: { id: 'sub_1', plan: 'pro' }, balance: 0 }
    fetchMock.mockResolvedValueOnce(okJson(rawRes))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.changePlan('plan_pro', 'yearly')

    expect(result).toEqual(rawRes)
  })

  it('changePlan redirects via hosted_url when returned by Doit provider', async () => {
    const rawRes = { payment_id: 'pay_1', hosted_url: 'https://pay.doit.id/abc', status: 'pending', plan_id: 'plan_pro' }
    fetchMock.mockResolvedValueOnce(okJson(rawRes))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.changePlan('plan_pro', 'yearly')

    expect((result as Record<string, unknown>).hosted_url).toBe('https://pay.doit.id/abc')
  })

  // ── updateCompanyProfile ─────────────────────────────────────────────────────

  it('updateCompanyProfile PATCHes /v1/company with snake_case body + Bearer', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: 'cmp_1', name: 'Acme', color: '#ff0000',
      industry: 'tech', team_size: '10-50', region: 'id', currency: 'IDR', pic_role: 'CTO',
    }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.updateCompanyProfile({ industry: 'tech', teamSize: '10-50', picRole: 'CTO', region: 'id' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe(`${BASE}/v1/company`)
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({ industry: 'tech', team_size: '10-50', pic_role: 'CTO', region: 'id' })
    expect(body.teamSize).toBeUndefined()
    expect(body.picRole).toBeUndefined()
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('updateCompanyProfile maps name and timezone when provided', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: 'cmp_1', name: 'NewName', color: '#000',
      industry: null, team_size: null, region: null, currency: 'IDR', pic_role: null,
    }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.updateCompanyProfile({ name: 'NewName', timezone: 'Asia/Jakarta' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.name).toBe('NewName')
    expect(body.timezone).toBe('Asia/Jakarta')
  })

  it('updateCompanyProfile returns mapped Company (teamSize/picRole camelCase)', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      id: 'cmp_1', name: 'Acme', color: '#000',
      industry: 'fintech', team_size: '50-200', region: 'id', currency: 'IDR', pic_role: 'CEO',
    }))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.updateCompanyProfile({ industry: 'fintech' })

    expect(result.industry).toBe('fintech')
    expect(result.teamSize).toBe('50-200')
    expect(result.picRole).toBe('CEO')
    expect((result as unknown as Record<string, unknown>).team_size).toBeUndefined()
    expect((result as unknown as Record<string, unknown>).pic_role).toBeUndefined()
  })

  // ── new command ApiError propagation ─────────────────────────────────────────

  it('mintMcpToken throws ApiError on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(errorJson(403, 'Forbidden'))

    const commands = createCommands(BASE, () => TOKEN)
    await expect(
      commands.mintMcpToken({ label: 'x', helperId: 'hlp_1', scopes: [] })
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('disconnectConnector throws ApiError on non-OK response (404)', async () => {
    fetchMock.mockResolvedValueOnce(errorJson(404, 'Not found'))

    const commands = createCommands(BASE, () => TOKEN)
    await expect(commands.disconnectConnector('con_missing')).rejects.toBeInstanceOf(ApiError)
  })

  // ── P8 commands ──────────────────────────────────────────────────────────────

  it('publishFlow POSTs to /v1/flows/{id}/publish with Bearer', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ id: 'prp_1', type: 'flow_publish', status: 'pending' }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.publishFlow('flw_1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/flows/flw_1/publish`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('runFlow POSTs to /v1/flows/{id}/run with Bearer', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ id: 'frn_1', flow_id: 'flw_1', status: 'done' }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.runFlow('flw_1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/flows/flw_1/run`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('testRunFlow POSTs to /v1/flows/{id}/test-run with sample body', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ id: 'frn_2', status: 'done' }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.testRunFlow('flw_1', { key: 'value' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/flows/flw_1/test-run`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ sample: { key: 'value' } })
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('testRunFlow sends empty sample when input is omitted', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ id: 'frn_3', status: 'done' }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.testRunFlow('flw_1')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ sample: {} })
  })

  it('runRoutineNow POSTs to /v1/routines/{id}/run-now and returns {jobId}', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ job_id: 'job_42' }))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.runRoutineNow('rtn_1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/routines/rtn_1/run-now`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(result.jobId).toBe('job_42')
    expect((result as unknown as Record<string, unknown>).job_id).toBeUndefined()
  })

  it('replanGoal POSTs to /v1/goals/{id}/replan and returns {jobId}', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ job_id: 'job_55' }))

    const commands = createCommands(BASE, () => TOKEN)
    const result = await commands.replanGoal('goal_1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/goals/goal_1/replan`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(result.jobId).toBe('job_55')
    expect((result as unknown as Record<string, unknown>).job_id).toBeUndefined()
  })

  it('publishSkill POSTs to /v1/skills/{id}/publish with Bearer', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ id: 'prp_2', type: 'skill_publish', status: 'pending' }))

    const commands = createCommands(BASE, () => TOKEN)
    await commands.publishSkill('skl_1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/skills/skl_1/publish`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('publishFlow throws ApiError on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(errorJson(404, 'Flow not found'))

    const commands = createCommands(BASE, () => TOKEN)
    await expect(commands.publishFlow('flw_missing')).rejects.toBeInstanceOf(ApiError)
  })

  it('runRoutineNow throws ApiError on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(errorJson(404, 'Routine not found'))

    const commands = createCommands(BASE, () => TOKEN)
    await expect(commands.runRoutineNow('rtn_missing')).rejects.toBeInstanceOf(ApiError)
  })

  it('replanGoal throws ApiError on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(errorJson(404, 'Goal not found'))

    const commands = createCommands(BASE, () => TOKEN)
    await expect(commands.replanGoal('goal_missing')).rejects.toBeInstanceOf(ApiError)
  })
})
