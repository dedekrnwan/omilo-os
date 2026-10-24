/**
 * AuthPrimitives — small stateless UI atoms shared across auth screens.
 * Visual-only (no real logic). Named exports only.
 */

import type { InputHTMLAttributes, ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Google colour logo (SVG inline, no external dependency)
// ---------------------------------------------------------------------------
export function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Large CTA button (full-width, auth-form style)
// ---------------------------------------------------------------------------
interface AuthButtonProps {
  children: ReactNode
  variant?: 'primary' | 'secondary'
  className?: string
}

export function AuthButton({ children, variant = 'primary', className = '' }: AuthButtonProps) {
  const base: React.CSSProperties = {
    width: '100%',
    height: 40,
    borderRadius: 8,
    border: variant === 'primary' ? 'none' : '1px solid #E7E5E4',
    background: variant === 'primary' ? '#171717' : '#FFFFFF',
    color: variant === 'primary' ? '#FFFFFF' : '#0C0A09',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontFamily: 'inherit',
  }
  return (
    <button type="button" style={base} className={className}>
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// "or" divider
// ---------------------------------------------------------------------------
export function OrDivider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0' }}>
      <div style={{ flex: 1, height: 1, background: '#E7E5E4' }} />
      <span style={{ fontSize: 12, color: '#A8A29E' }}>or</span>
      <div style={{ flex: 1, height: 1, background: '#E7E5E4' }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field label + input
// ---------------------------------------------------------------------------
interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode
  right?: ReactNode
  prefixIcon?: ReactNode
  suffixIcon?: ReactNode
}

export function AuthField({ label, right, prefixIcon, suffixIcon, ...inputProps }: AuthFieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {(label || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {label && <span style={{ fontSize: 13, fontWeight: 500, color: '#0C0A09' }}>{label}</span>}
          {right}
        </div>
      )}
      <div style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        border: '1px solid #E7E5E4',
        borderRadius: 8,
        background: '#FAFAF9',
        overflow: 'hidden',
      }}>
        {prefixIcon && (
          <span style={{ paddingLeft: 10, color: '#A8A29E', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {prefixIcon}
          </span>
        )}
        <input
          {...inputProps}
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            padding: '0 10px',
            height: 38,
            fontSize: 13.5,
            color: '#0C0A09',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        {suffixIcon && (
          <span style={{ paddingRight: 10, color: '#A8A29E', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {suffixIcon}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Link-style anchor
// ---------------------------------------------------------------------------
export function AuthLink({ children, href = '#' }: { children: ReactNode; href?: string }) {
  return (
    <a
      href={href}
      style={{ color: '#2563EB', fontSize: 13.5, textDecoration: 'none', fontFamily: 'inherit' }}
    >
      {children}
    </a>
  )
}

// ---------------------------------------------------------------------------
// OTP / code input row (5 or 6 digit boxes)
// ---------------------------------------------------------------------------
export function OtpRow({ value = '482' }: { value?: string }) {
  const digits = Array.from({ length: 6 })
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      {digits.map((_, i) => {
        const ch = value[i] ?? ''
        const isActive = i === value.length
        return (
          <div
            key={i}
            style={{
              width: 44,
              height: 48,
              borderRadius: 8,
              border: isActive ? '2px solid #171717' : '1px solid #E7E5E4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 600,
              color: '#0C0A09',
              background: '#FFFFFF',
              flexShrink: 0,
            }}
          >
            {ch}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Icon wrapper (badge circle for screen hero icons)
// ---------------------------------------------------------------------------
export function IconBadge({
  children,
  color = '#EDE9FE',
}: {
  children: ReactNode
  color?: string
}) {
  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Password strength bar
// ---------------------------------------------------------------------------
export function PasswordStrength({ level = 'strong' }: { level?: 'weak' | 'fair' | 'strong' }) {
  const widths = { weak: '33%', fair: '66%', strong: '100%' }
  const colors = { weak: '#B91C1C', fair: '#B45309', strong: '#15803D' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <div style={{ flex: 1, height: 3, borderRadius: 3, background: '#E7E5E4', position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: widths[level],
          background: colors[level],
          borderRadius: 3,
          transition: 'width 0.3s',
        }} />
      </div>
      <span style={{ fontSize: 12, color: colors[level], fontWeight: 500, textTransform: 'capitalize' }}>{level}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Checkbox row
// ---------------------------------------------------------------------------
export function AuthCheckbox({ label, checked = false }: { label: string; checked?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#44403C' }}>
      <span style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        border: '1px solid',
        borderColor: checked ? '#171717' : '#D6D3D1',
        background: checked ? '#171717' : '#FFFFFF',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {checked && <span style={{ color: '#FFFFFF', fontSize: 10, lineHeight: 1 }}>✓</span>}
      </span>
      {label}
    </label>
  )
}

// ---------------------------------------------------------------------------
// Status banner (error / info)
// ---------------------------------------------------------------------------
export function StatusBanner({
  type,
  title,
  body,
}: {
  type: 'error' | 'info'
  title?: string
  body: string
}) {
  const colors = {
    error: { bg: '#FEF2F2', border: '#FECACA', icon: '#B91C1C', text: '#B91C1C' },
    info:  { bg: '#EFF6FF', border: '#BFDBFE', icon: '#1D4ED8', text: '#1D4ED8' },
  }
  const c = colors[type]
  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 8,
      border: `1px solid ${c.border}`,
      background: c.bg,
      display: 'flex',
      gap: 8,
    }}>
      <span style={{ color: c.icon, fontSize: 14, flexShrink: 0, marginTop: 1 }}>
        {type === 'error' ? '✕' : 'ℹ'}
      </span>
      <div>
        {title && <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: c.text }}>{title}</p>}
        <p style={{ margin: 0, fontSize: 12.5, color: c.text }}>{body}</p>
      </div>
    </div>
  )
}
