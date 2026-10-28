/**
 * posthog.ts — lazy posthog-js wrapper.
 *
 * This file is imported ONLY via dynamic import() inside initTelemetry,
 * so a disabled/local build never evaluates posthog-js code.
 * The wrapper exposes the subset of PostHog we need.
 */

import posthog from 'posthog-js'

export interface PostHogWrapper {
  init(key: string, host: string): void
  capture(event: string, props: Record<string, unknown>): void
  optOut(): void
  optIn(): void
}

export function createPostHogWrapper(): PostHogWrapper {
  return {
    init(key: string, host: string) {
      posthog.init(key, {
        api_host: host,
        // Disable automatic pageview tracking — we emit structured funnel events
        capture_pageview: false,
        // Don't load any session recording — privacy
        disable_session_recording: true,
        // Batch events; do not send immediately to avoid slowing page interactions
        request_batching: true,
      })
    },
    capture(event: string, props: Record<string, unknown>) {
      posthog.capture(event, props)
    },
    optOut() {
      posthog.opt_out_capturing()
    },
    optIn() {
      posthog.opt_in_capturing()
    },
  }
}
