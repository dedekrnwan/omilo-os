/**
 * HTTP mutations client for the omilo-v2 backend API.
 *
 * Implements write-side commands (sendMessage, createSession, approveProposal,
 * rejectProposal, requestChanges) against the P1 endpoints defined in
 * docs/technical/02-api-contracts.md §4 + §6.
 *
 * Reuses `apiFetch` from ./client for auth header attachment and error mapping.
 * All camelCase input is mapped to snake_case body keys before sending, and
 * snake_case response fields are mapped back to camelCase.
 */

import type { Message, Session } from '../../core/domain/types'
import { apiFetch } from './client'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a POST RequestInit with JSON body and Content-Type header. */
function postJson(body: unknown, extraHeaders?: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  }
}

// ── factory ───────────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  channelId?: string
  goalId?: string
  title?: string
  scope?: string
}

export interface Commands {
  createSession(input: CreateSessionInput): Promise<Session>
  sendMessage(sessionId: string, content: string): Promise<{ message: Message; jobId: string }>
  approveProposal(proposalId: string, note?: string): Promise<{ executionJobId: string }>
  rejectProposal(proposalId: string, note: string): Promise<void>
  requestChanges(proposalId: string, note: string): Promise<void>
}

/**
 * Creates a Commands client that calls the real backend over HTTP.
 *
 * @param baseUrl  - e.g. "http://localhost:8000"
 * @param getToken - returns the current JWT or null when unauthenticated
 */
export function createCommands(
  baseUrl: string,
  getToken: () => string | null,
): Commands {
  async function post<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const res = await apiFetch(
      `${baseUrl}${path}`,
      getToken,
      postJson(body, extraHeaders),
    )
    return res.json() as Promise<T>
  }

  return {
    /**
     * POST /v1/sessions → Session
     * Maps camelCase input → snake_case body as the API expects.
     */
    async createSession(input: CreateSessionInput): Promise<Session> {
      const body: Record<string, unknown> = {}
      if (input.channelId !== undefined) body.channel_id = input.channelId
      if (input.goalId !== undefined) body.goal_id = input.goalId
      if (input.title !== undefined) body.title = input.title
      if (input.scope !== undefined) body.scope = input.scope
      return post<Session>('/v1/sessions', body)
    },

    /**
     * POST /v1/sessions/{sessionId}/messages {content}
     * Returns {message, jobId} — jobId mapped from job_id.
     */
    async sendMessage(
      sessionId: string,
      content: string,
    ): Promise<{ message: Message; jobId: string }> {
      const raw = await post<{ message: Message; job_id: string }>(
        `/v1/sessions/${sessionId}/messages`,
        { content },
      )
      return { message: raw.message, jobId: raw.job_id }
    },

    /**
     * POST /v1/proposals/{proposalId}/approve {note?}
     * Requires an Idempotency-Key header (stable per proposal).
     * Returns {executionJobId} mapped from execution_job_id.
     */
    async approveProposal(
      proposalId: string,
      note?: string,
    ): Promise<{ executionJobId: string }> {
      const body: Record<string, unknown> = {}
      if (note !== undefined) body.note = note
      const raw = await post<{ proposal: unknown; execution_job_id: string }>(
        `/v1/proposals/${proposalId}/approve`,
        body,
        { 'Idempotency-Key': `approve-${proposalId}` },
      )
      return { executionJobId: raw.execution_job_id }
    },

    /**
     * POST /v1/proposals/{proposalId}/reject {note}
     */
    async rejectProposal(proposalId: string, note: string): Promise<void> {
      await post(`/v1/proposals/${proposalId}/reject`, { note })
    },

    /**
     * POST /v1/proposals/{proposalId}/request-changes {note}
     */
    async requestChanges(proposalId: string, note: string): Promise<void> {
      await post(`/v1/proposals/${proposalId}/request-changes`, { note })
    },
  }
}
