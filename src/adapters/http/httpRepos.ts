/**
 * HTTP implementation of the Repos port.
 *
 * Maps every port method to the §2 read endpoints defined in
 * docs/technical/02-api-contracts.md.  Response JSON is structurally
 * identical to the TS domain types (camelCase), so no transformation is
 * needed — parse and return as the typed value.
 *
 * 404 responses on .get() methods resolve to null instead of throwing.
 */

import type {
  Channel, Folder, Goal, Id, Message, Session, InboxItem,
} from '../../core/domain/types'
import type { Repos } from '../../core/ports/repos'
import { apiFetch, ApiError } from './client'

/**
 * Creates a Repos implementation that calls the real backend over HTTP.
 *
 * @param baseUrl  - e.g. "http://localhost:8000"
 * @param getToken - returns the current JWT or null when unauthenticated
 */
export function createHttpRepos(
  baseUrl: string,
  getToken: () => string | null,
): Repos {
  async function get<T>(path: string): Promise<T> {
    const res = await apiFetch(`${baseUrl}${path}`, getToken)
    return res.json() as Promise<T>
  }

  async function getOrNull<T>(path: string): Promise<T | null> {
    try {
      const res = await apiFetch(`${baseUrl}${path}`, getToken)
      return res.json() as Promise<T>
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  }

  return {
    channels: {
      list: () => get<Channel[]>('/v1/channels'),
      get: (id: Id) => getOrNull<Channel>(`/v1/channels/${id}`),
    },

    folders: {
      listByChannel: (channelId: Id) =>
        get<Folder[]>(`/v1/channels/${channelId}/folders`),
      listAll: () => get<Folder[]>('/v1/folders'),
    },

    goals: {
      listByChannel: (channelId: Id) =>
        get<Goal[]>(`/v1/channels/${channelId}/goals`),
      listAll: () => get<Goal[]>('/v1/goals'),
    },

    sessions: {
      get: (id: Id) => getOrNull<Session>(`/v1/sessions/${id}`),
      listByChannel: (channelId: Id) =>
        get<Session[]>(`/v1/channels/${channelId}/sessions`),
      listAll: () => get<Session[]>('/v1/sessions'),
    },

    messages: {
      listBySession: (sessionId: Id) =>
        get<Message[]>(`/v1/sessions/${sessionId}/messages`),
    },

    inbox: {
      list: () => get<InboxItem[]>('/v1/inbox'),
      get: (id: Id) => getOrNull<InboxItem>(`/v1/inbox/${id}`),
    },
  }
}
