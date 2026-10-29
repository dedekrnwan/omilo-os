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
import { useCompanySettings, useHelpers, useSubscription, useUpdateCompanySettings, useUsage } from '../../../app/queries'
import { notify } from '../../../ui/ds/Toaster'
import { shortDate } from '../format'

type RoleKey = 'chief' | 'agents' | 'quick'

const ROLES: { key: RoleKey; area: 'ops' | 'dev' | 'marketing'; role: string; desc: string; model: string }[] = [
  { key: 'chief', area: 'ops', role: 'Chief', desc: 'Plans, decides and talks with you.', model: 'Opus 5.5' },
  { key: 'agents', area: 'dev', role: 'Agents', desc: 'Dev, Ops, Growth, Sales, Finance', model: 'Sonnet 5.5' },
  { key: 'quick', area: 'marketing', role: 'Quick steps', desc: 'Classify, extract and summarise in flows.', model: 'Haiku 5.5' },
]

const MODELS = ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'GPT 4.1', 'GPT 4.1 mini', 'Gemini 2.5 Pro', 'Gemini 2.5 Flash']
const COMPACT_AT = ['70% full', '80% full', '85% full', '90% full', '95% full']

type RoleState = Record<RoleKey, { model: string; budget: string }>

const INITIAL_ROLES: RoleState = {
  chief: { model: 'Opus 5.5', budget: '' },
  agents: { model: 'Sonnet 5.5', budget: '' },
  quick: { model: 'Haiku 5.5', budget: '' },
}

const INITIAL = {
  warnAt80: true,
  askOverDollar: true,
  fallback: false,
  autoCompact: true,
  monthlyBudget: '',
  compactAt: '85% full',
}

const toCredits = (v: string): number | null => {
  const n = parseInt(v.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
const fmtCredits = (n: number) => n.toLocaleString()

const DEFAULT_KEEP = ['Decisions', 'Pinned messages', 'Files']

export function SectionAiEngine() {
  const { data: settings } = useCompanySettings()
  const updateSettings = useUpdateCompanySettings()
  const { data: usage } = useUsage()
  const { data: subscription } = useSubscription()
  const { data: helpers = [] } = useHelpers()
  const [roles, setRoles] = useState<RoleState>(INITIAL_ROLES)
  const [monthlyBudget, setMonthlyBudget] = useState(INITIAL.monthlyBudget)
  const [compactAt, setCompactAt] = useState(INITIAL.compactAt)

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
        compactAt,
        // Read by the runtime: per-role model routing + monthly budgets
        // (omilo/engine/routing.py, billing/balance.py).
        monthlyBudgetCredits: toCredits(monthlyBudget),
        roles: Object.fromEntries(
          ROLES.map((r) => [r.key, { model: roles[r.key].model, budgetCredits: toCredits(roles[r.key].budget) }]),
        ),
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
    setRoles(INITIAL_ROLES)
    setMonthlyBudget(INITIAL.monthlyBudget)
    setCompactAt(INITIAL.compactAt)
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
    if (typeof e.compactAt === 'string') setCompactAt(e.compactAt)
    if (typeof e.monthlyBudgetCredits === 'number') setMonthlyBudget(fmtCredits(e.monthlyBudgetCredits))
    const r = e.roles as Partial<Record<RoleKey, { model?: unknown; budgetCredits?: unknown }>> | undefined
    if (r && typeof r === 'object') {
      setRoles((prev) => {
        const next = { ...prev }
        for (const k of Object.keys(prev) as RoleKey[]) {
          const v = r[k]
          if (!v) continue
          next[k] = {
            model: typeof v.model === 'string' ? v.model : prev[k].model,
            budget: typeof v.budgetCredits === 'number' ? fmtCredits(v.budgetCredits) : '',
          }
        }
        return next
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  // This month's spend split by role (credits), against the monthly budget.
  const chiefIds = new Set(helpers.filter((h) => h.isChief).map((h) => h.id))
  const usedCredits = usage?.usedThisPeriod ?? 0
  const chiefCredits = (usage?.byHelper ?? []).filter((b) => chiefIds.has(b.helperId)).reduce((n, b) => n + b.credits, 0)
  const agentCredits = Math.max(0, usedCredits - chiefCredits)
  const budgetCredits = toCredits(monthlyBudget)
  const scale = Math.max(budgetCredits ?? 0, usedCredits, 1)
  const pct = (n: number) => Math.min(100, Math.round((n / scale) * 100))

  function editRole(key: RoleKey, patch: Partial<{ model: string; budget: string }>) {
    setRoles((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
    mark()
  }

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
          <span className="text-[36px] font-semibold text-ink leading-none">{usedCredits.toLocaleString()}</span>
          <span className="mb-[4px] text-[13px] text-muted">
            credits{budgetCredits ? ` of ${budgetCredits.toLocaleString()} budget` : ' this month'}
          </span>
          <div className="ml-auto flex items-center gap-[16px] text-[12px] text-muted">
            <span>Balance {(usage?.balance ?? 0).toLocaleString()}</span>
            <span>{usage?.byHelper.length ?? 0} helpers active</span>
            {subscription?.currentPeriodEnd && <span>Renews {shortDate(subscription.currentPeriodEnd)}</span>}
          </div>
        </div>
        {/* Mini usage bar */}
        <div className="mb-[4px] h-[6px] overflow-hidden rounded-full bg-line-strong">
          <div className="flex h-full">
            <div className="h-full bg-[#6366F1]" style={{ width: `${pct(chiefCredits)}%` }} />
            <div className="h-full bg-[#0EA5E9]" style={{ width: `${pct(agentCredits)}%` }} />
          </div>
        </div>
        <div className="mb-[24px] flex gap-[12px] text-[11.5px] text-muted">
          <span className="flex items-center gap-[4px]"><span className="size-[8px] rounded-full bg-[#6366F1]" />Chief {chiefCredits.toLocaleString()}</span>
          <span className="flex items-center gap-[4px]"><span className="size-[8px] rounded-full bg-[#0EA5E9]" />Agents {agentCredits.toLocaleString()}</span>
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
              <TextInput
                aria-label={`${r.role} monthly budget (credits)`}
                value={roles[r.key].budget}
                placeholder="No cap"
                width={110}
                onChange={(v) => editRole(r.key, { budget: v })}
              />
              <SelectField
                aria-label={`${r.role} model`}
                value={roles[r.key].model}
                options={MODELS}
                onChange={(v) => editRole(r.key, { model: v })}
              />
            </div>
          ))}
        </div>

        {/* Budget & limits */}
        <SubHeading label="Budget & limits" />
        <SettingCardRows>
          <SettingRow label="Monthly budget" desc="AI pauses when it's reached (credits). Connectors and flows keep running.">
            <TextInput
              aria-label="Monthly budget (credits)"
              value={monthlyBudget}
              placeholder="No cap"
              width={120}
              onChange={(v) => { setMonthlyBudget(v); mark() }}
            />
          </SettingRow>
          <RowDivider />
          <SettingRow
            label="Warn me at 80%"
            desc={budgetCredits ? `WhatsApp + inbox when this month passes ${Math.round(budgetCredits * 0.8).toLocaleString()} credits.` : 'WhatsApp + inbox when this month passes 80% of the budget.'}
          >
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
            <SelectField aria-label="Compact when the chat is" value={compactAt} options={COMPACT_AT} width={140} onChange={(v) => { setCompactAt(v); mark() }} />
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
