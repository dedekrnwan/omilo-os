/** Choose company — /auth/choose-company (pen Ltj2k). */
import { ArrowRight, Plus } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useSession } from '../../app/session'
import { MODE_HOME, useUIStore } from '../../app/store'
import { AuthLayout } from './AuthLayout'
import { AuthTitle, GoogleLogo } from './AuthPrimitives'

export function ChooseCompanyPage() {
  const { companies, user } = useSession()
  const home = MODE_HOME[useUIStore.getState().mode]

  return (
    <AuthLayout>
      <AuthTitle
        title={user ? `Welcome back, ${user.name.split(' ')[0]}` : 'Choose a company'}
        sub="Pick a company to open. You can switch any time from the rail."
      />
      <div className="flex w-full flex-col gap-[8px]">
        {companies.map((c, i) => (
          <Link
            key={c.id}
            to={home}
            className="flex w-full items-center gap-[12px] rounded-lg p-[12px] transition-colors hover:bg-soft"
            style={{ boxShadow: i === 0 ? 'inset 0 0 0 1.5px #171717' : 'inset 0 0 0 1px var(--color-line-strong)' }}
          >
            <span
              className="flex size-[36px] shrink-0 items-center justify-center rounded-[10px] text-[15px] font-bold text-white"
              style={{ background: '#6366F1' }}
            >
              {c.name.charAt(0)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[14px] font-semibold text-ink">{c.name}</span>
            </span>
            <ArrowRight size={16} aria-hidden className={i === 0 ? 'text-ink' : 'text-faint'} />
          </Link>
        ))}
        <Link
          to="/auth/onboarding/company"
          className="flex w-full items-center gap-[12px] rounded-lg p-[12px] transition-colors hover:bg-soft"
          style={{ boxShadow: 'inset 0 0 0 1px #D6D3D1' }}
        >
          <span className="flex size-[36px] shrink-0 items-center justify-center rounded-[10px] bg-app">
            <Plus size={16} aria-hidden className="text-ink-2" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[14px] font-medium text-ink">Create a new company</span>
            <span className="text-[12px] text-muted">Chief helps you set it up in about 5 minutes</span>
          </span>
        </Link>
      </div>
      {user && (
        <div className="flex w-full items-center justify-center gap-[8px] text-[12.5px]">
          <GoogleLogo size={14} />
          <span className="text-muted">{user.email}</span>
          <span className="text-faint">·</span>
          <Link to="/auth/sign-in" className="font-medium text-link hover:underline">
            Switch account
          </Link>
        </div>
      )}
    </AuthLayout>
  )
}
