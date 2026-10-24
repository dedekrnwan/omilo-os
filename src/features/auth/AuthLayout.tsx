/**
 * AuthLayout — shared split-screen wrapper used by sign-in / sign-up family.
 * Left: lavender panel with mascot illustration + tagline.
 * Right: white panel with the form content.
 * This is STANDALONE (no Shell / Rail).
 */

import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Omilo mascot agents illustrated row (SVG paths from Mascot.tsx geometry)
// ---------------------------------------------------------------------------
const BODY   = 'M10 70c0-36 9-54 22-54 13 0 22 18 22 54z'
const CHEEKS = 'M17.9 41a2.6 2.6 0 1 0 5.2 0 2.6 2.6 0 1 0-5.2 0z m23 0a2.6 2.6 0 1 0 5.2 0 2.6 2.6 0 1 0-5.2 0z'
const EYES   = 'M21.4 34a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0z m14 0a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0z'
const SHINE  = 'M25 32.8a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0z m14 0a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0z'
const MOUTH  = 'M27.5 42.5q4.5 4.5 9 0'

function MascotBlob({
  color,
  size,
  style,
}: {
  color: string
  size: number
  style?: React.CSSProperties
}) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: (size * 18) / 64,
        background: `linear-gradient(${color}29, ${color}29), #FFFFFF`,
        position: 'relative',
        flexShrink: 0,
        ...style,
      }}
    >
      <svg viewBox="0 0 64 64" width={size} height={size} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <path d={BODY}   fill={color} />
        <path d={CHEEKS} fill="#FFFFFF4D" />
        <path d={EYES}   fill="#1C1917" />
        <path d={SHINE}  fill="#FFFFFF" />
        <path d={MOUTH}  fill="none" stroke="#1C1917" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

/** The five-agent illustration shown on the left panel. */
function AgentRow() {
  // Colors: teal/sage (ops, dev), orange (marketing), indigo (brand/Chief), sky (ops2), green (finance)
  const agents: { color: string; size: number; marginTop?: number }[] = [
    { color: '#14B8A6', size: 48, marginTop: 12 },
    { color: '#F97316', size: 44, marginTop: 18 },
    { color: '#6366F1', size: 64, marginTop: 0  },
    { color: '#0EA5E9', size: 48, marginTop: 12 },
    { color: '#65A30D', size: 40, marginTop: 22 },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 32 }}>
      {agents.map((a, i) => (
        <MascotBlob key={i} color={a.color} size={a.size} style={{ marginBottom: a.marginTop ? -a.marginTop : 0 }} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Left panel
// ---------------------------------------------------------------------------
function LeftPanel() {
  return (
    <div
      style={{
        width: '42%',
        maxWidth: 600,
        minHeight: '100vh',
        flexShrink: 0,
        background: '#F5F5F4',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 28px 28px',
        position: 'relative',
      }}
    >
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'auto' }}>
        <MascotBlob color="#6366F1" size={28} />
        <span style={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-sans, sans-serif)', color: '#0C0A09' }}>
          Omilo
        </span>
      </div>

      {/* Illustration */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, paddingBottom: 40 }}>
        <AgentRow />
        <h2
          style={{
            margin: '0 0 12px',
            fontSize: 26,
            lineHeight: 1.25,
            fontFamily: 'var(--font-display, sans-serif)',
            fontWeight: 700,
            color: '#0C0A09',
          }}
        >
          Your company, run with a small team of agents.
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: '#78716C', fontFamily: 'var(--font-sans, sans-serif)', lineHeight: 1.5 }}>
          Chief plans, the team does the work, and you make the calls that matter.
        </p>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#A8A29E', fontFamily: 'var(--font-sans, sans-serif)' }}>
        <span>© 2026 Saga</span>
        <a href="#" style={{ color: '#A8A29E', textDecoration: 'none' }}>Privacy</a>
        <a href="#" style={{ color: '#A8A29E', textDecoration: 'none' }}>Terms</a>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Right panel (form area)
// ---------------------------------------------------------------------------
function RightPanel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: '100vh',
        background: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        position: 'relative',
      }}
    >
      <div style={{ width: '100%', maxWidth: 360 }}>
        {children}
      </div>
      {/* Bottom legal */}
      <p style={{
        position: 'absolute',
        bottom: 20,
        left: 0,
        right: 0,
        textAlign: 'center',
        fontSize: 11.5,
        color: '#A8A29E',
        fontFamily: 'var(--font-sans, sans-serif)',
        margin: 0,
      }}>
        By continuing you agree to the Terms and Privacy Policy.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export interface AuthLayoutProps {
  children: ReactNode
}

/** Split-screen auth layout: illustrated left panel + white form right panel. */
export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        width: '100%',
        fontFamily: 'var(--font-sans, sans-serif)',
      }}
    >
      <LeftPanel />
      <RightPanel>{children}</RightPanel>
    </div>
  )
}

/**
 * Onboarding layout — full-screen with top stepper bar (no split panel).
 * Used for: Create company, Choose plan, Payment, All set.
 */
export interface OnboardingLayoutProps {
  children: ReactNode
  /** Step indicator: which step is active (1-based) and how many total. */
  steps?: { labels: string[]; current: number }
  /** Right side of the top bar (e.g. email + sign out). */
  topRight?: ReactNode
}

export function OnboardingLayout({ children, steps, topRight }: OnboardingLayoutProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        background: '#F5F5F4',
        fontFamily: 'var(--font-sans, sans-serif)',
      }}
    >
      {/* Top bar */}
      <header
        style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          background: '#FFFFFF',
          borderBottom: '1px solid #E7E5E4',
          gap: 16,
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MascotBlob color="#6366F1" size={28} />
          <span style={{ fontSize: 15, fontWeight: 600, color: '#0C0A09' }}>Omilo</span>
        </div>

        {/* Stepper */}
        {steps && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
            {steps.labels.map((label, i) => {
              const n = i + 1
              const done    = n < steps.current
              const active  = n === steps.current
              const pending = n > steps.current
              return (
                <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
                  {i > 0 && (
                    <div style={{
                      width: 48,
                      height: 1,
                      background: done ? '#0C0A09' : '#E7E5E4',
                      margin: '0 2px',
                    }} />
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      border: active ? '2px solid #0C0A09' : done ? 'none' : '2px solid #D6D3D1',
                      background: done ? '#0C0A09' : 'transparent',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 600,
                      color: done ? '#FFFFFF' : active ? '#0C0A09' : '#A8A29E',
                      flexShrink: 0,
                    }}>
                      {done ? '✓' : n}
                    </span>
                    <span style={{
                      fontSize: 12.5,
                      fontWeight: active ? 600 : 400,
                      color: pending ? '#A8A29E' : '#0C0A09',
                    }}>
                      {label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Top right */}
        {topRight && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            {topRight}
          </div>
        )}
      </header>

      {/* Content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
        {children}
      </main>
    </div>
  )
}

// Re-export mascot for screens that need it standalone
export { MascotBlob }
