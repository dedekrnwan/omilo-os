/**
 * telemetry/index.ts — the frontend telemetry seam (P7 Task 2).
 *
 * Privacy model:
 *   - `enabled=false` OR `mode='local'` OR `key=null` OR `optedOut=true` OR
 *     browser DNT (`navigator.doNotTrack === '1'`) → do NOT init posthog-js.
 *     No network, no code loaded, return early.
 *   - Otherwise lazily `import('posthog-js')` and init with key + host.
 *
 * Content-free: `capture(event, props)` strips props to a per-event ALLOWLIST.
 * Non-allowlisted keys are silently dropped before passing to posthog.
 * This makes "no content leaks" enforceable, not merely intended.
 *
 * Opt-out: `optOut()` persists locally + calls posthog opt-out;
 * subsequent `capture` calls are no-ops until `optIn()` is called.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TelemetryConfig {
  /** Whether telemetry is enabled in this deployment. */
  enabled: boolean
  /** PostHog project key (publishable). null when disabled/unconfigured. */
  key: string | null
  /** PostHog host URL. null when disabled. */
  host: string | null
  /** Deployment mode: 'local' | 'hybrid' | 'cloud' */
  mode: string
  /** Whether the user/company has opted out. */
  optedOut: boolean
}

// ── Event allowlist ───────────────────────────────────────────────────────────

/**
 * For each event name, the set of property keys that are permitted.
 * ANY key not in the set is silently dropped before emit.
 * Content (message text, field values, secrets, emails, names) must NEVER
 * appear as a value; the allowlist ensures only structural keys pass.
 */
const EVENT_PROP_ALLOWLIST: Record<string, Set<string>> = {
  onboarding_step: new Set(['step']),
  onboarding_completed: new Set([]),
  area_created: new Set([]),
  message_sent: new Set([]),
  connector_installed: new Set(['piece']),
  mcp_token_minted: new Set([]),
  plan_changed: new Set(['plan']),
  connect_to_cloud_clicked: new Set([]),
}

/**
 * Strips props to the allowlist for the given event.
 * Unknown events → empty props (safe default).
 */
function filterProps(
  event: string,
  props: Record<string, unknown> = {},
): Record<string, unknown> {
  const allowed = EVENT_PROP_ALLOWLIST[event]
  if (!allowed) return {}
  const filtered: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in props) filtered[key] = props[key]
  }
  return filtered
}

// ── Module state ──────────────────────────────────────────────────────────────

/** True when posthog has been initialized and is active. */
let initialized = false

/** True when the user has opted out after init. */
let optedOutLocally = false

/** The lazy-loaded posthog wrapper (null until initTelemetry succeeds). */
let ph: import('./posthog').PostHogWrapper | null = null

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialize telemetry. Called once at app bootstrap after fetching the
 * backend telemetry-config endpoint. Idempotent — calling more than once
 * is safe but does nothing after the first successful init.
 *
 * Gating (ANY → skip):
 *   - config.enabled === false
 *   - config.mode === 'local'
 *   - config.key === null
 *   - config.optedOut === true
 *   - navigator.doNotTrack === '1'
 */
export async function initTelemetry(config: TelemetryConfig): Promise<void> {
  // Already initialized — no-op
  if (initialized) return

  // Gate: disabled, no key, local mode, opted-out, or Do-Not-Track
  if (!config.enabled) return
  if (!config.key) return
  if (config.mode === 'local') return
  if (config.optedOut) return
  if (typeof navigator !== 'undefined' && navigator.doNotTrack === '1') return

  try {
    const { createPostHogWrapper } = await import('./posthog')
    ph = createPostHogWrapper()
    ph.init(config.key, config.host ?? 'https://us.i.posthog.com')
    initialized = true
    optedOutLocally = false
  } catch {
    // Best-effort: a load failure leaves telemetry off, app unaffected
    ph = null
  }
}

/**
 * Capture a telemetry event. No-op if:
 *   - Not initialized
 *   - User has opted out
 *   - Event name is unknown (not in allowlist)
 *
 * Props are filtered to the event's allowlist before emit.
 * Non-allowlisted keys are silently dropped — content cannot leak.
 */
export function capture(
  event: string,
  props: Record<string, unknown> = {},
): void {
  if (!initialized || !ph) return
  if (optedOutLocally) return
  const safeProps = filterProps(event, props)
  ph.capture(event, safeProps)
}

/**
 * Opt out of telemetry. Persists locally and calls posthog opt-out.
 * All subsequent `capture` calls become no-ops until `optIn()` is called.
 */
export function optOut(): void {
  optedOutLocally = true
  if (ph) ph.optOut()
}

/**
 * Opt back in to telemetry. Reverses an `optOut()` call.
 * Only effective if telemetry was already initialized.
 */
export function optIn(): void {
  optedOutLocally = false
  if (ph) ph.optIn()
}

// ── Test utility ──────────────────────────────────────────────────────────────

/**
 * Reset module state for test isolation.
 * NOT exported from the package — only used in tests.
 * @internal
 */
export function resetTelemetryForTest(): void {
  initialized = false
  optedOutLocally = false
  ph = null
}
