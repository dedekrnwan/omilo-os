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

    // ── billingPlans ───────────────────────────────────────────────────────

    it('billingPlans.list() returns an array; each item has id, tier, monthlyPriceIdr, yearlyPriceIdr', async () => {
      const repos = makeRepos()
      const plans = await repos.billingPlans.list()
      expect(Array.isArray(plans)).toBe(true)
      expect(plans.length).toBeGreaterThan(0)
      for (const p of plans) {
        expect(typeof p.id).toBe('string')
        expect(typeof p.tier).toBe('string')
        expect(typeof p.monthlyPriceIdr).toBe('number')
        expect(typeof p.yearlyPriceIdr).toBe('number')
        expect(typeof p.trialDays).toBe('number')
      }
    })

    it('billingSubscription.get() returns a BillingSubscription or null', async () => {
      const repos = makeRepos()
      const sub = await repos.billingSubscription.get()
      if (sub !== null) {
        expect(typeof sub.planId).toBe('string')
        expect(typeof sub.isTrial).toBe('boolean')
        expect(typeof sub.trialDaysLeft).toBe('number')
        expect(typeof sub.billingInterval).toBe('string')
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

    // ── P8 new repos ──────────────────────────────────────────────────────

    // flows
    it('flows.list() returns a non-empty array; each item has id, title, status, enabled', async () => {
      const repos = makeRepos()
      const result = await repos.flows.list()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      for (const f of result) {
        expect(typeof f.id).toBe('string')
        expect(typeof f.title).toBe('string')
        expect(typeof f.status).toBe('string')
        expect(typeof f.enabled).toBe('boolean')
      }
    })

    it('flows.get(unknownId) resolves to null', async () => {
      const repos = makeRepos()
      const result = await repos.flows.get('unknown-flow-' + Math.random())
      expect(result).toBeNull()
    })

    it('flows.runs(id) returns an array (may be empty)', async () => {
      const repos = makeRepos()
      const allFlows = await repos.flows.list()
      const result = await repos.flows.runs(allFlows[0]?.id ?? 'x')
      expect(Array.isArray(result)).toBe(true)
    })

    // routines
    it('routines.list() returns a non-empty array; each item has id, name, helperId, cron', async () => {
      const repos = makeRepos()
      const result = await repos.routines.list()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      for (const r of result) {
        expect(typeof r.id).toBe('string')
        expect(typeof r.name).toBe('string')
        expect(typeof r.helperId).toBe('string')
        expect(typeof r.cron).toBe('string')
      }
    })

    it('routines.get(unknownId) resolves to null', async () => {
      const repos = makeRepos()
      const result = await repos.routines.get('unknown-routine-' + Math.random())
      expect(result).toBeNull()
    })

    // knowledge
    it('knowledge.list() returns an array; each item has sourceId, heading, text, kind, score', async () => {
      const repos = makeRepos()
      const result = await repos.knowledge.list()
      expect(Array.isArray(result)).toBe(true)
      for (const item of result) {
        expect(typeof item.sourceId).toBe('string')
        expect(typeof item.heading).toBe('string')
        expect(typeof item.text).toBe('string')
        expect(typeof item.kind).toBe('string')
        expect(typeof item.score).toBe('number')
      }
    })

    it('knowledge.sources() returns an array; each item has id, kind, title', async () => {
      const repos = makeRepos()
      const result = await repos.knowledge.sources()
      expect(Array.isArray(result)).toBe(true)
      for (const src of result) {
        expect(typeof src.id).toBe('string')
        expect(typeof src.kind).toBe('string')
        expect(typeof src.title).toBe('string')
      }
    })

    // analytics
    it('analytics.overview() returns {stats[], series[]}', async () => {
      const repos = makeRepos()
      const result = await repos.analytics.overview()
      expect(Array.isArray(result.stats)).toBe(true)
      expect(result.stats.length).toBeGreaterThan(0)
      expect(Array.isArray(result.series)).toBe(true)
      for (const stat of result.stats) {
        expect(typeof stat.label).toBe('string')
        expect(typeof stat.value).toBe('number')
      }
    })

    it('analytics.helpers() returns an array; each item has helperId, name, jobs, success, tokens, spend', async () => {
      const repos = makeRepos()
      const result = await repos.analytics.helpers()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      for (const h of result) {
        expect(typeof h.helperId).toBe('string')
        expect(typeof h.name).toBe('string')
        expect(typeof h.jobs).toBe('number')
        expect(typeof h.success).toBe('number')
        expect(typeof h.tokens).toBe('number')
        expect(typeof h.spend).toBe('number')
      }
    })

    // skills
    it('skills.list() returns a non-empty array; each item has id, name, status, version, helperId', async () => {
      const repos = makeRepos()
      const result = await repos.skills.list()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      for (const s of result) {
        expect(typeof s.id).toBe('string')
        expect(typeof s.name).toBe('string')
        expect(typeof s.status).toBe('string')
        expect(typeof s.version).toBe('number')
        expect(typeof s.helperId).toBe('string')
      }
    })

    it('skills.get(unknownId) resolves to null', async () => {
      const repos = makeRepos()
      const result = await repos.skills.get('unknown-skill-' + Math.random())
      expect(result).toBeNull()
    })

    // helpers
    it('helpers.list() returns a non-empty array; each item has id, name, area', async () => {
      const repos = makeRepos()
      const result = await repos.helpers.list()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      for (const h of result) {
        expect(typeof h.id).toBe('string')
        expect(typeof h.name).toBe('string')
        expect(typeof h.area).toBe('string')
      }
    })

    it('helpers.get(unknownId) resolves to null', async () => {
      const repos = makeRepos()
      const result = await repos.helpers.get('unknown-helper-' + Math.random())
      expect(result).toBeNull()
    })
  })
}
