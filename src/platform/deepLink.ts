/**
 * deepLink.ts — pure, throw-safe `omilo://` deep-link parser shared by web and Tauri.
 *
 * SECURITY: only allow-listed hosts are mapped to internal routes.
 * Unknown host, unknown scheme, or malformed input → null (never throws).
 * Open-redirect is impossible: the output `route` is always a safe internal path,
 * never constructed from the raw URL.
 */

export interface ParsedDeepLink {
  route: string
  params: Record<string, string>
}

/** Host → internal route map. Add new hosts here; unknown hosts are rejected. */
const HOST_ROUTES: Record<string, string> = {
  approve: '/inbox',
  inbox:   '/inbox',
  auth:    '/auth',
  chat:    '/chat',
}

/**
 * Parse an `omilo://` deep link into a safe internal route + params.
 *
 * @example
 *   parseDeepLink('omilo://approve/prop_123')
 *   // → { route: '/inbox', params: { proposalId: 'prop_123' } }
 *
 *   parseDeepLink('https://evil.com')     // → null
 *   parseDeepLink('omilo://unknownhost')  // → null
 *   parseDeepLink('omilo://%%bad')        // → null (throw-safe)
 */
export function parseDeepLink(url: string): ParsedDeepLink | null {
  try {
    // URL API handles parsing; it throws on truly malformed input.
    const parsed = new URL(url)

    if (parsed.protocol !== 'omilo:') return null

    const host = parsed.hostname
    const route = HOST_ROUTES[host]
    if (!route) return null

    // Build params from query string (safe — only from ?key=value pairs).
    const params: Record<string, string> = {}
    parsed.searchParams.forEach((value, key) => {
      params[key] = value
    })

    // For the `approve` host, treat the first path segment as proposalId.
    if (host === 'approve') {
      // pathname is e.g. "/prop_123" — strip leading slash.
      const seg = parsed.pathname.replace(/^\//, '').split('/')[0]
      if (seg) {
        params['proposalId'] = seg
      }
    }

    return { route, params }
  } catch {
    return null
  }
}
