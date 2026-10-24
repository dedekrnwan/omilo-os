/**
 * Sign In — /auth/sign-in (ref: YBOIE)
 * Standalone full-screen page. No Shell / Rail.
 */

import { AuthLayout } from './AuthLayout'
import {
  GoogleLogo,
  AuthButton,
  OrDivider,
  AuthField,
  AuthLink,
  AuthCheckbox,
} from './AuthPrimitives'

export function SignInPage() {
  return (
    <AuthLayout>
      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#0C0A09', fontFamily: 'var(--font-display, sans-serif)' }}>
        Sign in to Omilo
      </h1>
      <p style={{ margin: '0 0 20px', fontSize: 13.5, color: '#78716C' }}>
        Welcome back. Use Google or your email and password.
      </p>

      {/* Google */}
      <AuthButton variant="secondary">
        <GoogleLogo size={18} />
        Continue with Google
      </AuthButton>

      <OrDivider />

      {/* Email field */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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

        <AuthField
          label="Password"
          type="password"
          defaultValue="password123"
          right={<AuthLink>Forgot password?</AuthLink>}
          prefixIcon={
            <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x={2} y={7} width={12} height={8} rx={2} stroke="#A8A29E" strokeWidth={1.5}/>
              <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="#A8A29E" strokeWidth={1.5}/>
            </svg>
          }
          suffixIcon={
            <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx={8} cy={8} r={2.5} stroke="#A8A29E" strokeWidth={1.5}/>
              <path d="M1.5 8C3 4.5 5 3 8 3s5 1.5 6.5 5c-1.5 3.5-3.5 5-6.5 5s-5-1.5-6.5-5z" stroke="#A8A29E" strokeWidth={1.5}/>
            </svg>
          }
        />

        <AuthCheckbox label="Keep me signed in for 30 days" checked />

        <AuthButton variant="primary">Sign in</AuthButton>
      </div>

      {/* Bottom links */}
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <AuthLink>✉ Email me a sign-in code instead</AuthLink>
        <p style={{ margin: 0, fontSize: 13, color: '#78716C' }}>
          New to Omilo?{' '}
          <AuthLink>Create an account</AuthLink>
        </p>
      </div>
    </AuthLayout>
  )
}
