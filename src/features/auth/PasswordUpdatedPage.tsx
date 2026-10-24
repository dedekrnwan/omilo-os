/**
 * Password updated — /auth/reset-password/success (ref: WUakJ)
 * Confirmation after a successful password reset.
 * Standalone full-screen page. No Shell / Rail.
 */

import { AuthLayout } from './AuthLayout'
import { AuthButton, IconBadge } from './AuthPrimitives'

export function PasswordUpdatedPage() {
  return (
    <AuthLayout>
      {/* Check icon */}
      <IconBadge color="#F0FDF4">
        <svg width={20} height={20} viewBox="0 0 20 20" fill="none" aria-hidden>
          <circle cx={10} cy={10} r={7.5} stroke="#15803D" strokeWidth={1.5}/>
          <path d="M6.5 10l2.5 2.5 5-5" stroke="#15803D" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </IconBadge>

      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#0C0A09', fontFamily: 'var(--font-display, sans-serif)' }}>
        Password updated
      </h1>
      <p style={{ margin: '0 0 24px', fontSize: 13.5, color: '#78716C' }}>
        You're signed in. We signed you out on 2 other devices, just in case.
      </p>

      <AuthButton variant="primary">Continue to Sahabat Warga</AuthButton>

      {/* Security note */}
      <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ color: '#A8A29E', fontSize: 13, marginTop: 1, flexShrink: 0 }}>○</span>
        <p style={{ margin: 0, fontSize: 13, color: '#78716C', lineHeight: 1.5 }}>
          Didn't change this yourself? Secure your account and tell an admin.
        </p>
      </div>
    </AuthLayout>
  )
}
