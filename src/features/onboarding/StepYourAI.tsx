/** Onboarding 2 · Your AI — Self-host (pen InMeZ) / Cloud (pen CbbZR). */
import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { AI_MODES } from './data'
import type { AIMode, AIOption } from './data'
import { ChipNeutral, IconTile, Pill, PrimaryButton, QuietButton, Radio, WizardCard } from './parts'

function Option({ option, selected, onSelect }: { option: AIOption; selected: boolean; onSelect: () => void }) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={`flex w-full cursor-pointer flex-col gap-[10px] rounded-md p-[16px] ${selected ? 'bg-surface' : ''}`}
      style={{
        boxShadow: selected ? 'inset 0 0 0 2px var(--color-ink)' : 'inset 0 0 0 1px var(--color-line-strong)',
      }}
    >
      <div className="flex w-full items-center gap-[12px]">
        <Radio on={selected} />
        <IconTile icon={option.icon} />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[15px] font-semibold text-ink">{option.title}</span>
          <span className="w-full text-[13px] text-muted">{option.desc}</span>
        </div>
        {selected && option.found && <ChipNeutral>Recommended</ChipNeutral>}
      </div>
      {selected && option.found && (
        <div className="flex w-full items-center gap-[8px] pt-[2px] pl-[72px]">
          <span aria-hidden className="size-[7px] shrink-0 rounded-full bg-ok" />
          <span className="font-mono text-[12px] text-ink-2">{option.found.value}</span>
          <span className="text-[12px] text-muted">{option.found.note}</span>
          <span className="h-px flex-1" />
          <a href="#" onClick={(e) => e.stopPropagation()} className="text-[12px] font-medium text-link hover:underline">
            {option.found.link}
          </a>
        </div>
      )}
      {option.chips && (
        <div className="flex gap-[6px] pl-[76px]">
          {option.chips.map((c) => (
            <Pill key={c}>{c}</Pill>
          ))}
        </div>
      )}
    </div>
  )
}

export function StepYourAI({
  initialMode = 'self-host',
  onBack,
  onNext,
}: {
  initialMode?: AIMode
  onBack: () => void
  onNext: () => void
}) {
  const [mode, setMode] = useState<AIMode>(initialMode)
  const copy = AI_MODES[mode]
  const [picked, setPicked] = useState<Record<AIMode, string>>({
    'self-host': AI_MODES['self-host'].options[0].id,
    cloud: AI_MODES.cloud.options[0].id,
  })

  const seg = (id: AIMode, label: string) => {
    const on = mode === id
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        onClick={() => setMode(id)}
        className={`flex h-[28px] items-center rounded-sm px-[10px] text-[12px] font-medium ${on ? 'bg-surface text-ink' : 'text-muted'}`}
        style={on ? { boxShadow: '0 1px 2px #00000014' } : undefined}
      >
        {label}
      </button>
    )
  }

  return (
    <WizardCard>
      <div className="flex min-w-0 flex-1 flex-col gap-[16px] px-[48px] py-[44px]">
        <div className="flex items-center gap-[10px]">
          <Mascot helper area="brand" size={24} radius={7} title="Chief of Staff" />
          <span className="text-[12px] text-muted">Step 1 of 4</span>
        </div>
        <h1 className="font-display text-[30px] font-semibold tracking-[-0.5px] text-ink">{copy.title}</h1>
        <p className="w-full text-[15px] leading-[1.55] text-ink-2">{copy.lead}</p>
        <div className="flex w-full items-center gap-[12px]">
          <div
            role="radiogroup"
            aria-label="Where it runs"
            className="flex gap-[2px] rounded-base bg-soft p-[2px] outline-1 -outline-offset-1 outline-line"
          >
            {seg('self-host', 'Self-host')}
            {seg('cloud', 'Cloud')}
          </div>
          <span className="text-[13px] text-muted">{copy.hint}</span>
        </div>
        <div role="radiogroup" aria-label="AI account" className="contents">
          {copy.options.map((o) => (
            <Option
              key={o.id}
              option={o}
              selected={picked[mode] === o.id}
              onSelect={() => setPicked((p) => ({ ...p, [mode]: o.id }))}
            />
          ))}
        </div>
        <div className="w-px flex-1" />
        <div className="flex w-full items-center gap-[10px]">
          <QuietButton icon={ArrowLeft} onClick={onBack}>
            Back
          </QuietButton>
          <span className="h-px flex-1" />
          <span className="text-[13px] text-muted">{copy.footQ}</span>
          <button
            type="button"
            onClick={() => mode === 'cloud' && setMode('self-host')}
            className="text-[13px] font-medium text-link hover:underline"
          >
            {copy.footA}
          </button>
          <PrimaryButton icon={ArrowRight} onClick={onNext}>
            {copy.cta}
          </PrimaryButton>
        </div>
      </div>

      <aside
        className="flex w-[360px] shrink-0 flex-col gap-[18px] bg-soft px-[32px] py-[44px]"
        style={{ boxShadow: 'inset 1px 0 0 var(--color-line)' }}
      >
        <h2 className="text-[11px] font-semibold tracking-[1px] text-muted">GOOD TO KNOW</h2>
        {copy.good.map((g) => (
          <div key={g.title} className="flex w-full gap-[12px]">
            <IconTile icon={g.icon} />
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="text-[13px] font-semibold text-ink">{g.title}</span>
              <span className="w-full text-[12px] leading-[1.5] text-muted">{g.desc}</span>
            </div>
          </div>
        ))}
      </aside>
    </WizardCard>
  )
}
