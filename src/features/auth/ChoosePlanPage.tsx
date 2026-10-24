/**
 * Choose plan — /auth/onboarding/plan (ref: eWPwo)
 * Step 3 of 4 in the onboarding stepper.
 * Standalone full-screen page. No Shell / Rail.
 */

import { OnboardingLayout } from './AuthLayout'

const STEPS = { labels: ['Account', 'Company', 'Plan', 'Payment'], current: 3 }

const TOP_RIGHT = (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12.5, color: '#44403C' }}>
    <span>dede@saga.co.id</span>
    <a href="#" style={{ color: '#2563EB', textDecoration: 'none', fontWeight: 500 }}>Sign out</a>
  </div>
)

interface PlanFeature {
  text: string
}

interface PlanCardProps {
  name: string
  badge?: string
  price: string
  period: string
  description: string
  cta: string
  ctaPrimary?: boolean
  features: PlanFeature[]
  highlighted?: boolean
}

function PlanCard({ name, badge, price, period, description, cta, ctaPrimary = false, features, highlighted = false }: PlanCardProps) {
  return (
    <div style={{
      border: highlighted ? '2px solid #171717' : '1px solid #E7E5E4',
      borderRadius: 12,
      padding: '20px 20px 24px',
      background: '#FFFFFF',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      flex: 1,
      position: 'relative',
    }}>
      {/* Name + badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#0C0A09' }}>{name}</span>
        {badge && (
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#FFFFFF',
            background: '#171717',
            borderRadius: 999,
            padding: '2px 8px',
          }}>
            {badge}
          </span>
        )}
      </div>

      {/* Price */}
      <div>
        <span style={{ fontSize: 36, fontWeight: 700, color: '#0C0A09', fontFamily: 'var(--font-display, sans-serif)' }}>
          {price}
        </span>
        {period && <span style={{ fontSize: 13, color: '#78716C', marginLeft: 4 }}>{period}</span>}
      </div>

      {/* Description */}
      <p style={{ margin: 0, fontSize: 13, color: '#78716C', lineHeight: 1.5 }}>{description}</p>

      {/* CTA button */}
      <button
        type="button"
        style={{
          width: '100%',
          height: 38,
          borderRadius: 8,
          border: ctaPrimary ? 'none' : '1px solid #E7E5E4',
          background: ctaPrimary ? '#171717' : '#FFFFFF',
          color: ctaPrimary ? '#FFFFFF' : '#0C0A09',
          fontSize: 13.5,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {cta}
      </button>

      {/* Features */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {features.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#44403C' }}>
            <span style={{ color: '#15803D', flexShrink: 0, marginTop: 1 }}>✓</span>
            {f.text}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ChoosePlanPage() {
  return (
    <OnboardingLayout steps={STEPS} topRight={TOP_RIGHT}>
      <div style={{ width: '100%', maxWidth: 720 }}>
        <h1 style={{
          margin: '0 0 8px',
          fontSize: 28,
          fontWeight: 700,
          color: '#0C0A09',
          fontFamily: 'var(--font-display, sans-serif)',
          textAlign: 'center',
        }}>
          Choose a plan for Sahabat Warga
        </h1>
        <p style={{ margin: '0 0 24px', fontSize: 13.5, color: '#78716C', textAlign: 'center' }}>
          14-day free trial on paid plans. Change or cancel any time.
        </p>

        {/* Monthly / Yearly toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
          <div style={{
            display: 'flex',
            border: '1px solid #E7E5E4',
            borderRadius: 999,
            overflow: 'hidden',
          }}>
            <button
              type="button"
              style={{
                padding: '6px 16px',
                fontSize: 13,
                fontWeight: 500,
                border: 'none',
                background: '#FFFFFF',
                color: '#78716C',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Monthly
            </button>
            <button
              type="button"
              style={{
                padding: '6px 16px',
                fontSize: 13,
                fontWeight: 500,
                border: 'none',
                background: '#171717',
                color: '#FFFFFF',
                cursor: 'pointer',
                fontFamily: 'inherit',
                borderRadius: 999,
              }}
            >
              Yearly · save 20%
            </button>
          </div>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
          <PlanCard
            name="Starter"
            price="Free"
            period="forever"
            description="For trying Omilo with one area."
            cta="Start free"
            features={[
              { text: '1 seat' },
              { text: 'Chief + 1 agent' },
              { text: '100 runs a month' },
              { text: 'Docs & chat' },
            ]}
          />
          <PlanCard
            name="Team"
            badge="Recommended"
            price="$39"
            period="per month, billed yearly"
            description="For small teams running real work."
            cta="Start 14-day trial"
            ctaPrimary
            highlighted
            features={[
              { text: '5 seats' },
              { text: 'All agents & flows' },
              { text: 'Knowledge (pgvector)' },
              { text: '$20 AI credit every month' },
              { text: 'Email support' },
            ]}
          />
          <PlanCard
            name="Business"
            price="$159"
            period="per month, billed yearly"
            description="For companies with many areas."
            cta="Start 14-day trial"
            features={[
              { text: '25 seats' },
              { text: 'Everything in Team' },
              { text: 'Google domain sign-in' },
              { text: '1-year activity log' },
              { text: 'Priority support' },
            ]}
          />
        </div>

        {/* Footer notes */}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center', gap: 32, fontSize: 12.5, color: '#78716C' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#A8A29E' }}>✦</span>
            AI usage billed at cost — or bring your own Anthropic key
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#A8A29E' }}>✦</span>
            Self-hosting? The open-source version needs no plan
          </span>
        </div>
      </div>
    </OnboardingLayout>
  )
}
