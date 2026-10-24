/**
 * Create company — /auth/onboarding/company (ref: OsWDG)
 * Step 2 of 4 in the onboarding stepper.
 * Standalone full-screen page. No Shell / Rail.
 */

import { OnboardingLayout } from './AuthLayout'

const STEPS = { labels: ['Account', 'Company', 'Plan', 'Payment'], current: 2 }

const TOP_RIGHT = (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5, color: '#44403C' }}>
    <span>dede@saga.co.id</span>
    <a href="#" style={{ color: '#2563EB', textDecoration: 'none', fontWeight: 500 }}>Sign out</a>
  </div>
)

/** Orange company logo placeholder */
function CompanyLogo() {
  return (
    <span style={{
      width: 40,
      height: 40,
      borderRadius: 10,
      background: '#F97316',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 18,
      fontWeight: 700,
      color: '#FFFFFF',
      flexShrink: 0,
    }}>
      S
    </span>
  )
}

function SelectField({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12.5, color: '#78716C' }}>{label}</span>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        height: 40,
        border: '1px solid #E7E5E4',
        borderRadius: 8,
        background: '#FFFFFF',
        cursor: 'pointer',
        fontSize: 13.5,
        color: '#0C0A09',
      }}>
        {icon && <span style={{ color: '#78716C', display: 'flex', alignItems: 'center' }}>{icon}</span>}
        <span style={{ flex: 1 }}>{value}</span>
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M3 5l4 4 4-4" stroke="#78716C" strokeWidth={1.5} strokeLinecap="round"/>
        </svg>
      </div>
    </div>
  )
}

export function CreateCompanyPage() {
  return (
    <OnboardingLayout steps={STEPS} topRight={TOP_RIGHT}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <h1 style={{
          margin: '0 0 6px',
          fontSize: 26,
          fontWeight: 700,
          color: '#0C0A09',
          fontFamily: 'var(--font-display, sans-serif)',
          textAlign: 'center',
        }}>
          Set up your company
        </h1>
        <p style={{ margin: '0 0 28px', fontSize: 13.5, color: '#78716C', textAlign: 'center' }}>
          Agents use this to introduce themselves and write in your voice.
        </p>

        {/* Card */}
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E7E5E4',
          borderRadius: 12,
          padding: '20px 20px',
          marginBottom: 16,
        }}>
          {/* Logo row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 0 20px',
            borderBottom: '1px solid #F5F5F4',
            marginBottom: 16,
          }}>
            <CompanyLogo />
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 2px', fontSize: 13.5, fontWeight: 500, color: '#0C0A09' }}>Company logo</p>
              <p style={{ margin: 0, fontSize: 12, color: '#A8A29E' }}>Optional — we'll use your initial</p>
            </div>
            <button
              type="button"
              style={{
                height: 32,
                padding: '0 14px',
                border: '1px solid #E7E5E4',
                borderRadius: 7,
                background: '#FFFFFF',
                fontSize: 13,
                color: '#0C0A09',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Upload
            </button>
          </div>

          {/* Company name */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#0C0A09', display: 'block', marginBottom: 6 }}>
              Company name
            </label>
            <input
              type="text"
              defaultValue="Sahabat Warga"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                height: 40,
                padding: '0 12px',
                border: '1px solid #E7E5E4',
                borderRadius: 8,
                background: '#FAFAF9',
                fontSize: 13.5,
                color: '#0C0A09',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>

          {/* What you do */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#0C0A09', display: 'block', marginBottom: 6 }}>
              What you do
            </label>
            <input
              type="text"
              defaultValue="SaaS for RT/RW neighborhoods in Indonesia"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                height: 40,
                padding: '0 12px',
                border: '1px solid #E7E5E4',
                borderRadius: 8,
                background: '#FAFAF9',
                fontSize: 13.5,
                color: '#0C0A09',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#A8A29E' }}>
              One line. Chief uses it in every intro.
            </p>
          </div>

          {/* Team size + timezone row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <SelectField
              label="Team size"
              value="2–10 people"
              icon={
                <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
                  <circle cx={5} cy={4} r={2} stroke="#78716C" strokeWidth={1.2}/>
                  <circle cx={10} cy={4} r={2} stroke="#78716C" strokeWidth={1.2}/>
                  <path d="M1 12c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="#78716C" strokeWidth={1.2} strokeLinecap="round"/>
                  <path d="M10 8c1.7.4 3 1.9 3 3.7" stroke="#78716C" strokeWidth={1.2} strokeLinecap="round"/>
                </svg>
              }
            />
            <SelectField
              label="Time zone"
              value="Asia/Jakarta"
              icon={
                <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
                  <circle cx={7} cy={7} r={5.5} stroke="#78716C" strokeWidth={1.2}/>
                  <path d="M7 1.5c0 0-2.5 2.5-2.5 5.5s2.5 5.5 2.5 5.5M7 1.5c0 0 2.5 2.5 2.5 5.5S7 12.5 7 12.5M1.5 7h11" stroke="#78716C" strokeWidth={1.2}/>
                </svg>
              }
            />
          </div>
        </div>

        {/* CTA */}
        <button
          type="button"
          style={{
            width: '100%',
            height: 44,
            borderRadius: 8,
            border: 'none',
            background: '#171717',
            color: '#FFFFFF',
            fontSize: 15,
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Continue
        </button>
      </div>
    </OnboardingLayout>
  )
}
