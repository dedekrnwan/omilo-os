/** Choose company — /auth/choose-company (pen Ltj2k). */
import { ArrowRight, Plus } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthTitle, GoogleLogo } from './AuthPrimitives'

const COMPANIES = [
  { name: 'Sahabat Warga', initial: 'S', color: '#EB6834', meta: 'Owner · 4 members · opened today', current: true },
  { name: 'Kopi Kenangan', initial: 'K', color: '#6366F1', meta: 'Admin · 12 members · 3 need you', current: false },
]

export function ChooseCompanyPage() {
  return (
    <AuthLayout>
      <AuthTitle title="Welcome back, Dede" sub="Pick a company to open. You can switch any time from the rail." />
      <div className="flex w-full flex-col gap-[8px]">
        {COMPANIES.map((c) => (
          <a
            key={c.name}
            href="/office/inbox"
            className="flex w-full items-center gap-[12px] rounded-lg p-[12px] transition-colors hover:bg-soft"
            style={{ boxShadow: c.current ? 'inset 0 0 0 1.5px #171717' : 'inset 0 0 0 1px var(--color-line-strong)' }}
          >
            <span
              className="flex size-[36px] shrink-0 items-center justify-center rounded-[10px] text-[15px] font-bold text-white"
              style={{ background: c.color }}
            >
              {c.initial}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[14px] font-semibold text-ink">{c.name}</span>
              <span className="text-[12px] text-muted">{c.meta}</span>
            </span>
            <ArrowRight size={16} aria-hidden className={c.current ? 'text-ink' : 'text-faint'} />
          </a>
        ))}
        <a
          href="/auth/onboarding/company"
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
        </a>
      </div>
      <div className="flex w-full items-center justify-center gap-[8px] text-[12.5px]">
        <GoogleLogo size={14} />
        <span className="text-muted">dede@saga.co.id</span>
        <span className="text-faint">·</span>
        <a href="/auth/sign-in" className="font-medium text-link hover:underline">
          Switch account
        </a>
      </div>
    </AuthLayout>
  )
}
