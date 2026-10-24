/**
 * Set new password — /auth/reset-password (ref: gweHj)
 * Reached from the reset link in email.
 * Standalone full-screen page. No Shell / Rail.
 */

import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthCheckbox, PasswordStrength, IconBadge } from './AuthPrimitives'

function PasswordRule({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: ok ? '#15803D' : '#78716C' }}>
      <span style={{ color: ok ? '#15803D' : '#D6D3D1', fontSize: 14 }}>{ok ? '✓' : '○'}</span>
      {text}
    </div>
  )
}

export function SetNewPasswordPage() {
  return (
    <AuthLayout>
      {/* Lock icon */}
      <IconBadge color="#F0FDF4">
        <svg width={20} height={20} viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect x={2.5} y={9} width={15} height={10} rx={2.5} stroke="#15803D" strokeWidth={1.5}/>
          <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" stroke="#15803D" strokeWidth={1.5}/>
        </svg>
      </IconBadge>

      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#0C0A09', fontFamily: 'var(--font-display, sans-serif)' }}>
        Set a new password
      </h1>
      <p style={{ margin: '0 0 24px', fontSize: 13.5, color: '#78716C' }}>
        For dede@saga.co.id. You'll stay signed in on this device.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* New password */}
        <div>
          <AuthField
            label="New password"
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
        </div>

        {/* Confirm password */}
        <AuthField
          label="Confirm password"
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

        {/* Rules checklist */}
        <div style={{ border: '1px solid #E7E5E4', borderRadius: 8, background: '#FAFAF9', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PasswordRule ok text="At least 10 characters" />
          <PasswordRule ok text="Has a number" />
          <PasswordRule ok={false} text="Not your email or company name" />
          <PasswordRule ok text="Passwords match" />
        </div>

        <AuthCheckbox label="Sign out of my other devices" checked />

        <AuthButton variant="primary">Update password</AuthButton>
      </div>
    </AuthLayout>
  )
}
