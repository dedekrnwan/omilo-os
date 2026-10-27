import { describe, it, expect } from 'vitest'
import type { Repos } from './repos'

export function runReposContract(name: string, makeRepos: () => Repos): void {
  describe(`Repos contract: ${name}`, () => {
    it('channels.list() returns a non-empty array', async () => {
      const repos = makeRepos()
      const channels = await repos.channels.list()
      expect(Array.isArray(channels)).toBe(true)
      expect(channels.length).toBeGreaterThan(0)
    })

    it('channels.get(unknownId) resolves to null', async () => {
      const repos = makeRepos()
      const unknownId = 'unknown-channel-id-' + Math.random()
      const channel = await repos.channels.get(unknownId)
      expect(channel).toBeNull()
    })

    it('sessions.get(unknownId) resolves to null', async () => {
      const repos = makeRepos()
      const unknownId = 'unknown-session-id-' + Math.random()
      const session = await repos.sessions.get(unknownId)
      expect(session).toBeNull()
    })

    it('messages.listBySession(unknownId) resolves to an empty array', async () => {
      const repos = makeRepos()
      const unknownId = 'unknown-session-id-' + Math.random()
      const messages = await repos.messages.listBySession(unknownId)
      expect(Array.isArray(messages)).toBe(true)
      expect(messages.length).toBe(0)
    })

    it('inbox.list() returns items and every item\'s sessionId resolves via sessions.get to a non-null session', async () => {
      const repos = makeRepos()
      const items = await repos.inbox.list()
      expect(Array.isArray(items)).toBe(true)
      expect(items.length).toBeGreaterThan(0)

      // Every inbox item's sessionId must resolve to a non-null session
      for (const item of items) {
        const session = await repos.sessions.get(item.sessionId)
        expect(session).not.toBeNull()
        expect(session?.id).toBe(item.sessionId)
      }
    })

    // ── usage ──────────────────────────────────────────────────────────────

    it('usage.get() returns a UsageSummary with numeric balance and arrays', async () => {
      const repos = makeRepos()
      const usage = await repos.usage.get()
      expect(typeof usage.balance).toBe('number')
      expect(typeof usage.included).toBe('number')
      expect(typeof usage.usedThisPeriod).toBe('number')
      expect(Array.isArray(usage.byHelper)).toBe(true)
      expect(Array.isArray(usage.byDay)).toBe(true)
    })

    // ── wallet ─────────────────────────────────────────────────────────────

    it('wallet.get() returns a WalletSettings with autoTopupEnabled boolean', async () => {
      const repos = makeRepos()
      const wallet = await repos.wallet.get()
      expect(typeof wallet.autoTopupEnabled).toBe('boolean')
      expect(typeof wallet.autoTopupThresholdCredits).toBe('number')
    })

    // ── aiAccounts ─────────────────────────────────────────────────────────

    it('aiAccounts.list() returns an array; each item has id, harness, name, status, pctWindow', async () => {
      const repos = makeRepos()
      const accounts = await repos.aiAccounts.list()
      expect(Array.isArray(accounts)).toBe(true)
      expect(accounts.length).toBeGreaterThan(0)
      for (const acc of accounts) {
        expect(typeof acc.id).toBe('string')
        expect(typeof acc.harness).toBe('string')
        expect(typeof acc.name).toBe('string')
        expect(typeof acc.status).toBe('string')
        expect(typeof acc.pctWindow).toBe('number')
      }
    })

    // ── marketplace ────────────────────────────────────────────────────────

    it('marketplace.list() returns an array; each item has id, label, category, description, actionCount', async () => {
      const repos = makeRepos()
      const pieces = await repos.marketplace.list()
      expect(Array.isArray(pieces)).toBe(true)
      expect(pieces.length).toBeGreaterThan(0)
      for (const piece of pieces) {
        expect(typeof piece.id).toBe('string')
        expect(typeof piece.label).toBe('string')
        expect(typeof piece.category).toBe('string')
        expect(typeof piece.description).toBe('string')
        expect(typeof piece.actionCount).toBe('number')
      }
    })

    it('marketplace.list(params) accepts optional params without throwing', async () => {
      const repos = makeRepos()
      const pieces = await repos.marketplace.list({ category: 'communication' })
      expect(Array.isArray(pieces)).toBe(true)
    })

    // ── connectors ─────────────────────────────────────────────────────────

    it('connectors.list() returns an array; each item has id, pieceId, label, source, status, enabled', async () => {
      const repos = makeRepos()
      const connectors = await repos.connectors.list()
      expect(Array.isArray(connectors)).toBe(true)
      expect(connectors.length).toBeGreaterThan(0)
      for (const con of connectors) {
        expect(typeof con.id).toBe('string')
        expect(typeof con.pieceId).toBe('string')
        expect(typeof con.label).toBe('string')
        expect(typeof con.source).toBe('string')
        expect(typeof con.status).toBe('string')
        expect(typeof con.enabled).toBe('boolean')
      }
    })

    // ── mcpTokens ──────────────────────────────────────────────────────────

    it('mcpTokens.list() returns an array; each item has id, label, helperId, scopes, active', async () => {
      const repos = makeRepos()
      const tokens = await repos.mcpTokens.list()
      expect(Array.isArray(tokens)).toBe(true)
      expect(tokens.length).toBeGreaterThan(0)
      for (const tok of tokens) {
        expect(typeof tok.id).toBe('string')
        expect(typeof tok.label).toBe('string')
        expect(typeof tok.helperId).toBe('string')
        expect(Array.isArray(tok.scopes)).toBe(true)
        expect(typeof tok.active).toBe('boolean')
      }
    })
  })
}
