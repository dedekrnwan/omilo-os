/**
 * All set — /auth/onboarding/all-set (ref: CXuxX)
 * All 4 onboarding steps complete. Company is ready.
 * Standalone full-screen page. No Shell / Rail.
 */

import { OnboardingLayout, MascotBlob } from './AuthLayout'

const STEPS = { labels: ['Account', 'Company', 'Plan', 'Payment'], current: 5 } // 5 = all done

const TOP_RIGHT = (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5, color: '#44403C' }}>
    <span>dede@saga.co.id</span>
    <a href="#" style={{ color: '#2563EB', textDecoration: 'none', fontWeight: 500 }}>Sign out</a>
  </div>
)

/** The celebration mascot cluster shown on the all-set screen */
function AgentCluster() {
  const agents: { color: string; size: number; zIndex?: number }[] = [
    { color: '#14B8A6', size: 52 },
    { color: '#F97316', size: 48 },
    { color: '#6366F1', size: 72, zIndex: 1 },
    { color: '#0EA5E9', size: 52 },
    { color: '#65A30D', size: 44 },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 8, marginBottom: 28 }}>
      {agents.map((a, i) => (
        <MascotBlob key={i} color={a.color} size={a.size} style={{ position: 'relative', zIndex: a.zIndex ?? 0 }} />
      ))}
    </div>
  )
}

interface SummaryRow {
  label: string
  value: string
}

function SummaryItem({ label, value }: SummaryRow) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '14px 0',
      borderBottom: '1px solid #F5F5F4',
      fontSize: 13.5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: '#15803D', fontSize: 16 }}>✓</span>
        <span style={{ fontWeight: 500, color: '#0C0A09' }}>{label}</span>
      </div>
      <span style={{ color: '#78716C' }}>{value}</span>
    </div>
  )
}

export function AllSetPage() {
  const summary: SummaryRow[] = [
    { label: 'Account created',  value: 'dede@saga.co.id' },
    { label: 'Company set up',   value: 'Sahabat Warga · Asia/Jakarta' },
    { label: 'Team plan · trial', value: '5 seats · $20 AI credit' },
    { label: 'Agents hired',     value: 'Chief, Dev, Ops, Growth, Finance' },
  ]

  return (
    <OnboardingLayout steps={STEPS} topRight={TOP_RIGHT}>
      <div style={{ width: '100%', maxWidth: 520, textAlign: 'center' }}>
        <AgentCluster />

        <h1 style={{
          margin: '0 0 8px',
          fontSize: 28,
          fontWeight: 700,
          color: '#0C0A09',
          fontFamily: 'var(--font-display, sans-serif)',
        }}>
          Sahabat Warga is ready
        </h1>
        <p style={{ margin: '0 0 28px', fontSize: 13.5, color: '#78716C' }}>
          Your Team trial runs until Nov 7. Chief is waiting to meet you.
        </p>

        {/* Summary card */}
        <div style={{
          border: '1px solid #E7E5E4',
          borderRadius: 12,
          background: '#FFFFFF',
          padding: '0 20px',
          marginBottom: 24,
          textAlign: 'left',
        }}>
          {summary.map((row) => (
            <SummaryItem key={row.label} {...row} />
          ))}
        </div>

        {/* CTA row */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            style={{
              flex: 1,
              height: 44,
              borderRadius: 8,
              border: '1px solid #E7E5E4',
              background: '#FFFFFF',
              color: '#0C0A09',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx={8} cy={5} r={3} stroke="#0C0A09" strokeWidth={1.4}/>
              <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="#0C0A09" strokeWidth={1.4} strokeLinecap="round"/>
            </svg>
            Invite teammates
          </button>
          <button
            type="button"
            style={{
              flex: 1,
              height: 44,
              borderRadius: 8,
              border: 'none',
              background: '#171717',
              color: '#FFFFFF',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            Meet Chief
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 8h10M9 4l4 4-4 4" stroke="#FFFFFF" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </OnboardingLayout>
  )
}
