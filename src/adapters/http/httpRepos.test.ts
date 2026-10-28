import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHttpRepos } from './httpRepos'
import { ApiError } from './client'
import { runReposContract } from '../../core/ports/repos.contract'
import type { Channel, InboxItem, Session, UsageSummary, WalletSettings, AiAccount, Piece, Connector, McpToken } from '../../core/domain/types'

const BASE = 'http://api.test'
const TOKEN = 'test-token-abc'

// ── helpers ──────────────────────────────────────────────────────────────────

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function notFound(): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404 }), {
    status: 404,
    headers: { 'Content-Type': 'application/problem+json' },
  })
}

// Seed data for contract tests
const seedChannel: Channel = {
  id: 'ch-1', name: 'General', accent: 'general', isDefault: true,
  agentCount: 0, chatCount: 5, openItems: 1, contextScope: 'isolated',
}

const seedSession: Session = {
  id: 'sess-1', title: 'Test session', channelId: 'ch-1', updated: 'now',
}

const seedInboxItem: InboxItem = {
  id: 'inbox-1',
  title: 'Test inbox item',
  summary: 'A test item',
  sessionId: 'sess-1',
  channelId: 'ch-1',
  kind: 'decision',
  status: 'pending',
  createdAt: '2026-10-24T09:00:00Z',
  asker: 'Chief',
  askerArea: 'brand',
}

const seedUsage: UsageSummary = {
  balance: 5000,
  included: 2000,
  usedThisPeriod: 800,
  byHelper: [{ helperId: 'h-1', credits: 800 }],
  byDay: [{ day: '2026-10-01', credits: 800 }],
  pendingTopups: { count: 0, totalCredits: 0 },
  lastPayment: null,
}

// Raw backend snake_case shapes for the contract http-mock
const rawUsage = {
  balance: seedUsage.balance,
  included: seedUsage.included,
  used_this_period: seedUsage.usedThisPeriod,
  by_helper: [{ helper_id: 'h-1', credits: 800 }],
  by_day: [{ day: '2026-10-01', credits: 800 }],
  pending_topups: { count: 0, total_credits: 0 },
  last_payment: null,
}

const rawWallet = {
  auto_topup_enabled: false,
  auto_topup_threshold_credits: 0,
  auto_topup_pack: null,
}

const rawAiAccount = {
  id: 'acc-1',
  harness: 'claude',
  name: 'Main account',
  tag: null,
  status: 'ready',
  pct: 10,
  tokens: 'sk-ant-...****',
  last_used: null,
}

const rawPiece = {
  id: 'piece-slack',
  label: 'Slack',
  category: 'communication',
  description: 'Send messages to Slack',
  auth_type: 'oauth2',
  action_count: 12,
  logo: 'https://example.com/slack.png',
  status: 'ok',
}

const rawConnector = {
  id: 'con-1',
  piece_id: 'piece-slack',
  label: 'Slack',
  source: 'marketplace',
  status: 'connected',
  enabled: true,
}

const rawMcpToken = {
  id: 'mct-1',
  label: 'Dev token',
  helper_id: 'h-1',
  scopes: ['read'],
  expires_at: null,
  last_used_at: null,
  revoked_at: null,
  active: true,
}

// ── unit tests ────────────────────────────────────────────────────────────────

