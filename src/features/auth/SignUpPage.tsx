/**
 * Sign Up — /auth/sign-up (ref: eAlcQ)
 * Standalone full-screen page. No Shell / Rail.
 */

import { AuthLayout } from './AuthLayout'
import {
  GoogleLogo,
  AuthButton,
  OrDivider,
  AuthField,
  AuthLink,
  PasswordStrength,
} from './AuthPrimitives'

export function SignUpPage() {
  return (
    <AuthLayout>
      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#0C0A09', fontFamily: 'var(--font-display, sans-serif)' }}>
        Create your Omilo account
      </h1>
      <p style={{ margin: '0 0 20px', fontSize: 13.5, color: '#78716C' }}>
        Google is the fastest. Or use your work email and a password.
      </p>

      {/* Google */}
      <AuthButton variant="secondary">
        <GoogleLogo size={18} />
        Sign up with Google
      </AuthButton>

      <OrDivider />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Name */}
        <AuthField
          label="Your name"
          type="text"
          defaultValue="Dede Kurniawan"
          prefixIcon={
            <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx={8} cy={5} r={3} stroke="#A8A29E" strokeWidth={1.5}/>
              <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="#A8A29E" strokeWidth={1.5} strokeLinecap="round"/>
            </svg>
          }
        />

        {/* Work email */}
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

        {/* Password */}
        <div>
          <AuthField
            label="Password"
            type="password"
            defaultValue="password123"
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
          <PasswordStrength level="strong" />
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#A8A29E' }}>
            at least 10 characters, with a number
          </p>
        </div>

        <AuthButton variant="primary">Create account</AuthButton>
      </div>

      <p style={{ marginTop: 16, textAlign: 'center', fontSize: 13, color: '#78716C' }}>
        Already have an account?{' '}
        <AuthLink>Sign in</AuthLink>
      </p>
    </AuthLayout>
  )
}
