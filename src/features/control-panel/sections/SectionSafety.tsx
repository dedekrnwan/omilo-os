import { useEffect, useState } from 'react'
import { ShieldCheck, Zap } from 'lucide-react'
import {
  Breadcrumb,
  RowDivider,
  Rule,
  SaveBar,
  SectionPane,
  SettingCardRows,
  SettingRow,
  SubHeading,
  Toggle,
  TextInput,
} from '../legacyShared'
import { useSectionSave } from '../ControlPanelShared'
import { useCompanySettings, useUpdateCompanySettings } from '../../../app/queries'
import { useSession } from '../../../app/session'
import { useCommands } from '../../../app/CommandsProvider'
import { notify } from '../../../ui/ds/Toaster'
import { formatIdr, parseIdr } from '../format'

type AutonomyMode = 'strict' | 'ask' | 'yolo'

function AutonomyOption({
  id,
  title,
  subtitle,
  checks,
  selected,
  isDefault,
  onClick,
}: {
  id: AutonomyMode
  title: string
  subtitle: string
  checks: { label: string; wait?: boolean }[]
  selected: boolean
  isDefault?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 flex-col gap-[8px] rounded-lg border p-[14px] text-left transition-colors ${
        selected ? 'border-ink bg-surface shadow-[0_2px_8px_#0C0A091A]' : 'border-line-strong bg-soft hover:border-ink-2'
      }`}
    >
      <div className="flex items-center gap-[6px]">
        <span
          className={`flex size-[16px] shrink-0 items-center justify-center rounded-full border-2 ${
            selected ? 'border-ink bg-ink' : 'border-line-strong bg-surface'
          }`}
        >
          {selected && <span className="size-[6px] rounded-full bg-white" />}
        </span>
        <span className="text-[13px] font-semibold text-ink">{title}</span>
        {isDefault && (
          <span className="ml-auto rounded-pill bg-soft border border-line-strong px-[6px] py-[1px] text-[10px] text-muted">Default</span>
        )}
        {id === 'yolo' && <Zap size={12} className="ml-auto text-warn" aria-hidden />}
      </div>
      <p className="text-[12px] text-muted">{subtitle}</p>
      <ul className="flex flex-col gap-[4px]">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center gap-[6px] text-[12px]">
            <span className={`size-[8px] shrink-0 rounded-sm ${c.wait ? 'bg-warn-tint border border-warn-line' : 'bg-ok-tint border border-ok-line'}`} />
            <span className={c.wait ? 'text-muted' : 'text-ink-2'}>{c.label}</span>
          </li>
        ))}
      </ul>
    </button>
  )
}

const INITIAL = {
  autonomy: 'ask' as AutonomyMode,
  postPublicly: true,
  messageCustomers: true,
  deployProd: true,
  noDelete: true,
  autoApproveUnder: 'Rp 200.000',
  dailyCap: 'Rp 2.000.000',
}

export function SectionSafety() {
  const { data: settings } = useCompanySettings()
  const updateSettings = useUpdateCompanySettings()
  const commands = useCommands()
  // Autonomy is the real `company.autonomy_default` column the enforcement engine
  // reads — it lives on the company profile, not in free-form safety settings.
  const companyAutonomy = useSession((s) => s.company?.autonomyDefault)

  const [autonomy, setAutonomy] = useState<AutonomyMode>(INITIAL.autonomy)
  const [postPublicly, setPostPublicly] = useState(INITIAL.postPublicly)
  const [messageCustomers, setMessageCustomers] = useState(INITIAL.messageCustomers)
  const [deployProd, setDeployProd] = useState(INITIAL.deployProd)
  const [noDelete, setNoDelete] = useState(INITIAL.noDelete)
  const [autoApproveUnder, setAutoApproveUnder] = useState(INITIAL.autoApproveUnder)
  const [dailyCap, setDailyCap] = useState(INITIAL.dailyCap)

  async function persist() {
    // Autonomy → company.autonomy_default (PATCH /v1/company); the real column.
    await commands.updateCompanyProfile({ autonomyDefault: autonomy })
    // Patch the session so the Rail's autonomy popover (same source) updates at once.
    const company = useSession.getState().company
    if (company) useSession.setState({ company: { ...company, autonomyDefault: autonomy } })
    // The remaining toggles stay in free-form safety settings.
    await updateSettings.mutateAsync({
      safety: {
        postPublicly,
        messageCustomers,
        deployProd,
        noDelete,
        // Enforced by the gate (omilo/engine/company_safety.py); null clears.
        autoApproveUnderIdr: parseIdr(autoApproveUnder),
        dailySpendCapIdr: parseIdr(dailyCap),
      },
    })
    notify('Safety settings saved')
  }

  function reset() {
    setAutonomy(INITIAL.autonomy)
    setPostPublicly(INITIAL.postPublicly)
    setMessageCustomers(INITIAL.messageCustomers)
    setDeployProd(INITIAL.deployProd)
    setNoDelete(INITIAL.noDelete)
    setAutoApproveUnder(INITIAL.autoApproveUnder)
    setDailyCap(INITIAL.dailyCap)
  }

  const { dirty, saving, error, saved, markDirty: mark, save: handleSave, discard: handleDiscard } = useSectionSave(persist, reset)

  // Hydrate the autonomy dial from the company column (unless the user is editing).
  useEffect(() => {
    if (dirty) return
    if (companyAutonomy === 'strict' || companyAutonomy === 'ask' || companyAutonomy === 'yolo') {
      setAutonomy(companyAutonomy)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyAutonomy])

  // Hydrate the remaining toggles from free-form safety settings (unless editing).
  useEffect(() => {
    if (dirty) return
    const s = settings?.safety as Record<string, unknown> | undefined
    if (!s) return
    if (typeof s.postPublicly === 'boolean') setPostPublicly(s.postPublicly)
    if (typeof s.messageCustomers === 'boolean') setMessageCustomers(s.messageCustomers)
    if (typeof s.deployProd === 'boolean') setDeployProd(s.deployProd)
    if (typeof s.noDelete === 'boolean') setNoDelete(s.noDelete)
    if ('autoApproveUnderIdr' in s) setAutoApproveUnder(typeof s.autoApproveUnderIdr === 'number' ? formatIdr(s.autoApproveUnderIdr) : '')
    if ('dailySpendCapIdr' in s) setDailyCap(typeof s.dailySpendCapIdr === 'number' ? formatIdr(s.dailySpendCapIdr) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Safety & limits" />
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Safety & limits</h1>
        <p className="mb-[24px] text-[13px] text-muted">What agents may do on their own, and what always waits for a person.</p>

        {/* Autonomy */}
        <div className="mb-[4px] flex items-center justify-between">
          <SubHeading label="Autonomy" />
          <span className="text-[12px] text-muted flex items-center gap-[4px]">
            <ShieldCheck size={12} aria-hidden className="text-muted" />
            Owners & admins can change this
          </span>
        </div>
        <p className="mb-[12px] text-[12px] text-muted">One switch for every helper in every channel. Also in the rail, under …</p>

        <div className="mb-[24px] flex gap-[10px]">
          <AutonomyOption
            id="strict"
            title="Strict"
            subtitle="Helpers only read and draft. Every change waits for a person."
            checks={[
              { label: 'Edits, flows and messages wait', wait: true },
              { label: 'Good for week one, or audits', wait: false },
            ]}
            selected={autonomy === 'strict'}
            onClick={() => { setAutonomy('strict'); mark() }}
          />
          <AutonomyOption
            id="ask"
            title="Ask"
            subtitle="Helpers work on their own inside your tools. Anything below waits for you."
            checks={[
              { label: 'Drafts, edits and runs go ahead' },
              { label: 'Posting, sending, spending wait', wait: true },
            ]}
            selected={autonomy === 'ask'}
            isDefault
            onClick={() => { setAutonomy('ask'); mark() }}
          />
          <AutonomyOption
            id="yolo"
            title="YOLO"
            subtitle="Helpers act without asking. Only caps and guardrails still stop them."
            checks={[
              { label: 'Posting, sending, deploying go' },
              { label: 'Spend cap and no-delete still hold' },
            ]}
            selected={autonomy === 'yolo'}
            onClick={() => { setAutonomy('yolo'); mark() }}
          />
        </div>

        {/* Always wait */}
        <SubHeading label="Always wait for a person" />
        <p className="mb-[12px] text-[12px] text-muted">Agents draft these, then ask in your inbox.</p>
        <SettingCardRows>
          <SettingRow label="Posting publicly" desc="Social posts, website changes, public replies.">
            <Toggle on={postPublicly} onClick={() => { setPostPublicly((v) => !v); mark() }} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Messaging customers" desc="WhatsApp and email to anyone outside the team.">
            <Toggle on={messageCustomers} onClick={() => { setMessageCustomers((v) => !v); mark() }} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Deploying to production" desc="Merges to main and production deploys.">
            <Toggle on={deployProd} onClick={() => { setDeployProd((v) => !v); mark() }} />
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Money */}
        <SubHeading label="Money" />
        <SettingCardRows>
          <SettingRow label="Auto-approve spending under" desc="Ads, refunds and purchases below this go through.">
            <TextInput
              aria-label="Auto-approve spending under"
              value={autoApproveUnder}
              placeholder="Off"
              onChange={(v) => { setAutoApproveUnder(v); mark() }}
              className="min-w-[140px]"
            />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Daily spend cap" desc="Agents stop spending for the day when it's reached.">
            <TextInput
              aria-label="Daily spend cap"
              value={dailyCap}
              placeholder="No cap"
              onChange={(v) => { setDailyCap(v); mark() }}
              className="min-w-[140px]"
            />
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Guardrails */}
        <SubHeading label="Guardrails" />
        <SettingCardRows>
          <SettingRow label="Agents can't delete data" desc="Archiving is allowed. Deleting needs a person.">
            <Toggle on={noDelete} onClick={() => { setNoDelete((v) => !v); mark() }} />
          </SettingRow>
        </SettingCardRows>
      </SectionPane>

      <SaveBar dirty={dirty} saving={saving} error={error} saved={saved} onSave={handleSave} onDiscard={handleDiscard} />
    </div>
  )
}