describe('createHttpRepos — unit', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('channels.list() calls GET /v1/channels and returns Channel[]', async () => {
    const channels: Channel[] = [seedChannel]
    fetchMock.mockResolvedValueOnce(okJson(channels))

    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.channels.list()

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/channels`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(result).toEqual(channels)
  })

  it('channels.list() does NOT attach Authorization when token is null', async () => {
    fetchMock.mockResolvedValueOnce(okJson([]))
    const repos = createHttpRepos(BASE, () => null)
    await repos.channels.list()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })

  it('channels.get(id) returns Channel on 200', async () => {
    fetchMock.mockResolvedValueOnce(okJson(seedChannel))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.channels.get('ch-1')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/channels/ch-1`)
    expect(result).toEqual(seedChannel)
  })

  it('channels.get("missing") resolves to null on 404 (does NOT throw)', async () => {
    fetchMock.mockResolvedValueOnce(notFound())
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.channels.get('missing')
    expect(result).toBeNull()
  })

  it('sessions.get("missing") resolves to null on 404', async () => {
    fetchMock.mockResolvedValueOnce(notFound())
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.sessions.get('missing')
    expect(result).toBeNull()
  })

  it('inbox.get("missing") resolves to null on 404', async () => {
    fetchMock.mockResolvedValueOnce(notFound())
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.inbox.get('missing')
    expect(result).toBeNull()
  })

  it('throws on non-OK non-404 responses with error detail', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: 'about:blank', title: 'Forbidden', status: 403, detail: 'Wrong tenant' }),
        { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    )
    const repos = createHttpRepos(BASE, () => TOKEN)
    await expect(repos.channels.list()).rejects.toThrow('Wrong tenant')
  })

  it('Accept: application/json header is always set', async () => {
    fetchMock.mockResolvedValueOnce(okJson([]))
    const repos = createHttpRepos(BASE, () => null)
    await repos.channels.list()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers['Accept']).toBe('application/json')
  })

  // ── usage ─────────────────────────────────────────────────────────────────

  it('usage.get() calls GET /v1/usage with Bearer and returns UsageSummary', async () => {
    const raw = {
      balance: 5000,
      included: 2000,
      used_this_period: 800,
      by_helper: [{ helper_id: 'h-1', credits: 300 }],
      by_day: [{ day: '2026-10-01', credits: 300 }],
      pending_topups: { count: 1, total_credits: 1000 },
      last_payment: null,
    }
    fetchMock.mockResolvedValueOnce(okJson(raw))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.usage.get()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/usage`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    const expected: UsageSummary = {
      balance: 5000,
      included: 2000,
      usedThisPeriod: 800,
      byHelper: [{ helperId: 'h-1', credits: 300 }],
      byDay: [{ day: '2026-10-01', credits: 300 }],
      pendingTopups: { count: 1, totalCredits: 1000 },
      lastPayment: null,
    }
    expect(result).toEqual(expected)
  })

  // ── wallet ────────────────────────────────────────────────────────────────

  it('wallet.get() calls GET /v1/wallet with Bearer and returns WalletSettings', async () => {
    const raw = {
      auto_topup_enabled: true,
      auto_topup_threshold_credits: 500,
      auto_topup_pack: 'medium',
    }
    fetchMock.mockResolvedValueOnce(okJson(raw))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.wallet.get()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/wallet`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    const expected: WalletSettings = {
      autoTopupEnabled: true,
      autoTopupThresholdCredits: 500,
      autoTopupPack: 'medium',
    }
    expect(result).toEqual(expected)
  })

  // ── aiAccounts ────────────────────────────────────────────────────────────

  it('aiAccounts.list() calls GET /v1/ai-accounts with Bearer and returns AiAccount[]', async () => {
    const raw = [{
      id: 'acc-1',
      harness: 'claude',
      name: 'Main account',
      tag: 'primary',
      status: 'ready',
      pct: 20,
      tokens: 'sk-ant-...****',
      last_used: '2026-10-22T10:00:00Z',
    }]
    fetchMock.mockResolvedValueOnce(okJson(raw))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.aiAccounts.list()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/ai-accounts`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    const expected: AiAccount[] = [{
      id: 'acc-1',
      harness: 'claude',
      name: 'Main account',
      tag: 'primary',
      status: 'ready',
      pctWindow: 20,
      tokens: 'sk-ant-...****',
      lastUsed: '2026-10-22T10:00:00Z',
    }]
    expect(result).toEqual(expected)
  })

  // ── marketplace ───────────────────────────────────────────────────────────

  it('marketplace.list() calls GET /v1/marketplace with Bearer and returns Piece[]', async () => {
    const raw = [{
      id: 'piece-slack',
      label: 'Slack',
      category: 'communication',
      description: 'Send messages to Slack',
      auth_type: 'oauth2',
      action_count: 12,
      logo: 'https://example.com/slack.png',
      status: 'ok',
    }]
    fetchMock.mockResolvedValueOnce(okJson(raw))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.marketplace.list()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/marketplace`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    const expected: Piece[] = [{
      id: 'piece-slack',
      label: 'Slack',
      category: 'communication',
      description: 'Send messages to Slack',
      authType: 'oauth2',
      actionCount: 12,
      logo: 'https://example.com/slack.png',
      status: 'ok',
    }]
    expect(result).toEqual(expected)
  })

  it('marketplace.list({ category, q }) appends query params to URL', async () => {
    fetchMock.mockResolvedValueOnce(okJson([]))
    const repos = createHttpRepos(BASE, () => TOKEN)
    await repos.marketplace.list({ category: 'communication', q: 'slack' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/marketplace?category=communication&q=slack`)
  })

  it('marketplace.list({ category }) only appends category', async () => {
    fetchMock.mockResolvedValueOnce(okJson([]))
    const repos = createHttpRepos(BASE, () => TOKEN)
    await repos.marketplace.list({ category: 'ai' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/marketplace?category=ai`)
  })

  // ── connectors ────────────────────────────────────────────────────────────

  it('connectors.list() calls GET /v1/connectors with Bearer and returns Connector[]', async () => {
    const raw = [{
      id: 'con-1',
      piece_id: 'piece-slack',
      label: 'Slack',
      source: 'marketplace',
      status: 'connected',
      enabled: true,
    }]
    fetchMock.mockResolvedValueOnce(okJson(raw))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.connectors.list()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/connectors`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    const expected: Connector[] = [{
      id: 'con-1',
      pieceId: 'piece-slack',
      label: 'Slack',
      source: 'marketplace',
      status: 'connected',
      enabled: true,
    }]
    expect(result).toEqual(expected)
  })

  // ── mcpTokens ─────────────────────────────────────────────────────────────

  it('mcpTokens.list() calls GET /v1/mcp-access-tokens with Bearer and returns McpToken[]', async () => {
    const raw = [{
      id: 'mct-1',
      label: 'Dev token',
      helper_id: 'h-1',
      scopes: ['read', 'write'],
      expires_at: '2027-01-01T00:00:00Z',
      last_used_at: '2026-10-20T12:00:00Z',
      revoked_at: null,
      active: true,
    }]
    fetchMock.mockResolvedValueOnce(okJson(raw))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.mcpTokens.list()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/mcp-access-tokens`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    const expected: McpToken[] = [{
      id: 'mct-1',
      label: 'Dev token',
      helperId: 'h-1',
      scopes: ['read', 'write'],
      expiresAt: '2027-01-01T00:00:00Z',
      lastUsedAt: '2026-10-20T12:00:00Z',
      revokedAt: null,
      active: true,
    }]
    expect(result).toEqual(expected)
  })

  // ── ApiError on non-OK non-404 ────────────────────────────────────────────

  it('usage.get() throws ApiError on 403', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ detail: 'Forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    )
    const repos = createHttpRepos(BASE, () => TOKEN)
    await expect(repos.usage.get()).rejects.toBeInstanceOf(ApiError)
  })

  it('wallet.get() throws ApiError on 500', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('', { status: 500 }),
    )
    const repos = createHttpRepos(BASE, () => TOKEN)
    await expect(repos.wallet.get()).rejects.toBeInstanceOf(ApiError)
  })
})

