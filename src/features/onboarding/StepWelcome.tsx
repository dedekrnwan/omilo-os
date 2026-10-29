/** Onboarding 1 · Welcome (pen VYHu4). */
import { ArrowRight } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { KNOWLEDGE_NOTES, WELCOME_STEPS } from './data'
import { PrimaryButton, Stroke, WizardCard } from './parts'
import { useSession } from '../../app/session'

export function StepWelcome({ onNext }: { onNext: () => void }) {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  return (
    <WizardCard>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[22px] p-[24px] sm:p-[40px] lg:min-h-0 lg:overflow-y-auto lg:p-[56px]">
        <div className="flex items-end">
          <Mascot helper area="brand" size={56} radius={16} title="Chief of Staff" />
          <Mascot helper area="dev" size={44} radius={12} title="Builder" className="-ml-[8px]" />
          <Mascot helper area="ops" size={44} radius={12} title="Grower" className="-ml-[8px]" />
        </div>
        <h1 className="font-display text-[28px] leading-[1.1] font-semibold tracking-[-0.8px] text-ink sm:text-[40px]">
          Let's build your AI team
        </h1>
        <p className="w-full max-w-[460px] text-[16px] leading-[1.6] text-ink-2">
          I'm Chief of Staff. I'll ask about {companyName} the way a good advisor would: one question at a time,
          with ideas when you're not sure. Then I'll suggest a team that fits.
        </p>
        <ol className="flex w-full max-w-[460px] flex-col gap-[10px]">
          {WELCOME_STEPS.map((s) => (
            <li key={s.n} className="flex w-full items-center gap-[12px]">
              <span
                className="flex size-[26px] shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-semibold text-ink"
                style={{ boxShadow: 'inset 0 0 0 1px var(--color-line-strong)' }}
              >
                {s.n}
              </span>
              <span className="flex-1 text-[14px] font-medium text-ink">{s.label}</span>
              <span className="font-mono text-[12px] text-muted">{s.time}</span>
            </li>
          ))}
        </ol>
        <div className="flex items-center gap-[10px] pt-[6px]">
          <PrimaryButton icon={ArrowRight} px={20} onClick={onNext}>
            Let's start
          </PrimaryButton>
          <span className="text-[12px] text-muted">You can stop anytime and pick up later.</span>
        </div>
      </div>

      <aside
        className="flex w-full shrink-0 flex-col justify-center gap-[14px] border-t border-[var(--color-line)] bg-soft px-[24px] py-[28px] sm:px-[36px] lg:w-[440px] lg:border-t-0 lg:border-l lg:py-[40px]"
      >
        <h2 className="text-[11px] font-semibold tracking-[1px] text-muted">WHAT YOUR TEAM WILL KNOW</h2>
        <p className="w-full text-[13px] leading-[1.5] text-ink-2">
          Everything you tell me becomes 7 short notes. Helpers read them before every job, and you can edit them
          anytime in Company.
        </p>
        <ul className="flex w-full flex-col gap-[6px]">
          {KNOWLEDGE_NOTES.map(({ id, icon: Icon, label, meta }) => (
            <li key={id} className="relative flex w-full items-center gap-[10px] rounded-base bg-surface px-[12px] py-[8px]">
              <Icon size={14} aria-hidden className="shrink-0 text-ink-2" />
              <span className="text-[13px] font-semibold text-ink">{label}</span>
              <span className="min-w-0 flex-1 text-[12px] text-muted">{meta}</span>
              <span
                aria-label="not yet"
                className="size-[8px] shrink-0 rounded-full"
                style={{ boxShadow: 'inset 0 0 0 1.5px var(--color-wire-strong)' }}
              />
              <Stroke color="var(--color-line)" />
            </li>
          ))}
        </ul>
      </aside>
    </WizardCard>
  )
}
