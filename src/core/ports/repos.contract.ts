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
  })
}
