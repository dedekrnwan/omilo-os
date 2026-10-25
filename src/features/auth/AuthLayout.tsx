/**
 * Auth layouts (pen: `Auth · *` screens).
 *
 * - `AuthLayout` — split screen: 600px Brand panel (Omilo mark, mascot team,
 *   headline) + centred 360px form column with fine print.
 * - `OnboardingLayout` — company setup flow (Create company → Payment → All set):
 *   64px top bar with the 4-step stepper, body centred on the app background.
 *
 * Standalone (no Shell / Rail). Every mascot is the DS `<Mascot>`.
 */

import type { CSSProperties, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { HelperArea } from '../../core/domain/types'
import { Mascot } from '../../ui/ds/Mascot'

// ── Mascot team (pen "Team" frame, layout none) ─────────────────────────────

export interface TeamMember {
  area: HelperArea
  size: number
  radius: number
  x: number
  y: number
}

/**
 * A plain `Mascot` with the pen instance's 3px `$app` stroke (centred: half
 * painted over the tile, half outside) — it separates the overlapping tiles.
 */
export function RingedMascot({ area, size, radius, style }: Omit<TeamMember, 'x' | 'y'> & { style?: CSSProperties }) {
  return (
    <span
      className="absolute"
      style={{ width: size, height: size, borderRadius: radius, boxShadow: '0 0 0 1.5px var(--color-app)', ...style }}
    >
      <Mascot area={area} size={size} radius={radius} className="!block" />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ borderRadius: radius, boxShadow: 'inset 0 0 0 1.5px var(--color-app)' }}
      />
    </span>
  )
}

export function MascotTeam({ members, width, height }: { members: TeamMember[]; width: number; height: number }) {
  return (
    <div className="relative shrink-0" style={{ width, height }}>
      {members.map((m) => (
        <RingedMascot key={m.area} area={m.area} size={m.size} radius={m.radius} style={{ left: m.x, top: m.y }} />
      ))}
    </div>
  )
}

const BRAND_TEAM: TeamMember[] = [
  { area: 'dev', size: 72, radius: 20, x: 0, y: 40 },
  { area: 'marketing', size: 64, radius: 18, x: 62, y: 62 },
  { area: 'brand', size: 104, radius: 29, x: 124, y: 10 },
  { area: 'ops', size: 66, radius: 18, x: 224, y: 58 },
  { area: 'finance', size: 58, radius: 16, x: 282, y: 44 },
]

// ── Split layout ─────────────────────────────────────────────────────────────

function BrandPanel() {
  return (
    <aside
      className="flex w-[600px] shrink-0 flex-col justify-between bg-app p-[48px]"
      style={{ boxShadow: 'inset -1px 0 0 var(--color-line-strong)' }}
    >
      <div className="flex items-center gap-[10px]">
        <Mascot size={30} radius={8} title="Omilo" />
        <span className="font-display text-[20px] font-semibold text-ink">Omilo</span>
      </div>

      <div className="flex w-full flex-col gap-[28px]">
        <MascotTeam members={BRAND_TEAM} width={340} height={150} />
        <div className="flex w-full flex-col gap-[10px]">
          <h2 className="font-display w-full text-[34px] leading-[1.15] font-semibold tracking-[-0.8px] text-ink">
            Your company, run with a small team of agents.
          </h2>
          <p className="w-[440px] text-[15px] leading-[1.5] text-ink-2">
            Chief plans, the team does the work, and you make the calls that matter.
          </p>
        </div>
      </div>

      <p className="text-[12px] whitespace-pre text-faint">© 2026 Saga  ·  Privacy  ·  Terms</p>
    </aside>
  )
}

export interface AuthLayoutProps {
  children: ReactNode
  /** Top-right step hint, e.g. "Step 1 of 4" (Confirm your email). */
  step?: string
}

/** Split-screen auth layout: Brand panel + centred 360px form. */
export function AuthLayout({ children, step }: AuthLayoutProps) {
  return (
    <div className="relative flex h-svh min-h-[640px] w-full overflow-hidden bg-surface">
      <BrandPanel />
      <main className="relative flex min-w-0 flex-1 flex-col items-center justify-center">
        <div className="flex w-[360px] flex-col gap-[18px]">{children}</div>
        <div className="absolute inset-x-0 bottom-[34px] flex justify-center">
          <p className="text-[11.5px] text-faint">By continuing you agree to the Terms and Privacy Policy.</p>
        </div>
      </main>
      {step && (
        <div className="absolute top-[24px] right-[24px] flex items-center justify-end gap-[6px]">
          <span className="text-[12px] text-muted">{step}</span>
        </div>
      )}
    </div>
  )
}

// ── Onboarding (company setup) layout ───────────────────────────────────────

const SETUP_STEPS = ['Account', 'Company', 'Plan', 'Payment'] as const

function Stepper({ current }: { current: number }) {
  return (
    <nav aria-label="Setup steps" className="flex flex-1 items-center justify-center gap-[10px]">
      {SETUP_STEPS.map((label, i) => {
        const n = i + 1
        const done = n < current
        const active = n === current
        return (
          <div key={label} className="flex items-center gap-[10px]">
            {i > 0 && (
              <span
                aria-hidden
                className="h-[1.5px] w-[36px]"
                style={{ background: n <= current ? '#171717' : '#D6D3D1' }}
              />
            )}
            <div className="flex items-center gap-[7px]" aria-current={active ? 'step' : undefined}>
              <span
                aria-hidden
                className={`flex size-[22px] items-center justify-center rounded-full ${done ? 'bg-primary' : active ? 'bg-surface' : ''}`}
                style={
                  done
                    ? undefined
                    : { boxShadow: `inset 0 0 0 1.5px ${active ? '#171717' : '#D6D3D1'}` }
                }
              >
                {done ? (
                  <Check size={12} className="text-white" />
                ) : (
                  <span className={`text-[11px] font-semibold ${active ? 'text-ink' : 'text-faint'}`}>{n}</span>
                )}
              </span>
              <span
                className={`text-[13px] ${active ? 'font-semibold text-ink' : done ? 'text-ink' : 'text-faint'}`}
              >
                {label}
              </span>
            </div>
          </div>
        )
      })}
    </nav>
  )
}

export interface OnboardingLayoutProps {
  children: ReactNode
  /** Active setup step, 1-based (Account, Company, Plan, Payment). 5 = all done. */
  step: number
}

export function OnboardingLayout({ children, step }: OnboardingLayoutProps) {
  return (
    <div className="flex h-svh min-h-[640px] w-full flex-col overflow-hidden bg-app">
      <header
        className="flex h-[64px] w-full shrink-0 items-center bg-surface px-[32px]"
        style={{ boxShadow: 'inset 0 -1px 0 var(--color-line)' }}
      >
        <div className="flex w-[240px] items-center gap-[10px]">
          <Mascot size={26} radius={7} title="Omilo" />
          <span className="font-display text-[17px] font-semibold text-ink">Omilo</span>
        </div>
        <Stepper current={step} />
        <div className="flex w-[240px] items-center justify-end gap-[8px]">
          <span className="text-[12.5px] text-muted">dede@saga.co.id</span>
          <Link to="/auth/sign-in" className="text-[12.5px] font-medium text-link">
            Sign out
          </Link>
        </div>
      </header>
      <main className="flex min-h-0 w-full flex-1 flex-col items-center justify-center pb-[40px]">{children}</main>
    </div>
  )
}
