import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHttpRepos } from './httpRepos'
import { ApiError } from './client'
import { runReposContract } from '../../core/ports/repos.contract'
import type { Channel, CompanyMember, InboxItem, Session, UsageSummary, WalletSettings, AiAccount, Piece, Connector, McpToken, Flow, FlowRun, Routine, KbItem, KbSource, AnalyticsOverview, HelperStat, Skill, Helper } from '../../core/domain/types'

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

// P12 billing seeds
const rawBillingPlan = {
  id: 'plan-cloud',
  tier: 'cloud',
  name: 'Cloud',
  monthly_price_usd: 39,
  monthly_price_idr: 599_000,
  yearly_price_usd: 31,
  yearly_price_idr: 479_000,
  included_credits: 2_000,
  seats: 5,
  trial_days: 14,
}
const rawBillingSubscription = {
  plan_id: 'plan-cloud',
  status: 'trialing',
  current_period_end: null,
  seats: 5,
  billing_interval: 'yearly',
  is_trial: true,
  trial_ends_at: null,
  trial_days_left: 14,
}

// P8 contract seeds
const rawFlow = {
  id: 'flw-c1', title: 'Morning brief', status: 'active', enabled: true,
  count: 4, areas: ['general'], created_at: '2026-10-01T08:00:00Z',
}
const rawRoutine = {
  id: 'rtn-c1', company_id: 'cmp-1', helper_id: 'h-c1',
  name: 'Morning brief', subtitle: '', instructions: 'Do it',
  freq: 'daily', at: '07:00', days: [], monthly: null,
  timezone: 'UTC', cron: '0 7 * * *', sends_to: [],
  enabled: true, paused: false, managed_by_chief: false,
  next_at: null, last_at: null, goal_ids: [], created_by: 'operator',
}
const rawKbItem = {
  source_id: 'kbs-c1', heading: 'Test heading', text: 'Test body', kind: 'skill', score: 0.8,
}
const rawKbSource = {
  id: 'kbs-c1', company_id: 'cmp-1', kind: 'skill', ref: 'skill:x',
  title: 'Test Source', content_hash: 'abc', helper_id: null,
}
const rawAnalyticsOverview = {
  stats: [{ label: 'Jobs done', value: 10 }],
  series: [{ label: 'Jobs per day', labels: ['2026-10-28'], values: [10] }],
}
const rawAnalyticsHelpers: HelperStat[] = [
  { helperId: 'h-c1', name: 'Chief', jobs: 10, success: 90, tokens: 1000, spend: 50 },
]
const rawSkill: Skill = {
  id: 'skl-c1', name: 'Passkeys', status: 'active', version: 1, helperId: 'h-c1', usageCount: 3,
}
const rawHelper: Helper = {
  id: 'h-c1', name: 'Chief', area: 'brand', role: 'Chief of Staff', status: 'active', isChief: true,
}

