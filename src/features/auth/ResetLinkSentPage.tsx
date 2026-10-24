/**
 * Reset link sent (Check your email — password reset) — /auth/forgot-password/sent (ref: g4ord)
 * Shown after submitting the forgot-password form.
 * Standalone full-screen page. No Shell / Rail.
 */

import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthLink, IconBadge } from './AuthPrimitives'

export function ResetLinkSentPage() {
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
        If dede@saga.co.id has an account, a reset link is on its way. It works for 30 minutes.
      </p>

      <AuthButton variant="secondary">
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M13 7H1M7 1v12" stroke="#44403C" strokeWidth={1.5} strokeLinecap="round"/>
        </svg>
        Open Gmail
      </AuthButton>

      <div style={{ marginTop: 14, textAlign: 'center', fontSize: 13, color: '#78716C' }}>
        Didn't get it?{' '}
        <span>Resend in 0:58</span>
      </div>

      <div style={{ marginTop: 10, textAlign: 'center' }}>
        <AuthLink>← Back to sign in</AuthLink>
      </div>
    </AuthLayout>
  )
}
