/**
 * Forgot password — /auth/forgot-password (ref: frQuc)
 * Standalone full-screen page. No Shell / Rail.
 */

import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthLink, IconBadge } from './AuthPrimitives'

export function ForgotPasswordPage() {
  return (
    <AuthLayout>
      {/* Key icon */}
      <IconBadge color="#FEF3C7">
        <svg width={20} height={20} viewBox="0 0 20 20" fill="none" aria-hidden>
          <circle cx={8} cy={8} r={4.5} stroke="#B45309" strokeWidth={1.5}/>
          <path d="M11.5 11.5L18 18" stroke="#B45309" strokeWidth={1.5} strokeLinecap="round"/>
          <path d="M15 15.5l2.5-2.5" stroke="#B45309" strokeWidth={1.5} strokeLinecap="round"/>
        </svg>
      </IconBadge>

      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#0C0A09', fontFamily: 'var(--font-display, sans-serif)' }}>
        Forgot your password?
      </h1>
      <p style={{ margin: '0 0 24px', fontSize: 13.5, color: '#78716C' }}>
        Enter your work email and we'll send a link to set a new one.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <AuthField
          label="Work email"
          type="email"
          defaultValue="dede@saga.co.id"
          prefixIcon={
            <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x={1} y={3} width={14} height={10} rx={2} stroke="#A8A29E" strokeWidth={1.5}/>
              <path d="M1 6l7 4 7-4" stroke="#A8A29E" strokeWidth={1.5}/>
            </svg>
          }
        />

        <AuthButton variant="primary">Send reset link</AuthButton>
      </div>

      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <AuthLink>← Back to sign in</AuthLink>
      </div>

      {/* Google hint */}
      <div style={{ marginTop: 20, padding: '12px 14px', border: '1px solid #E7E5E4', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden style={{ flexShrink: 0, marginTop: 1 }}>
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
        </svg>
        <p style={{ margin: 0, fontSize: 13, color: '#78716C', lineHeight: 1.5 }}>
          Signed up with Google? There's no password to reset — just continue with Google.
        </p>
      </div>
    </AuthLayout>
  )
}
