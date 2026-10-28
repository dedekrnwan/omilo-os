/**
 * Shared commands factory for control-panel sections.
 *
 * Both SectionConnectors and SectionMcpTokens need a Commands client wired to
 * the same base URL + token source.  Centralise the three lines here so they
 * are not copy-pasted per section.
 */

import { createCommands } from '../../../adapters/http/commands'
import { platform } from '../../../platform'

const BASE_URL =
  (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ??
  'http://localhost:8000'

function getToken(): string | null {
  return platform.tokenStorage.getToken()
}

/** Returns a Commands client bound to the app's API base URL and token. */
export function getCommands() {
  return createCommands(BASE_URL, getToken)
}
