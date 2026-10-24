/** Create company — /auth/onboarding/company (pen OsWDG). */
import { Globe, Users } from 'lucide-react'
import { OnboardingLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthSelect } from './AuthPrimitives'

export function CreateCompanyPage() {
  return (
    <OnboardingLayout step={2}>
      <div className="flex w-[440px] flex-col gap-[20px]">
        <div className="flex w-full flex-col items-center gap-[6px]">
          <h1 className="font-display text-[30px] font-semibold tracking-[-0.6px] text-ink">Set up your company</h1>
          <p className="text-center text-[14px] text-muted">
            Agents use this to introduce themselves and write in your voice.
          </p>
        </div>
        <div className="flex w-full flex-col gap-[14px] rounded-[16px] bg-surface p-[24px] outline-1 -outline-offset-1 outline-line-strong">
          <div className="flex w-full items-center gap-[12px]">
            <span className="flex size-[44px] shrink-0 items-center justify-center rounded-lg bg-[#EB6834] text-[18px] font-bold text-white">
              S
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
              <span className="text-[13px] font-medium text-ink">Company logo</span>
              <span className="text-[12px] text-muted">Optional — we’ll use your initial</span>
            </div>
            <button
              type="button"
              className="flex h-[30px] items-center rounded-btn bg-surface px-[14px] text-[12px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
            >
              Upload
            </button>
          </div>
          <AuthField id="company-name" label="Company name" defaultValue="Sahabat Warga" />
          <AuthField
            id="what-you-do"
            label="What you do"
            defaultValue="SaaS for RT/RW neighborhoods in Indonesia"
            help="One line. Chief uses it in every intro."
          />
          <div className="flex w-full gap-[12px]">
            <AuthSelect label="Team size" icon={Users} value="2–10 people" />
            <AuthSelect label="Time zone" icon={Globe} value="Asia/Jakarta" />
          </div>
        </div>
        <AuthButton onClick={() => (window.location.href = '/auth/onboarding/plan')}>Continue</AuthButton>
      </div>
    </OnboardingLayout>
  )
}