// ── contract suite against the http impl (mocked fetch) ───────────────────────

runReposContract('http (mocked fetch)', () => {
  const fetchMock = vi.fn((url: string) => {
    // Strip query string for path matching
    const [fullPath] = (url as string).replace(BASE, '').split('?')
    const path = fullPath

    // channels
    if (path === '/v1/channels') return Promise.resolve(okJson([seedChannel]))
    if (path.match(/^\/v1\/channels\/ch-1$/)) return Promise.resolve(okJson(seedChannel))
    if (path.match(/^\/v1\/channels\/.+$/)) return Promise.resolve(notFound())

    // folders
    if (path === '/v1/folders') return Promise.resolve(okJson([]))
    if (path.match(/^\/v1\/channels\/.+\/folders$/)) return Promise.resolve(okJson([]))

    // goals
    if (path === '/v1/goals') return Promise.resolve(okJson([]))
    if (path.match(/^\/v1\/channels\/.+\/goals$/)) return Promise.resolve(okJson([]))

    // sessions
    if (path === '/v1/sessions') return Promise.resolve(okJson([seedSession]))
    if (path === `/v1/sessions/${seedSession.id}`) return Promise.resolve(okJson(seedSession))
    if (path.match(/^\/v1\/sessions\/[^/]+$/) && !path.includes('/messages')) return Promise.resolve(notFound())
    if (path.match(/^\/v1\/channels\/.+\/sessions$/)) return Promise.resolve(okJson([]))

    // messages
    if (path.match(/^\/v1\/sessions\/.+\/messages$/)) return Promise.resolve(okJson([]))

    // inbox
    if (path === '/v1/inbox') return Promise.resolve(okJson([seedInboxItem]))
    if (path === `/v1/inbox/${seedInboxItem.id}`) return Promise.resolve(okJson(seedInboxItem))
    if (path.match(/^\/v1\/inbox\/.+$/)) return Promise.resolve(notFound())

    // usage
    if (path === '/v1/usage') return Promise.resolve(okJson(rawUsage))

    // wallet
    if (path === '/v1/wallet') return Promise.resolve(okJson(rawWallet))

    // ai-accounts
    if (path === '/v1/ai-accounts') return Promise.resolve(okJson([rawAiAccount]))

    // marketplace
    if (path === '/v1/marketplace') return Promise.resolve(okJson([rawPiece]))

    // connectors
    if (path === '/v1/connectors') return Promise.resolve(okJson([rawConnector]))

    // mcp-access-tokens
    if (path === '/v1/mcp-access-tokens') return Promise.resolve(okJson([rawMcpToken]))

    return Promise.resolve(notFound())
  })

  vi.stubGlobal('fetch', fetchMock)
  afterEach(() => vi.unstubAllGlobals())

  return createHttpRepos(BASE, () => TOKEN)
})
