import { useRef, useState } from 'react'
import { Monitor, Smartphone, Terminal } from 'lucide-react'
import { optOut as telemetryOptOut, optIn as telemetryOptIn } from '../../../telemetry'
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
} from '../legacyShared'
import { Button } from '../../../ui/ds/Button'
import { notify } from '../../../ui/ds/Toaster'
import { useAuth } from '../../../app/useAuth'

const DEVICES_INIT = [
  { name: 'MacBook Pro · Jakarta', desc: 'This device · active now', icon: Monitor, canSignOut: false, isCli: false },
  { name: 'iPhone 16 · WhatsApp linked', desc: 'Last active 2h ago', icon: Smartphone, canSignOut: true, isCli: false },
  { name: 'CLI token "omilo-cli"', desc: 'Created Oct 2 · used yesterday', icon: Terminal, canSignOut: true, isCli: true },
]

export function SectionAccount() {
  const { signOut } = useAuth()
  const [devices, setDevices] = useState(DEVICES_INIT)
  const photoInputRef = useRef<HTMLInputElement>(null)
  // Telemetry opt-out: local state only; backend persistence happens via POST
  // /v1/telemetry-config in a full integration, but the toggle wires the client-side
  // opt-out immediately so capture() becomes a no-op.
  const [analyticsOptedOut, setAnalyticsOptedOut] = useState(false)

  function handleAnalyticsToggle() {
    const next = !analyticsOptedOut
    setAnalyticsOptedOut(next)
    if (next) {
      telemetryOptOut()
    } else {
      telemetryOptIn()
    }
    // Best-effort: persist preference to the backend (fire-and-forget)
    void fetch(
      `${(import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? 'http://localhost:8000'}/v1/telemetry-config`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opted_out: next }),
      },
    ).catch(() => {/* swallow — opt-out is applied locally regardless */})
  }

  function handleSignOut(name: string, isCli: boolean) {
    setDevices((prev) => prev.filter((d) => d.name !== name))
    notify(isCli ? `Revoked ${name}` : `Signed out of ${name}`)
  }

  function handleChangePhoto() {
    photoInputRef.current?.click()
  }

  function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.[0]) {
      notify('Photo updated')
    }
  }

  function handleGlobalSignOut() {
    signOut()
    window.location.assign('/auth/sign-in')
  }

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
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelected} />
            <Button variant="secondary" height={28} onClick={handleChangePhoto}>Change photo</Button>
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
          <RowDivider />
          <SettingRow label="Sign out" desc="Sign out of Omilo on this device.">
            <Button variant="secondary" height={28} onClick={handleGlobalSignOut} aria-label="Sign out of Omilo">
              Sign out
            </Button>
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Devices & tokens */}
        <SubHeading label="Devices & tokens" />
        <div className="overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface">
          {devices.map((d, i) => (
            <div
              key={d.name}
              className={`flex items-center gap-[12px] px-[16px] py-[12px] ${i < devices.length - 1 ? 'border-b border-line' : ''}`}
            >
              <span className="flex size-[28px] shrink-0 items-center justify-center rounded-base outline-1 -outline-offset-1 outline-line-strong bg-soft text-muted">
                <d.icon size={15} aria-hidden />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="text-[13px] font-medium text-ink">{d.name}</span>
                <span className="text-[12px] text-muted">{d.desc}</span>
              </div>
              {d.canSignOut && (
                <Button variant="secondary" height={28} onClick={() => handleSignOut(d.name, d.isCli)}>
                  {d.isCli ? 'Revoke' : 'Sign out'}
                </Button>
              )}
            </div>
          ))}
        </div>

        <Rule />

        {/* Analytics & privacy */}
        <SubHeading label="Analytics & privacy" />
        <SettingCardRows>
          <SettingRow
            label="Share usage analytics"
            desc="Sends content-free counts (e.g. messages sent, features used) to help improve Omilo. No message text, keys, or names are ever collected."
          >
            <Toggle
              on={!analyticsOptedOut}
              onClick={handleAnalyticsToggle}
              label="Share usage analytics"
            />
          </SettingRow>
        </SettingCardRows>
      </SectionPane>

      <SaveBar />
    </div>
  )
}
