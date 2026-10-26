import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHttpRepos } from './httpRepos'
import { runReposContract } from '../../core/ports/repos.contract'
import type { Channel, InboxItem, Session } from '../../core/domain/types'

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
  agentCount: 0, chatCount: 5, openItems: 1,
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
})

// ── contract suite against the http impl (mocked fetch) ───────────────────────

runReposContract('http (mocked fetch)', () => {
  const fetchMock = vi.fn((url: string) => {
    const path = (url as string).replace(BASE, '')

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

    return Promise.resolve(notFound())
  })

  vi.stubGlobal('fetch', fetchMock)
  afterEach(() => vi.unstubAllGlobals())

  return createHttpRepos(BASE, () => TOKEN)
})
