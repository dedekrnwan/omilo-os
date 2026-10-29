/** Onboarding 5 · Your team (pen V7szb). */
import { useEffect, useState } from 'react'
import { ArrowLeft, Lightbulb, Loader2, Sparkles } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import type { TeamHelper } from './data'
import { planTeam } from './interviewApi'
import { notify } from '../../ui/ds/Toaster'
import { ChipInfo, ChipNeutral, PrimaryButton, QuietButton, Stroke, Switch, WizardCard } from './parts'
import { useSession } from '../../app/session'

export function StepTeam({
  onBack,
  onNext,
}: {
  onBack: () => void
  onNext: (selected: TeamHelper[]) => void
}) {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  // Chief always joins (already created with the company); the rest is planned
  // from the interview notes (POST /v1/onboarding/team-plan).
  const [helpers, setHelpers] = useState<TeamHelper[] | null>(null)
  const [by, setBy] = useState<'ai' | 'rules'>('rules')
  const [on, setOn] = useState<Record<string, boolean>>({})
  useEffect(() => {
    planTeam()
      .then((plan) => {
        const list: TeamHelper[] = [
          { id: 'chief', name: 'Chief of Staff', area: 'brand', role: 'runs the team',
            description: 'Writes your morning brief, routes every request, and runs the weekly retro.',
            reason: 'Every team needs one', badge: 'always', on: true },
          ...plan.helpers.map((h) => ({ id: h.id, name: h.name, area: h.area, role: h.role, description: h.description,
            reason: h.reason, on: h.on, badge: h.on ? undefined : ('suggested' as const) })),
        ]
        setHelpers(list)
        setBy(plan.by)
        setOn(Object.fromEntries(list.map((h) => [h.id, h.on])))
      })
      .catch((e) => {
        notify(e instanceof Error ? e.message : 'Couldn’t plan the team')
        setHelpers([])
      })
  }, [])
  const selected = (helpers ?? []).filter((h) => on[h.id])
  const count = selected.length

  return (
    <WizardCard className="flex-col gap-[18px] px-[20px] py-[24px] sm:px-[40px] sm:py-[32px] lg:overflow-y-auto">
      <div className="flex w-full flex-col gap-[4px]">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.4px] text-ink">Your team for {companyName}</h1>
        <p className="w-full text-[14px] text-muted">
          {by === 'ai' ? 'Picked by Chief from what you told it.' : 'Picked from your notes.'} After you create them, each
          helper proposes its own job, and nothing runs until you approve it in Inbox.
        </p>
      </div>
      {helpers === null && (
        <p className="flex items-center gap-[8px] text-[13px] text-muted">
          <Loader2 size={14} aria-hidden className="animate-spin" /> Chief is picking your team…
        </p>
      )}
      <ul className="flex w-full flex-col gap-[10px]">
        {(helpers ?? []).map((h) => {
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
        <PrimaryButton icon={Sparkles} onClick={() => onNext(selected)}>
          Create my team
        </PrimaryButton>
      </div>
    </WizardCard>
  )
}
