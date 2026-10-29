/** Onboarding 5 · Your team (pen V7szb). */
import { useState } from 'react'
import { ArrowLeft, Lightbulb, Sparkles } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { TEAM_HELPERS } from './data'
import { ChipInfo, ChipNeutral, PrimaryButton, QuietButton, Stroke, Switch, WizardCard } from './parts'
import { useSession } from '../../app/session'

export function StepTeam({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: (selectedHelperIds: string[]) => void
}) {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(TEAM_HELPERS.map((h) => [h.id, h.on])),
  )
  const selectedIds = TEAM_HELPERS.filter((h) => on[h.id]).map((h) => h.id)
  const count = selectedIds.length

  return (
    <WizardCard className="flex-col gap-[18px] px-[20px] py-[24px] sm:px-[40px] sm:py-[32px] lg:overflow-y-auto">
      <div className="flex w-full flex-col gap-[4px]">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.4px] text-ink">Your team for {companyName}</h1>
        <p className="w-full text-[14px] text-muted">
          Picked from your goals. After you create them, each helper proposes its own job, and nothing runs until you
          approve it in Inbox.
        </p>
      </div>
      <ul className="flex w-full flex-col gap-[10px]">
        {TEAM_HELPERS.map((h) => {
          const enabled = on[h.id]
          return (
            <li
              key={h.id}
              className={`relative flex w-full items-center gap-[16px] rounded-md px-[16px] py-[14px] ${enabled ? '' : 'bg-soft'}`}
            >
              <Mascot helper area={h.area} size={44} radius={12} title={h.name} />
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <div className="flex items-center gap-[8px]">
                  <span className="text-[15px] font-semibold text-ink">{h.name}</span>
                  <span className="text-[12px] text-muted">{h.role}</span>
                  {h.badge === 'always' && <ChipNeutral>Always included</ChipNeutral>}
                  {h.badge === 'suggested' && <ChipInfo>Suggested</ChipInfo>}
                </div>
                <p className="w-full text-[13px] text-ink-2">{h.description}</p>
                <div className="flex items-center gap-[6px]">
                  <Lightbulb size={12} aria-hidden className="text-spark" />
                  <span className="text-[12px] text-muted">{h.reason}</span>
                </div>
              </div>
              <Switch
                on={enabled}
                label={`Hire ${h.name}`}
                disabled={h.badge === 'always'}
                onChange={(v) => setOn((s) => ({ ...s, [h.id]: v }))}
              />
              <Stroke color={enabled ? 'var(--color-line-strong)' : 'var(--color-line)'} />
            </li>
          )
        })}
      </ul>
      <div className="w-full flex-1" />
      <div className="flex w-full items-center gap-[10px]">
        <QuietButton icon={ArrowLeft} onClick={onBack}>
          Back
        </QuietButton>
        <span className="h-px flex-1" />
        <span className="text-[12px] text-muted">{count} helpers · they sleep until they have work</span>
        <PrimaryButton icon={Sparkles} onClick={() => onNext(selectedIds)}>
          Create my team
        </PrimaryButton>
      </div>
    </WizardCard>
  )
}
