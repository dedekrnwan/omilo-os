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
} from '../ControlPanelShared'

type AutonomyMode = 'strict' | 'ask' | 'yolo'

function AutonomyOption({
  id,
  title,
  subtitle,
  checks,
  selected,
  isDefault,
}: {
  id: AutonomyMode
  title: string
  subtitle: string
  checks: { label: string; wait?: boolean }[]
  selected: boolean
  isDefault?: boolean
}) {
  return (
    <div
      className={`flex flex-1 flex-col gap-[8px] rounded-lg border p-[14px] ${
        selected ? 'border-ink bg-surface shadow-[0_2px_8px_#0C0A091A]' : 'border-line-strong bg-soft'
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
    </div>
  )
}

export function SectionSafety() {
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
            selected={false}
          />
          <AutonomyOption
            id="ask"
            title="Ask"
            subtitle="Helpers work on their own inside your tools. Anything below waits for you."
            checks={[
              { label: 'Drafts, edits and runs go ahead' },
              { label: 'Posting, sending, spending wait', wait: true },
            ]}
            selected
            isDefault
          />
          <AutonomyOption
            id="yolo"
            title="YOLO"
            subtitle="Helpers act without asking. Only caps and guardrails still stop them."
            checks={[
              { label: 'Posting, sending, deploying go' },
              { label: 'Spend cap and no-delete still hold' },
            ]}
            selected={false}
          />
        </div>

        {/* Always wait */}
        <SubHeading label="Always wait for a person" />
        <p className="mb-[12px] text-[12px] text-muted">Agents draft these, then ask in your inbox.</p>
        <SettingCardRows>
          <SettingRow label="Posting publicly" desc="Social posts, website changes, public replies.">
            <Toggle on />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Messaging customers" desc="WhatsApp and email to anyone outside the team.">
            <Toggle on />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Deploying to production" desc="Merges to main and production deploys.">
            <Toggle on />
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Money */}
        <SubHeading label="Money" />
        <SettingCardRows>
          <SettingRow label="Auto-approve spending under" desc="Ads, refunds and purchases below this go through.">
            <TextInput value="Rp 200.000" className="min-w-[140px]" />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Daily spend cap" desc="Agents stop spending for the day when it's reached.">
            <TextInput value="Rp 2.000.000" className="min-w-[140px]" />
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Guardrails */}
        <SubHeading label="Guardrails" />
        <SettingCardRows>
          <SettingRow label="Agents can't delete data" desc="Archiving is allowed. Deleting needs a person.">
            <Toggle on />
          </SettingRow>
        </SettingCardRows>
      </SectionPane>

      <SaveBar />
    </div>
  )
}
