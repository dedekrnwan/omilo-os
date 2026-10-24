/**
 * Check your email (sign-in code / magic-link) — /auth/check-email (ref: A4bMp)
 * Shown after "Email me a sign-in code instead" on the sign-in screen.
 * Standalone full-screen page. No Shell / Rail.
 */

import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthLink, OtpRow, IconBadge } from './AuthPrimitives'

export function CheckEmailPage() {
  return (
    <AuthLayout>
      {/* Envelope icon */}
      <IconBadge color="#EDE9FE">
        <svg width={20} height={20} viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect x={1.5} y={4} width={17} height={12} rx={2.5} stroke="#6366F1" strokeWidth={1.5}/>
          <path d="M1.5 7.5l8.5 5 8.5-5" stroke="#6366F1" strokeWidth={1.5}/>
        </svg>
      </IconBadge>

      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#0C0A09', fontFamily: 'var(--font-display, sans-serif)' }}>
        Check your email
      </h1>
      <p style={{ margin: '0 0 24px', fontSize: 13.5, color: '#78716C' }}>
        We sent a 6-digit code to dede@saga.co.id. It expires in 10 minutes.
      </p>

      {/* OTP boxes */}
      <OtpRow value="482" />

      <AuthButton variant="primary">Verify</AuthButton>

      {/* Resend */}
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#78716C' }}>
        <span>Resend in 0:42</span>
        <AuthLink>Use a different email</AuthLink>
      </div>

      {/* Hint */}
      <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ color: '#A8A29E', fontSize: 13, marginTop: 1 }}>○</span>
        <p style={{ margin: 0, fontSize: 13, color: '#78716C', lineHeight: 1.5 }}>
          Can't find it? Check spam, or open the link in the email instead.
        </p>
      </div>
    </AuthLayout>
  )
}
