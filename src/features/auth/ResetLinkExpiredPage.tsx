/**
 * Reset link expired — /auth/reset-password/expired (ref: GMMNj)
 * Shown when the user follows a reset link that is >30 minutes old or already used.
 * Standalone full-screen page. No Shell / Rail.
 */

import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthLink, IconBadge } from './AuthPrimitives'

export function ResetLinkExpiredPage() {
  return (
    <AuthLayout>
      {/* Clock icon (amber tint = warn) */}
      <IconBadge color="#FFFBEB">
        <svg width={20} height={20} viewBox="0 0 20 20" fill="none" aria-hidden>
          <circle cx={10} cy={10} r={7.5} stroke="#B45309" strokeWidth={1.5}/>
          <path d="M10 6v4l2.5 2.5" stroke="#B45309" strokeWidth={1.5} strokeLinecap="round"/>
        </svg>
      </IconBadge>

      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#0C0A09', fontFamily: 'var(--font-display, sans-serif)' }}>
        This link has expired
      </h1>
      <p style={{ margin: '0 0 24px', fontSize: 13.5, color: '#78716C' }}>
        Reset links work for 30 minutes and only once. Send a fresh one and use the newest email.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <AuthField
          label="Work email"
          type="email"
          placeholder="dede@saga.co.id"
          prefixIcon={
            <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x={1} y={3} width={14} height={10} rx={2} stroke="#A8A29E" strokeWidth={1.5}/>
              <path d="M1 6l7 4 7-4" stroke="#A8A29E" strokeWidth={1.5}/>
            </svg>
          }
        />
        <AuthButton variant="primary">Send a new link</AuthButton>
      </div>

      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <AuthLink>← Back to sign in</AuthLink>
      </div>
    </AuthLayout>
  )
}
