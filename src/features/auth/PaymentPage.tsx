/**
 * Payment — /auth/onboarding/payment (ref: rK2oH)
 * Step 4 of 4 in the onboarding stepper.
 * Standalone full-screen page. No Shell / Rail.
 */

import { OnboardingLayout } from './AuthLayout'

const STEPS = { labels: ['Account', 'Company', 'Plan', 'Payment'], current: 4 }

const TOP_RIGHT = (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5, color: '#44403C' }}>
    <span>dede@saga.co.id</span>
    <a href="#" style={{ color: '#2563EB', textDecoration: 'none', fontWeight: 500 }}>Sign out</a>
  </div>
)

function FormInput({
  label,
  value,
  placeholder,
  prefixIcon,
  half,
}: {
  label?: string
  value?: string
  placeholder?: string
  prefixIcon?: React.ReactNode
  half?: boolean
}) {
  return (
    <div style={{ flex: half ? undefined : undefined, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <span style={{ fontSize: 13, fontWeight: 500, color: '#0C0A09' }}>{label}</span>}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        border: '1px solid #E7E5E4',
        borderRadius: 8,
        background: '#FAFAF9',
        padding: '0 12px',
        height: 40,
      }}>
        {prefixIcon && <span style={{ color: '#A8A29E', display: 'flex', flexShrink: 0 }}>{prefixIcon}</span>}
        <span style={{ fontSize: 13.5, color: value ? '#0C0A09' : '#A8A29E', flex: 1 }}>
          {value ?? placeholder}
        </span>
      </div>
    </div>
  )
}

function SelectInput({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: '#0C0A09' }}>{label}</span>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        border: '1px solid #E7E5E4',
        borderRadius: 8,
        background: '#FAFAF9',
        padding: '0 12px',
        height: 40,
        cursor: 'pointer',
      }}>
        <span style={{ fontSize: 13.5, color: '#0C0A09', flex: 1 }}>{value}</span>
        <svg width={12} height={12} viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M2 4l4 4 4-4" stroke="#78716C" strokeWidth={1.4} strokeLinecap="round"/>
        </svg>
      </div>
    </div>
  )
}

function LineItem({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, color: muted ? '#15803D' : '#0C0A09', padding: '8px 0', borderBottom: '1px solid #F5F5F4' }}>
      <span>{label}</span>
      <span style={{ fontWeight: muted ? 400 : 400 }}>{value}</span>
    </div>
  )
}

export function PaymentPage() {
  return (
    <OnboardingLayout steps={STEPS} topRight={TOP_RIGHT}>
      <div style={{ width: '100%', maxWidth: 720, display: 'flex', gap: 32, alignItems: 'flex-start' }}>
        {/* Left: form */}
        <div style={{ flex: 1, maxWidth: 420 }}>
          <h1 style={{
            margin: '0 0 6px',
            fontSize: 24,
            fontWeight: 700,
            color: '#0C0A09',
            fontFamily: 'var(--font-display, sans-serif)',
          }}>
            Start your free trial
          </h1>
          <p style={{ margin: '0 0 24px', fontSize: 13.5, color: '#78716C' }}>
            You won't be charged until Nov 7. Cancel before then and you pay nothing.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Card number */}
            <FormInput
              label="Card number"
              value="4242 4242 4242 4242"
              prefixIcon={
                <svg width={20} height={14} viewBox="0 0 20 14" fill="none" aria-hidden>
                  <rect x={0.75} y={0.75} width={18.5} height={12.5} rx={1.75} stroke="#A8A29E" strokeWidth={1.5}/>
                  <rect x={1} y={4} width={18} height={2.5} fill="#E7E5E4"/>
                </svg>
              }
            />

            {/* Expiry + CVC row */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <FormInput label="Expiry" value="08 / 28" />
              </div>
              <div style={{ flex: 1 }}>
                <FormInput
                  label="CVC"
                  value="•••"
                  prefixIcon={
                    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
                      <rect x={1} y={3} width={12} height={8} rx={2} stroke="#A8A29E" strokeWidth={1.2}/>
                    </svg>
                  }
                />
              </div>
            </div>

            <FormInput label="Name on card" value="Dede Kurniawan" />

            {/* Country + Tax ID row */}
            <div style={{ display: 'flex', gap: 12 }}>
              <SelectInput label="Country" value="Indonesia" />
              <div style={{ flex: 1 }}>
                <FormInput label="Tax ID (optional)" placeholder="NPWP" value="NPWP" />
              </div>
            </div>
          </div>

          <p style={{ marginTop: 16, fontSize: 12, color: '#A8A29E', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>🔒</span>
            Payments by Stripe. We never see your full card number.
          </p>
        </div>

        {/* Right: order summary */}
        <div style={{
          width: 240,
          border: '1px solid #E7E5E4',
          borderRadius: 12,
          background: '#FFFFFF',
          padding: '20px',
          flexShrink: 0,
        }}>
          {/* Plan header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #F5F5F4' }}>
            <div>
              <p style={{ margin: '0 0 2px', fontSize: 13.5, fontWeight: 600, color: '#0C0A09' }}>Team · yearly</p>
              <p style={{ margin: 0, fontSize: 12, color: '#78716C' }}>5 seats · all agents</p>
            </div>
            <a href="#" style={{ fontSize: 12, color: '#2563EB', textDecoration: 'none' }}>Change</a>
          </div>

          {/* Line items */}
          <LineItem label="Team plan, 12 × $49" value="$588" />
          <LineItem label="Yearly discount (20%)" value="-$118" muted />
          <LineItem label="AI credit" value="$20 / month included" />

          {/* Due today */}
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
            <span style={{ fontWeight: 600, color: '#0C0A09' }}>Due today</span>
            <span style={{ fontWeight: 700, color: '#0C0A09' }}>$0</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#78716C', marginTop: 4, marginBottom: 16 }}>
            <span>From Nov 7, 2026</span>
            <span>$470 / year</span>
          </div>

          {/* CTA */}
          <button
            type="button"
            style={{
              width: '100%',
              height: 40,
              borderRadius: 8,
              border: 'none',
              background: '#171717',
              color: '#FFFFFF',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Start 14-day trial
          </button>

          <p style={{ margin: '10px 0 0', fontSize: 11.5, color: '#A8A29E', textAlign: 'center' }}>
            We'll remind you 3 days before the trial ends.
          </p>
        </div>
      </div>
    </OnboardingLayout>
  )
}
