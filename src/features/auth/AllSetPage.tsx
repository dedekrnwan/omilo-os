/** All set — /auth/onboarding/all-set (pen CXuxX). */
import { ArrowRight, CircleCheck, UserPlus } from 'lucide-react'
import { MascotTeam, OnboardingLayout } from './AuthLayout'
import type { TeamMember } from './AuthLayout'
import { AuthButton } from './AuthPrimitives'

const TEAM: TeamMember[] = [
  { area: 'dev', size: 64, radius: 18, x: 0, y: 36 },
  { area: 'marketing', size: 56, radius: 16, x: 54, y: 54 },
  { area: 'brand', size: 96, radius: 27, x: 108, y: 4 },
  { area: 'ops', size: 58, radius: 16, x: 196, y: 50 },
  { area: 'finance', size: 52, radius: 15, x: 246, y: 38 },
]

const DONE = [
  { t: 'Account created', d: 'dede@saga.co.id' },
  { t: 'Company set up', d: 'Sahabat Warga · Asia/Jakarta' },
  { t: 'Team plan · trial', d: '5 seats · $20 AI credit' },
  { t: 'Agents hired', d: 'Chief, Dev, Ops, Growth, Finance' },
]

export function AllSetPage() {
  return (
    <OnboardingLayout step={5}>
      <div className="flex w-[520px] flex-col items-center gap-[22px]">
        <MascotTeam members={TEAM} width={300} height={130} />
        <div className="flex w-full flex-col items-center gap-[6px]">
          <h1 className="font-display text-[30px] font-semibold tracking-[-0.6px] text-ink">Sahabat Warga is ready</h1>
          <p className="text-center text-[14px] text-muted">
            Your Team trial runs until Nov 7. Chief is waiting to meet you.
          </p>
        </div>
        <ul className="flex w-full flex-col gap-[2px] rounded-[14px] bg-surface px-[16px] py-[6px] outline-1 -outline-offset-1 outline-line-strong">
          {DONE.map((r, i) => (
            <li
              key={r.t}
              className="flex w-full items-center gap-[10px] py-[10px]"
              style={i < DONE.length - 1 ? { boxShadow: 'inset 0 -1px 0 var(--color-line)' } : undefined}
            >
              <CircleCheck size={16} aria-hidden className="shrink-0 text-ok" />
              <span className="flex-1 text-[13.5px] font-medium text-ink">{r.t}</span>
              <span className="text-[12.5px] text-muted">{r.d}</span>
            </li>
          ))}
        </ul>
        <div className="flex w-full gap-[10px]">
          <AuthButton variant="secondary" icon={UserPlus} to="/control-panel/members">
            Invite teammates
          </AuthButton>
          <AuthButton icon={ArrowRight} to="/chat/ch-general">
            Meet Chief
          </AuthButton>
        </div>
      </div>
    </OnboardingLayout>
  )
}