// P13 members seed
const rawMember = {
  id: 'mem-1', user_id: 'usr-1', name: 'Dede Kurniawan', email: 'dede@saga.co.id', role: 'owner',
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

  // ── P8 flows ───────────────────────────────────────────────────────────────

  it('flows.list() calls GET /v1/flows with Bearer and returns Flow[]', async () => {
    const rawFlows = [{
      id: 'flw-1', title: 'Morning brief', status: 'active', enabled: true,
      count: 4, areas: ['general'], created_at: '2026-10-01T08:00:00Z',
    }]
    fetchMock.mockResolvedValueOnce(okJson(rawFlows))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.flows.list()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/flows`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(result).toHaveLength(1)
    const f = result[0] as Flow
    expect(f.id).toBe('flw-1')
    expect(f.createdAt).toBe('2026-10-01T08:00:00Z')
    expect((f as unknown as Record<string, unknown>).created_at).toBeUndefined()
  })

  it('flows.get(id) calls GET /v1/flows/{id} and returns mapped Flow', async () => {
    const raw = {
      id: 'flw-1', title: 'Morning brief', status: 'active', enabled: true,
      count: 4, areas: ['general'], created_at: '2026-10-01T08:00:00Z',
      company_id: 'cmp-1', version: 1, created_by: 'operator',
      trigger: { kind: 'schedule', spec: { cron: '0 7 * * *' } },
      nodes: [], edges: [], channel_ids: [],
    }
    fetchMock.mockResolvedValueOnce(okJson(raw))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.flows.get('flw-1')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/flows/flw-1`)
    expect(result).not.toBeNull()
    expect(result!.companyId).toBe('cmp-1')
    expect(result!.createdBy).toBe('operator')
    expect((result as unknown as Record<string, unknown>).company_id).toBeUndefined()
  })

  it('flows.get("missing") resolves to null on 404', async () => {
    fetchMock.mockResolvedValueOnce(notFound())
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.flows.get('missing')
    expect(result).toBeNull()
  })

  it('flows.get() throws ApiError on non-OK non-404', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    const repos = createHttpRepos(BASE, () => TOKEN)
    await expect(repos.flows.get('flw-1')).rejects.toBeInstanceOf(ApiError)
  })

  it('flows.runs(id) calls GET /v1/flows/{id}/runs and returns FlowRun[]', async () => {
    const rawRuns = [{
      id: 'frn-1', flow_id: 'flw-1', status: 'done',
      trigger_summary: 'schedule', started_by: 'scheduler',
      cost_credits: 12, duration: 45, waiting_for: null,
      job_ids: ['job-1'], started_at: '2026-10-28T07:00:05Z', ended_at: '2026-10-28T07:00:50Z',
    }]
    fetchMock.mockResolvedValueOnce(okJson(rawRuns))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.flows.runs('flw-1')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/flows/flw-1/runs`)
    expect(result).toHaveLength(1)
    const run = result[0] as FlowRun
    expect(run.flowId).toBe('flw-1')
    expect(run.triggerSummary).toBe('schedule')
    expect(run.startedBy).toBe('scheduler')
    expect(run.costCredits).toBe(12)
    expect((run as unknown as Record<string, unknown>).flow_id).toBeUndefined()
    expect((run as unknown as Record<string, unknown>).trigger_summary).toBeUndefined()
  })

  // ── P8 routines ────────────────────────────────────────────────────────────

  it('routines.list() calls GET /v1/routines with Bearer and returns Routine[]', async () => {
    const rawRoutines = [{
      id: 'rtn-1', company_id: 'cmp-1', helper_id: 'h-chief',
      name: 'Morning brief', subtitle: '', instructions: 'Do it',
      freq: 'daily', at: '07:00', days: [], monthly: null,
      timezone: 'UTC', cron: '0 7 * * *', sends_to: [],
      enabled: true, paused: false, managed_by_chief: false,
      next_at: '2026-10-29T07:00:00Z', last_at: null, goal_ids: [], created_by: 'operator',
    }]
    fetchMock.mockResolvedValueOnce(okJson(rawRoutines))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.routines.list()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/routines`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(result).toHaveLength(1)
    const r = result[0] as Routine
    expect(r.helperId).toBe('h-chief')
    expect(r.managedByChief).toBe(false)
    expect(r.nextAt).toBe('2026-10-29T07:00:00Z')
    expect((r as unknown as Record<string, unknown>).helper_id).toBeUndefined()
    expect((r as unknown as Record<string, unknown>).managed_by_chief).toBeUndefined()
  })

  it('routines.get(id) calls GET /v1/routines/{id} and unwraps {routine}', async () => {
    const rawRoutine = {
      id: 'rtn-1', company_id: 'cmp-1', helper_id: 'h-chief',
      name: 'Morning brief', subtitle: '', instructions: 'Do it',
      freq: 'daily', at: '07:00', days: [], monthly: null,
      timezone: 'UTC', cron: '0 7 * * *', sends_to: [],
      enabled: true, paused: false, managed_by_chief: false,
      next_at: null, last_at: null, goal_ids: [], created_by: 'operator',
    }
    fetchMock.mockResolvedValueOnce(okJson({ routine: rawRoutine, runs: [] }))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.routines.get('rtn-1')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/routines/rtn-1`)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('rtn-1')
    expect(result!.helperId).toBe('h-chief')
  })

  it('routines.get("missing") resolves to null on 404', async () => {
    fetchMock.mockResolvedValueOnce(notFound())
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.routines.get('missing')
    expect(result).toBeNull()
  })

  // ── P8 knowledge ───────────────────────────────────────────────────────────

  it('knowledge.list() calls GET /v1/knowledge with Bearer and returns KbItem[]', async () => {
    const rawItems = [{
      source_id: 'kbs-1', heading: 'Passkeys', text: 'Ship by Nov 14', kind: 'skill', score: 0.9,
    }]
    fetchMock.mockResolvedValueOnce(okJson(rawItems))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.knowledge.list()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/knowledge`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(result).toHaveLength(1)
    const item = result[0] as KbItem
    expect(item.sourceId).toBe('kbs-1')
    expect((item as unknown as Record<string, unknown>).source_id).toBeUndefined()
  })

  it('knowledge.list({q}) appends q param to URL', async () => {
    fetchMock.mockResolvedValueOnce(okJson([]))
    const repos = createHttpRepos(BASE, () => TOKEN)
    await repos.knowledge.list({ q: 'passkeys' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/knowledge?q=passkeys`)
  })

  it('knowledge.sources() calls GET /v1/knowledge/sources and maps snake→camel', async () => {
    const rawSources = [{
      id: 'kbs-1', company_id: 'cmp-1', kind: 'skill', ref: 'skill:x',
      title: 'Passkeys', content_hash: 'abc', helper_id: 'h-dev',
    }]
    fetchMock.mockResolvedValueOnce(okJson(rawSources))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.knowledge.sources()

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/knowledge/sources`)
    expect(result).toHaveLength(1)
    const src = result[0] as KbSource
    expect(src.companyId).toBe('cmp-1')
    expect(src.contentHash).toBe('abc')
    expect(src.helperId).toBe('h-dev')
    expect((src as unknown as Record<string, unknown>).company_id).toBeUndefined()
  })

  // ── P8 analytics ───────────────────────────────────────────────────────────

  it('analytics.overview() calls GET /v1/analytics/overview with Bearer', async () => {
    const rawOverview: AnalyticsOverview = {
      stats: [{ label: 'Jobs done', value: 10 }],
      series: [{ label: 'Jobs per day', labels: ['2026-10-28'], values: [10] }],
    }
    fetchMock.mockResolvedValueOnce(okJson(rawOverview))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.analytics.overview()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/analytics/overview`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(result.stats).toHaveLength(1)
    expect(result.stats[0].label).toBe('Jobs done')
  })

  it('analytics.overview(range) appends range param to URL', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ stats: [], series: [] }))
    const repos = createHttpRepos(BASE, () => TOKEN)
    await repos.analytics.overview('month')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/analytics/overview?range=month`)
  })

  it('analytics.helpers() calls GET /v1/analytics/helpers and returns HelperStat[]', async () => {
    const rawHelpers: HelperStat[] = [
      { helperId: 'h-1', name: 'Chief', jobs: 10, success: 90, tokens: 1000, spend: 50 },
    ]
    fetchMock.mockResolvedValueOnce(okJson(rawHelpers))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.analytics.helpers()

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/analytics/helpers`)
    expect(result).toHaveLength(1)
    expect(result[0].helperId).toBe('h-1')
    expect(result[0].spend).toBe(50)
  })

  it('analytics.helpers(range) appends range param', async () => {
    fetchMock.mockResolvedValueOnce(okJson([]))
    const repos = createHttpRepos(BASE, () => TOKEN)
    await repos.analytics.helpers('day')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/analytics/helpers?range=day`)
  })

  // ── P8 skills ──────────────────────────────────────────────────────────────

  it('skills.list() calls GET /v1/skills with Bearer and returns Skill[]', async () => {
    const rawSkills: Skill[] = [{
      id: 'skl-1', name: 'Passkeys', status: 'active',
      version: 1, helperId: 'h-dev', usageCount: 3,
    }]
    fetchMock.mockResolvedValueOnce(okJson(rawSkills))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.skills.list()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/skills`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(result).toHaveLength(1)
    expect(result[0].helperId).toBe('h-dev')
    expect(result[0].usageCount).toBe(3)
  })

  it('skills.get(id) calls GET /v1/skills/{id} and returns Skill', async () => {
    const rawSkill: Skill = {
      id: 'skl-1', name: 'Passkeys', status: 'active', version: 1,
      helperId: 'h-dev', usageCount: 3, bodyMd: 'Do the thing.',
    }
    fetchMock.mockResolvedValueOnce(okJson(rawSkill))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.skills.get('skl-1')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/skills/skl-1`)
    expect(result!.bodyMd).toBe('Do the thing.')
  })

  it('skills.get("missing") resolves to null on 404', async () => {
    fetchMock.mockResolvedValueOnce(notFound())
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.skills.get('missing')
    expect(result).toBeNull()
  })

  it('skills.get() throws ApiError on non-OK non-404', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    const repos = createHttpRepos(BASE, () => TOKEN)
    await expect(repos.skills.get('skl-1')).rejects.toBeInstanceOf(ApiError)
  })

  // ── P8 helpers (team) ──────────────────────────────────────────────────────

  it('helpers.list() calls GET /v1/helpers with Bearer and returns Helper[]', async () => {
    const rawHelpers: Helper[] = [{
      id: 'h-chief', name: 'Chief', area: 'brand',
      role: 'Chief of Staff', status: 'active', isChief: true,
      jobs: 80, success: 96,
    }]
    fetchMock.mockResolvedValueOnce(okJson(rawHelpers))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.helpers.list()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/helpers`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(result).toHaveLength(1)
    expect(result[0].isChief).toBe(true)
    expect(result[0].jobs).toBe(80)
  })

  it('helpers.get(id) calls GET /v1/helpers/{id} and unwraps {helper}', async () => {
    const rawHelper: Helper = {
      id: 'h-chief', name: 'Chief', area: 'brand',
      role: 'Chief of Staff', status: 'active', isChief: true,
    }
    fetchMock.mockResolvedValueOnce(okJson({ helper: rawHelper, jobs: [], skills: [] }))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.helpers.get('h-chief')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/helpers/h-chief`)
    expect(result!.id).toBe('h-chief')
    expect(result!.isChief).toBe(true)
  })

  it('helpers.get("missing") resolves to null on 404', async () => {
    fetchMock.mockResolvedValueOnce(notFound())
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.helpers.get('missing')
    expect(result).toBeNull()
  })

  it('helpers.get() throws ApiError on non-OK non-404', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    const repos = createHttpRepos(BASE, () => TOKEN)
    await expect(repos.helpers.get('h-chief')).rejects.toBeInstanceOf(ApiError)
  })

  // ── P13 members ────────────────────────────────────────────────────────────

  it('members.list() calls GET /v1/members and maps snake→camel', async () => {
    const raw = [{ id: 'mem-1', user_id: 'usr-1', name: 'Dede Kurniawan', email: 'dede@saga.co.id', role: 'owner' }]
    fetchMock.mockResolvedValueOnce(okJson(raw))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const result = await repos.members.list()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/v1/members`)
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(result).toHaveLength(1)
    const m = result[0] as CompanyMember
    expect(m.userId).toBe('usr-1')
    expect(m.name).toBe('Dede Kurniawan')
    expect((m as unknown as Record<string, unknown>).user_id).toBeUndefined()
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

    // billing plans + subscription
    if (path === '/v1/billing/plans') return Promise.resolve(okJson([rawBillingPlan]))
    if (path === '/v1/billing/subscription') return Promise.resolve(okJson(rawBillingSubscription))

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

    // flows
    if (path === '/v1/flows') return Promise.resolve(okJson([rawFlow]))
    if (path === `/v1/flows/${rawFlow.id}`) return Promise.resolve(okJson(rawFlow))
    if (path.match(/^\/v1\/flows\/[^/]+\/runs$/)) return Promise.resolve(okJson([]))
    if (path.match(/^\/v1\/flows\/.+$/) && !path.includes('/runs') && !path.includes('/publish') && !path.includes('/run') && !path.includes('/test-run')) return Promise.resolve(notFound())

    // routines
    if (path === '/v1/routines') return Promise.resolve(okJson([rawRoutine]))
    if (path === `/v1/routines/${rawRoutine.id}`) return Promise.resolve(okJson({ routine: rawRoutine, runs: [] }))
    if (path.match(/^\/v1\/routines\/.+$/) && !path.includes('/run-now')) return Promise.resolve(notFound())

    // knowledge
    if (path === '/v1/knowledge/sources') return Promise.resolve(okJson([rawKbSource]))
    if (path === '/v1/knowledge') return Promise.resolve(okJson([rawKbItem]))

    // analytics
    if (path === '/v1/analytics/overview') return Promise.resolve(okJson(rawAnalyticsOverview))
    if (path === '/v1/analytics/helpers') return Promise.resolve(okJson(rawAnalyticsHelpers))

    // skills
    if (path === '/v1/skills') return Promise.resolve(okJson([rawSkill]))
    if (path === `/v1/skills/${rawSkill.id}`) return Promise.resolve(okJson(rawSkill))
    if (path.match(/^\/v1\/skills\/.+$/) && !path.includes('/publish')) return Promise.resolve(notFound())

    // helpers (team)
    if (path === '/v1/helpers') return Promise.resolve(okJson([rawHelper]))
    if (path === `/v1/helpers/${rawHelper.id}`) return Promise.resolve(okJson({ helper: rawHelper, jobs: [], skills: [] }))
    if (path.match(/^\/v1\/helpers\/.+$/)) return Promise.resolve(notFound())

    // members
    if (path === '/v1/members') return Promise.resolve(okJson([rawMember]))

    return Promise.resolve(notFound())
  })

  vi.stubGlobal('fetch', fetchMock)
  afterEach(() => vi.unstubAllGlobals())

  return createHttpRepos(BASE, () => TOKEN)
})

// ── sweep/docs ──────────────────────────────────────────────────────────────

describe('httpRepos — docs, lessons, handbook (sweep/docs)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const rawDoc = {
    id: 'mem_1', path: 'Docs/doc/a.md', title: 'A', content: 'See [[B]]', kind: 'doc', area: 'ch-1',
    pinned: true, hidden: false, helper_id: null, version: 2, updatedAt: '2026-10-28T00:00:00Z',
    updatedBy: 'operator:u1', createdAt: '2026-10-01T00:00:00Z', createdBy: 'operator:u1',
  }

  it('docs.get maps the doc and its links; 404 → null', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ ...rawDoc, links: [{ id: 'mem_2', title: 'B', kind: 'doc' }], goals: [], unresolved: ['C'], backlinks: [] }))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const d = await repos.docs!.get('mem_1')
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`${BASE}/v1/memory/mem_1`)
    expect(d!.helperId).toBeNull()
    expect(d!.links[0].title).toBe('B')
    expect(d!.unresolved).toEqual(['C'])
    fetchMock.mockResolvedValueOnce(notFound())
    expect(await repos.docs!.get('missing')).toBeNull()
  })

  it('lessons.list passes status and maps snake→camel', async () => {
    fetchMock.mockResolvedValueOnce(okJson([{ id: 'les_1', helper_id: 'h1', tag: 'lesson', text: 'x', source: 's', status: 'review', created_by: 'system', created_at: null }]))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const out = await repos.lessons!.list({ status: 'review' })
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`${BASE}/v1/lessons?status=review`)
    expect(out[0].helperId).toBe('h1')
  })

  it('handbook.index maps files and the open-suggestion count', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      files: [{ id: 'mem_h', name: 'POLICIES.md', title: 'Policies', description: 'd', visibility: 'everyone', brief: false, version: 3, updated_at: null, updated_by: 'system', open_suggestions: 1 }],
      open_suggestions: 1,
    }))
    const repos = createHttpRepos(BASE, () => TOKEN)
    const idx = await repos.handbook!.index()
    expect(idx.openSuggestions).toBe(1)
    expect(idx.files[0].openSuggestions).toBe(1)
  })
})
