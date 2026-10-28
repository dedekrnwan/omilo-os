/**
 * telemetry.test.ts — unit tests for the frontend telemetry seam (P7 Task 2).
 *
 * Runs in jsdom. Stubs posthog-js so no real network is made.
 * Verifies:
 *   - initTelemetry({enabled:false,...})  → posthog-js init NOT called
 *   - initTelemetry({mode:'local',...})   → NOT called (local off-by-default)
 *   - DNT navigator.doNotTrack='1'        → NOT called even if enabled
 *   - initTelemetry({enabled:true, mode:'hybrid', key:'phc_x', host:'h'}) → init called
 *   - capture('message_sent', {text:'secret', count:1}) → 'text' dropped, 'count' would
 *     be dropped too (not in allowlist for message_sent), props = {}
 *   - optOut() → subsequent capture is a no-op (posthog capture not called)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── stub posthog-js ────────────────────────────────────────────────────────────
// We stub the module BEFORE importing telemetry so the lazy import resolves
// to our stub. Vitest hoists vi.mock() calls to the top of the file.

const mockPosthogInit = vi.fn()
const mockPosthogCapture = vi.fn()
const mockPosthogOptOut = vi.fn()
const mockPosthogOptIn = vi.fn()
const mockPosthogHasOptedOut = vi.fn(() => false)

vi.mock('posthog-js', () => ({
  default: {
    init: mockPosthogInit,
    capture: mockPosthogCapture,
    opt_out_capturing: mockPosthogOptOut,
    opt_in_capturing: mockPosthogOptIn,
    has_opted_out_capturing: mockPosthogHasOptedOut,
  },
}))

// ── import after mocks ────────────────────────────────────────────────────────

// We import the telemetry module AFTER the mock is set up.
// Because initTelemetry is stateful (module-level initialized flag),
// each test resets module state via resetTelemetryForTest.
import {
  initTelemetry,
  capture,
  optOut,
  optIn,
  resetTelemetryForTest,
} from './index'

import type { TelemetryConfig } from './index'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<TelemetryConfig> = {}): TelemetryConfig {
  return {
    enabled: true,
    key: 'phc_testkey',
    host: 'https://eu.posthog.com',
    mode: 'hybrid',
    optedOut: false,
    ...overrides,
  }
}

beforeEach(() => {
  resetTelemetryForTest()
  mockPosthogInit.mockClear()
  mockPosthogCapture.mockClear()
  mockPosthogOptOut.mockClear()
  mockPosthogOptIn.mockClear()
  mockPosthogHasOptedOut.mockClear()
  // Reset DNT to null (not set)
  Object.defineProperty(navigator, 'doNotTrack', {
    value: null,
    configurable: true,
    writable: true,
  })
})

// ── gating: disabled ──────────────────────────────────────────────────────────

describe('initTelemetry — gating', () => {
  it('does NOT init posthog when enabled=false', async () => {
    await initTelemetry(makeConfig({ enabled: false, key: null }))
    expect(mockPosthogInit).not.toHaveBeenCalled()
  })

  it('does NOT init posthog when mode=local (even if enabled=true)', async () => {
    await initTelemetry(makeConfig({ mode: 'local' }))
    expect(mockPosthogInit).not.toHaveBeenCalled()
  })

  it('does NOT init posthog when key is null (even if enabled=true)', async () => {
    await initTelemetry(makeConfig({ key: null }))
    expect(mockPosthogInit).not.toHaveBeenCalled()
  })

  it('does NOT init posthog when optedOut=true', async () => {
    await initTelemetry(makeConfig({ optedOut: true }))
    expect(mockPosthogInit).not.toHaveBeenCalled()
  })

  it('does NOT init posthog when Do-Not-Track is "1"', async () => {
    Object.defineProperty(navigator, 'doNotTrack', {
      value: '1',
      configurable: true,
      writable: true,
    })
    await initTelemetry(makeConfig())
    expect(mockPosthogInit).not.toHaveBeenCalled()
  })

  it('DOES init posthog when enabled=true, mode=hybrid, key present, DNT not set', async () => {
    await initTelemetry(makeConfig())
    expect(mockPosthogInit).toHaveBeenCalledOnce()
    expect(mockPosthogInit).toHaveBeenCalledWith(
      'phc_testkey',
      expect.objectContaining({ api_host: 'https://eu.posthog.com' }),
    )
  })

  it('DOES init posthog when enabled=true, mode=cloud', async () => {
    await initTelemetry(makeConfig({ mode: 'cloud' }))
    expect(mockPosthogInit).toHaveBeenCalledOnce()
  })
})

// ── content-free allowlist ────────────────────────────────────────────────────

describe('capture — allowlist guard', () => {
  it('drops non-allowlisted props (text is not in message_sent allowlist)', async () => {
    await initTelemetry(makeConfig())
    capture('message_sent', { text: 'secret content', count: 99, extra: 'bad' })
    // message_sent allowlist = {} (no props allowed for this event)
    expect(mockPosthogCapture).toHaveBeenCalledWith('message_sent', {})
  })

  it('passes allowlisted props for onboarding_step', async () => {
    await initTelemetry(makeConfig())
    capture('onboarding_step', { step: 'welcome', secret: 'evil' })
    expect(mockPosthogCapture).toHaveBeenCalledWith('onboarding_step', { step: 'welcome' })
  })

  it('passes allowlisted props for connector_installed', async () => {
    await initTelemetry(makeConfig())
    capture('connector_installed', { piece: 'google-drive', secret: 'evil' })
    expect(mockPosthogCapture).toHaveBeenCalledWith('connector_installed', { piece: 'google-drive' })
  })

  it('passes allowlisted props for plan_changed', async () => {
    await initTelemetry(makeConfig())
    capture('plan_changed', { plan: 'pro', other: 'stripped' })
    expect(mockPosthogCapture).toHaveBeenCalledWith('plan_changed', { plan: 'pro' })
  })

  it('is a no-op if not initialized', () => {
    // no initTelemetry called
    capture('message_sent', { count: 1 })
    expect(mockPosthogCapture).not.toHaveBeenCalled()
  })

  it('is a no-op when telemetry disabled (mode=local)', async () => {
    await initTelemetry(makeConfig({ mode: 'local' }))
    capture('message_sent', {})
    expect(mockPosthogCapture).not.toHaveBeenCalled()
  })
})

// ── opt-out ───────────────────────────────────────────────────────────────────

describe('optOut / optIn', () => {
  it('optOut() makes subsequent capture a no-op', async () => {
    await initTelemetry(makeConfig())
    optOut()
    capture('message_sent', {})
    expect(mockPosthogCapture).not.toHaveBeenCalled()
    expect(mockPosthogOptOut).toHaveBeenCalledOnce()
  })

  it('optIn() re-enables capture after optOut', async () => {
    await initTelemetry(makeConfig())
    optOut()
    optIn()
    capture('onboarding_completed', {})
    expect(mockPosthogCapture).toHaveBeenCalledWith('onboarding_completed', {})
    expect(mockPosthogOptIn).toHaveBeenCalledOnce()
  })

  it('optOut() without init does not throw', () => {
    expect(() => optOut()).not.toThrow()
  })
})
