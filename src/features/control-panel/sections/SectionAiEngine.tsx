import { useEffect, useState } from 'react'
import {
  Breadcrumb,
  RowDivider,
  Rule,
  SaveBar,
  SectionPane,
  SelectField,
  SettingCardRows,
  SettingRow,
  SubHeading,
  TextInput,
  Toggle,
} from '../legacyShared'
import { useSectionSave } from '../ControlPanelShared'
import { Mascot } from '../../../ui/ds/Mascot'
import { useCompanySettings, useUpdateCompanySettings } from '../../../app/queries'
import { notify } from '../../../ui/ds/Toaster'

const ROLES = [
  {
    area: 'ops' as const,
    role: 'Chief',
    desc: 'Plans, decides and talks with you.',
    budget: '$50 / 41 tokens',
    model: 'Opus 5.5',
  },
  {
    area: 'dev' as const,
    role: 'Agents',
    desc: 'Dev, Ops, Growth, Sales, Finance',
    budget: '$11 / 94 tokens',
    model: 'Sonnet 5.5',
  },
  {
    area: 'marketing' as const,
    role: 'Quick steps',
    desc: 'Classify, extract and summarise in flows.',
    budget: '$0.60 / 60 tokens',
    model: 'Haiku 5.5',
  },
]

const INITIAL = {
  warnAt80: true,
  askOverDollar: true,
  fallback: false,
  autoCompact: true,
}

const DEFAULT_KEEP = ['Decisions', 'Pinned messages', 'Files']

