/**
 * Two-step verification — /auth/two-step (ref: cewrH)
 * Shown when signing in to an account with 2FA enabled (TOTP).
 * Standalone full-screen page. No Shell / Rail.
 */

import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthLink, OtpRow, AuthCheckbox, IconBadge } from './AuthPrimitives'

export function TwoStepVerificationPage() {
  return (
    <AuthLayout>
      {/* Shield icon */}
      <IconBadge color="#F0FDF4">
        <svg width={20} height={20} viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M10 2L3 5v5c0 4 3.1 7.5 7 8.5C13.9 17.5 17 14 17 10V5l-7-3z" stroke="#15803D" strokeWidth={1.5} strokeLinejoin="round"/>
          <path d="M7 10l2 2 4-4" stroke="#15803D" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </IconBadge>

      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#0C0A09', fontFamily: 'var(--font-display, sans-serif)' }}>
        One more step
      </h1>
      <p style={{ margin: '0 0 24px', fontSize: 13.5, color: '#78716C' }}>
        You own Sahabat Warga, so we ask for a code from your authenticator app.
      </p>

      {/* OTP boxes — 6 digits, partially filled: 3 0 9 1 7 _ */}
      <OtpRow value="30917" />

      <div style={{ marginBottom: 14 }}>
        <AuthCheckbox label="Trust this device for 30 days" checked />
      </div>

      <AuthButton variant="primary">Continue</AuthButton>

      <div style={{ marginTop: 14, textAlign: 'center', fontSize: 13, color: '#78716C' }}>
        Lost your phone?{' '}
        <AuthLink>Use a backup code</AuthLink>
      </div>
    </AuthLayout>
  )
}
