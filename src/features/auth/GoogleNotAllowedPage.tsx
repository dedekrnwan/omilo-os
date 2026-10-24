/**
 * Google not allowed — /auth/sign-in/google-not-allowed (ref: S517J)
 * Shows when the user signed in with a personal Gmail but the company
 * only allows @saga.co.id accounts.
 * Standalone full-screen page. No Shell / Rail.
 */

import { AuthLayout } from './AuthLayout'
import { GoogleLogo, AuthButton, StatusBanner } from './AuthPrimitives'

export function GoogleNotAllowedPage() {
  return (
    <AuthLayout>
      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#0C0A09', fontFamily: 'var(--font-display, sans-serif)' }}>
        Sign in to Omilo
      </h1>
      <p style={{ margin: '0 0 20px', fontSize: 13.5, color: '#78716C' }}>
        Use your work Google account, or we'll email you a code.
      </p>

      {/* Error banner */}
      <div style={{ marginBottom: 16 }}>
        <StatusBanner
          type="error"
          title="This Google account can't join Sahabat Warga"
          body="You signed in as dede.k@gmail.com. This company only allows @saga.co.id accounts."
        />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <AuthButton variant="secondary">
          <GoogleLogo size={18} />
          Use another Google account
        </AuthButton>

        <AuthButton variant="secondary">
          <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x={1} y={3} width={14} height={10} rx={2} stroke="#44403C" strokeWidth={1.5}/>
            <path d="M1 6l7 4 7-4" stroke="#44403C" strokeWidth={1.5}/>
          </svg>
          Email me a code instead
        </AuthButton>
      </div>

      <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13, color: '#78716C' }}>
        Wrong company?{' '}
        <a href="#" style={{ color: '#2563EB', textDecoration: 'none' }}>Ask an admin for an invite</a>
      </div>
    </AuthLayout>
  )
}
