/**
 * bootstrap.ts — best-effort telemetry bootstrap called at app startup.
 *
 * Fetches GET /v1/telemetry-config from the backend and passes the result to
 * initTelemetry. If the fetch fails for any reason, telemetry stays off and
 * the app is unaffected.
 *
 * This module never throws.
 */

import { initTelemetry } from './index'
import type { TelemetryConfig } from './index'
import { platform } from '../platform'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

interface RawTelemetryConfig {
  enabled: boolean
  key: string | null
  host: string | null
  mode: string
  opted_out: boolean
}

/**
 * Fetch and init telemetry. Best-effort — any failure is swallowed.
 * Called once at app startup (main.tsx), fire-and-forget.
 */
export function bootstrapTelemetry(): void {
  void (async () => {
    try {
      // The config endpoint is company-scoped (Bearer session required). Attach
      // the stored token when present; without it the fetch 401s and telemetry
      // stays off (fail-safe) until a later bootstrap once the user is signed in.
      const token = platform.tokenStorage.getToken()
      const res = await fetch(`${BASE_URL}/v1/telemetry-config`, {
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (!res.ok) return
      const raw = (await res.json()) as RawTelemetryConfig
      const config: TelemetryConfig = {
        enabled: raw.enabled,
        key: raw.key,
        host: raw.host,
        mode: raw.mode,
        optedOut: raw.opted_out,
      }
      await initTelemetry(config)
    } catch {
      // Swallow — telemetry stays off, app unaffected
    }
  })()
}
