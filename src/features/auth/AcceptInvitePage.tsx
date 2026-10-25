/** Accept invite — /auth/invite (pen kIAtu). */
import { Mail } from 'lucide-react'
import type { HelperArea } from '../../core/domain/types'
import { Mascot } from '../../ui/ds/Mascot'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthTitle, GoogleButton } from './AuthPrimitives'

const ROWS = [
  { k: 'Role', v: 'Member' },
  { k: 'Channels', v: 'Business, General' },
]
const AGENTS: { area: HelperArea; name: string }[] = [
  { area: 'brand', name: 'Chief' },
  { area: 'sales', name: 'Sales' },
  { area: 'finance', name: 'Finance' },
]
const ring = '0 0 0 3px var(--color-surface)'

export function AcceptInvitePage() {
  return (
    <AuthLayout>
      <div className="flex items-center">
        <span
          className="relative flex size-[44px] items-center justify-center rounded-full bg-[#0EA5E9] text-[14px] font-semibold text-white"
          style={{ boxShadow: ring }}
          aria-label="Rina"
        >
          RA
        </span>
        <span
          className="relative -ml-[8px] flex size-[44px] items-center justify-center rounded-lg bg-[#EB6834] text-[17px] font-bold text-white"
          style={{ boxShadow: ring }}
          aria-label="Sahabat Warga"
        >
          S
        </span>
      </div>
      <AuthTitle
        title="Rina invited you to Sahabat Warga"
        sub="You’ll join as a Member. Sign in with andi@saga.co.id to accept."
      />
      <dl className="flex w-full flex-col rounded-lg bg-soft px-[14px] py-[4px]">
        {ROWS.map((r) => (
          <div
            key={r.k}
            className="flex w-full items-center gap-[10px] py-[10px]"
            style={{ boxShadow: 'inset 0 -1px 0 var(--color-line)' }}
          >
            <dt className="flex-1 text-[12.5px] text-muted">{r.k}</dt>
            <dd className="text-[12.5px] font-medium text-ink">{r.v}</dd>
          </div>
        ))}
        <div className="flex w-full items-center gap-[10px] py-[10px]">
          <dt className="flex-1 text-[12.5px] text-muted">Agents you’ll work with</dt>
          <dd className="flex gap-[3px]">
            {AGENTS.map((a) => (
              <Mascot key={a.area} area={a.area} size={20} radius={6} title={a.name} />
            ))}
          </dd>
        </div>
      </dl>
      <GoogleButton to="/office/inbox">Accept with Google</GoogleButton>
      <AuthButton variant="secondary" icon={Mail} to="/auth/check-email">
        Accept with an email code
      </AuthButton>
      <p className="w-full text-center text-[12px] text-faint">Invite expires in 6 days</p>
    </AuthLayout>
  )
}