export function SectionAiEngine() {
  const { data: settings } = useCompanySettings()
  const updateSettings = useUpdateCompanySettings()

  const [warnAt80, setWarnAt80] = useState(INITIAL.warnAt80)
  const [askOverDollar, setAskOverDollar] = useState(INITIAL.askOverDollar)
  const [fallback, setFallback] = useState(INITIAL.fallback)
  const [autoCompact, setAutoCompact] = useState(INITIAL.autoCompact)
  const [showContextMeter, setShowContextMeter] = useState(true)
  const [alwaysKeep, setAlwaysKeep] = useState<Set<string>>(() => new Set(DEFAULT_KEEP))

  async function persist() {
    await updateSettings.mutateAsync({
      aiEngine: {
        warnAt80,
        askOverDollar,
        fallback,
        autoCompact,
        showContextMeter,
        alwaysKeep: [...alwaysKeep],
      },
    })
    notify('AI engine settings saved')
  }

  function reset() {
    setWarnAt80(INITIAL.warnAt80)
    setAskOverDollar(INITIAL.askOverDollar)
    setFallback(INITIAL.fallback)
    setAutoCompact(INITIAL.autoCompact)
    setShowContextMeter(true)
    setAlwaysKeep(new Set(DEFAULT_KEEP))
  }

  const { dirty, saving, error, saved, markDirty: mark, save: handleSave, discard: handleDiscard } = useSectionSave(persist, reset)

  // Hydrate from persisted settings when they arrive (unless the user is editing).
  useEffect(() => {
    if (dirty) return
    const e = settings?.aiEngine as Record<string, unknown> | undefined
    if (!e) return
    if (typeof e.warnAt80 === 'boolean') setWarnAt80(e.warnAt80)
    if (typeof e.askOverDollar === 'boolean') setAskOverDollar(e.askOverDollar)
    if (typeof e.fallback === 'boolean') setFallback(e.fallback)
    if (typeof e.autoCompact === 'boolean') setAutoCompact(e.autoCompact)
    if (typeof e.showContextMeter === 'boolean') setShowContextMeter(e.showContextMeter)
    if (Array.isArray(e.alwaysKeep)) setAlwaysKeep(new Set(e.alwaysKeep as string[]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  function toggleAlwaysKeep(label: string) {
    setAlwaysKeep((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
    mark()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="AI engine" />
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">AI engine</h1>
        <p className="mb-[4px] text-[13px] text-muted">Which model each part of Omilo thinks with, and how much it can spend.</p>

        {/* This month stats */}
        <div className="mb-[24px] flex items-end gap-[8px]">
          <span className="text-[36px] font-semibold text-ink leading-none">$182</span>
          <span className="mb-[4px] text-[13px] text-muted">of $400 budget</span>
          <div className="ml-auto flex items-center gap-[16px] text-[12px] text-muted">
            <span>Runs 1,284</span>
            <span>Avg a run $0.014</span>
            <span>Renews Nov 1</span>
          </div>
        </div>
        {/* Mini usage bar */}
        <div className="mb-[4px] h-[6px] overflow-hidden rounded-full bg-line-strong">
          <div className="flex h-full">
            <div className="h-full bg-[#6366F1]" style={{ width: '35%' }} />
            <div className="h-full bg-[#0EA5E9]" style={{ width: '28%' }} />
            <div className="h-full bg-[#14B8A6]" style={{ width: '10%' }} />
          </div>
        </div>
        <div className="mb-[24px] flex gap-[12px] text-[11.5px] text-muted">
          <span className="flex items-center gap-[4px]"><span className="size-[8px] rounded-full bg-[#6366F1]" />Chief $88</span>
          <span className="flex items-center gap-[4px]"><span className="size-[8px] rounded-full bg-[#0EA5E9]" />Agents $76</span>
          <span className="flex items-center gap-[4px]"><span className="size-[8px] rounded-full bg-[#14B8A6]" />Quick steps $18</span>
        </div>

        {/* Models by role */}
        <SubHeading label="Models by role" />
        <p className="mb-[12px] text-[12px] text-muted">Change role and every agent in that role switches on the next run.</p>
        <div className="mb-[24px] flex flex-col gap-px overflow-hidden rounded-lg border border-line-strong bg-surface">
          {ROLES.map((r, i) => (
            <div key={r.role} className={`flex items-center gap-[14px] px-[16px] py-[12px] ${i < ROLES.length - 1 ? 'border-b border-line' : ''}`}>
              <Mascot helper size={28} radius={8} area={r.area} tile />
              <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="text-[13px] font-semibold text-ink">{r.role}</span>
                <span className="text-[12px] text-muted">{r.desc}</span>
              </div>
              <span className="text-[12px] text-muted">{r.budget}</span>
              <SelectField value={r.model} />
            </div>
          ))}
        </div>

        {/* Budget & limits */}
        <SubHeading label="Budget & limits" />
        <SettingCardRows>
          <SettingRow label="Monthly budget" desc="AI must pause when it's reached. Connectors and aoks keep running.">
            <TextInput value="$ 400" width={120} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Warn me at 80%" desc="WhatsApp + inbox when this month passes $320.">
            <Toggle on={warnAt80} onClick={() => { setWarnAt80((v) => !v); mark() }} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Ask before a single run over $1" desc="Long research or big documents wait for your OK.">
            <Toggle on={askOverDollar} onClick={() => { setAskOverDollar((v) => !v); mark() }} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Fall back when a model is busy" desc="Chief drops to Sonnet 5.5 instead of waiting.">
            <Toggle on={fallback} onClick={() => { setFallback((v) => !v); mark() }} />
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Context & compaction */}
        <SubHeading label="Context & compaction" />
        <p className="mb-[12px] text-[12px] text-muted">Every model has a context limit. When a chat gets close, helpers summarise older messages so they can keep going.</p>
        <SettingCardRows>
          <SettingRow label="Auto-compact" desc="Summarise older messages automatically. People can still turn it off per chat.">
            <Toggle on={autoCompact} onClick={() => { setAutoCompact((v) => !v); mark() }} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Compact when the chat is" desc="Percent of the model's window. Opus 5.5 = 200k, GPT 4.1 = 410k.">
            <SelectField value="85% full" width={140} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Always keep word-for-word" desc="Never summarises, even after compacting.">
            <div className="flex gap-[8px]">
              {['Decisions', 'Pinned messages', 'Files'].map((label) => {
                const on = alwaysKeep.has(label)
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleAlwaysKeep(label)}
                    className={`rounded-pill border px-[8px] py-[3px] text-[12px] transition-colors ${
                      on
                        ? 'border-ink bg-ink text-primary-ink'
                        : 'border-line-strong bg-soft text-ink hover:bg-hover'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </SettingRow>
          <RowDivider />
          <SettingRow label="Show context meter in composer" desc="The small ring next to the model picker.">
            <Toggle on={showContextMeter} onClick={() => { setShowContextMeter((v) => !v); mark() }} />
          </SettingRow>
        </SettingCardRows>
      </SectionPane>

      <SaveBar dirty={dirty} saving={saving} error={error} saved={saved} onSave={handleSave} onDiscard={handleDiscard} />
    </div>
  )
}
