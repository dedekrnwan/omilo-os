/**
 * HTTP client helper for the omilo-v2 backend API.
 *
 * Attaches Authorization: Bearer <token> when a token is available and
 * sets Accept: application/json on every request.  On non-OK responses it
 * throws an `ApiError` carrying the HTTP status and a message sourced from
 * the problem+json body when present.
 *
 * Callers that need 404 → null semantics catch `ApiError` with status 404.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiFetch(
  url: string,
  getToken: () => string | null,
  init?: RequestInit,
): Promise<Response> {
  const token = getToken()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(url, { ...init, headers })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body && typeof body === 'object') {
        // RFC 9457 problem+json: prefer detail, then title
        message = (body as Record<string, unknown>).detail as string
          ?? (body as Record<string, unknown>).title as string
          ?? message
      }
    } catch {
      // Body is not JSON — keep the default message
    }
    throw new ApiError(res.status, message)
  }

  return res
}
