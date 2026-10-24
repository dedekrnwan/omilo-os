import {
  Breadcrumb,
  RowDivider,
  Rule,
  SaveBar,
  SectionPane,
  SelectField,
  SettingCard,
  SettingCardRows,
  SettingRow,
  SubHeading,
  TextInput,
  Toggle,
} from '../ControlPanelShared'
import { Button } from '../../../ui/ds/Button'

const DEVICES = [
  { name: 'MacBook Pro · Jakarta', desc: 'This device · active now', canSignOut: false },
  { name: 'iPhone 16 · WhatsApp linked', desc: 'Last active 2h ago', canSignOut: true },
  { name: 'CLI token "omilo-cli"', isCli: true, desc: 'Created Oct 2 · used yesterday', canSignOut: true },
]

export function SectionAccount() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Account" />
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Account</h1>
        <p className="mb-[24px] text-[13px] text-muted">Your profile, sign-in and the devices you're signed in on.</p>

        {/* Avatar card */}
        <SettingCard>
          <div className="flex items-center gap-[14px] px-[16px] py-[14px]">
            <span className="flex size-[44px] shrink-0 items-center justify-center rounded-full bg-[#FED7AA] text-[15px] font-semibold text-[#9A3412]">
              DK
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[15px] font-semibold text-ink">Dede Kurniawan</span>
              <span className="text-[12px] text-muted">dede@saga.co.id · Owner of Sahabat Warga, Kopi Kenangan</span>
            </div>
            <Button variant="secondary" height={28}>Change photo</Button>
          </div>
        </SettingCard>

        <Rule />

        {/* Profile */}
        <SubHeading label="Profile" />
        <SettingCardRows>
          <SettingRow label="Name" desc="How agents address you.">
            <TextInput value="Dede Kurniawan" />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Agents call you" desc="Chief learned this in onboarding.">
            <TextInput value="Mas Dede" />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Your language" desc="Interface language, just for you.">
            <SelectField value="Bahasa Indonesia" />
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Sign-in & security */}
        <SubHeading label="Sign-in & security" />
        <SettingCardRows>
          <SettingRow label="Google" desc="dede@saga.co.id">
            <span className="rounded-pill bg-ok-tint px-[10px] py-[3px] text-[12px] font-medium text-ok">Connected</span>
          </SettingRow>
          <RowDivider />
          <SettingRow label="Two-step verification" desc="Authenticator app · required for owners.">
            <Toggle on />
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Devices & tokens */}
        <SubHeading label="Devices & tokens" />
        <div className="overflow-hidden rounded-lg border border-line-strong bg-surface">
          {DEVICES.map((d, i) => (
            <div
              key={d.name}
              className={`flex items-center gap-[12px] px-[16px] py-[12px] ${i < DEVICES.length - 1 ? 'border-b border-line' : ''}`}
            >
              <span className="flex size-[28px] shrink-0 items-center justify-center rounded-base border border-line-strong bg-soft text-[14px]">
                {d.isCli ? '>' : '💻'}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="text-[13px] font-medium text-ink">{d.name}</span>
                <span className="text-[12px] text-muted">{d.desc}</span>
              </div>
              {d.canSignOut && (
                <Button variant="secondary" height={28}>Sign out</Button>
              )}
            </div>
          ))}
        </div>
      </SectionPane>

      <SaveBar />
    </div>
  )
}
