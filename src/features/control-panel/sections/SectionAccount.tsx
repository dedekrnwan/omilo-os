import { useEffect, useRef, useState } from 'react'
import { Monitor, Smartphone, Terminal } from 'lucide-react'
import { optOut as telemetryOptOut, optIn as telemetryOptIn } from '../../../telemetry'
import {
  Breadcrumb,
  RowDivider,
  Rule,
  SaveBar,
  SectionPane,
  SettingCard,
  SettingCardRows,
  SettingRow,
  SubHeading,
  TextInput,
  Toggle,
} from '../legacyShared'
import { useSectionSave } from '../ControlPanelShared'
import { Button } from '../../../ui/ds/Button'
import { notify } from '../../../ui/ds/Toaster'
import { useAuth } from '../../../app/useAuth'
import { useSession } from '../../../app/session'
import {
  useAccount,
  usePreferences,
  useRevokeSession,
  useSetTelemetryOptOut,
  useSetTwoFactor,
  useSignInSessions,
  useTelemetryOptedOut,
  useUpdateMe,
  useUpdatePreferences,
  useUploadAvatar,
} from '../../../app/queries'
import type { SignInSession } from '../../../core/domain/controlPanel'
import { errorMessage, fileToDataUrl, initialsOf, lastSeenLabel } from '../format'

const PROFILE_INITIAL = { name: '', nickname: '', language: 'Bahasa Indonesia' }
const PROFILE_LANGUAGES = ['Bahasa Indonesia', 'English', 'Bahasa Melayu', 'Tiếng Việt', 'ไทย', '中文']

const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, cli: Terminal } as const

function sessionDesc(s: SignInSession): string {
  if (s.current) return 'This device · active now'
  const seen = lastSeenLabel(s.lastSeenAt)
  const via = s.method === 'google' ? ' · Google' : ''
  return seen ? `${seen.replace(/^active /, 'Last active ')}${via}` : `Signed in${via}`
}

export function SectionAccount() {
  const { signOut } = useAuth()
  const sessionUser = useSession((s) => s.user)
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const { data: account } = useAccount()
  const { data: prefs } = usePreferences()
  const { data: sessions = [], isLoading: sessionsLoading } = useSignInSessions()
  const { data: optedOut } = useTelemetryOptedOut()
  const updateMe = useUpdateMe()
  const updatePrefs = useUpdatePreferences()
  const setTwoFactor = useSetTwoFactor()
  const revokeSession = useRevokeSession()
  const uploadAvatar = useUploadAvatar()
  const setOptOut = useSetTelemetryOptOut()
  const photoInputRef = useRef<HTMLInputElement>(null)

  const userName = account?.name ?? sessionUser?.name ?? ''
  const email = account?.email ?? sessionUser?.email ?? ''
  const roleLabel = (account?.role ?? 'member').replace(/^\w/, (c: string) => c.toUpperCase())

  // Editable profile fields with a real save lifecycle.
  const [profile, setProfile] = useState(PROFILE_INITIAL)

  async function persistProfile() {
    // Name is the real user name (PATCH /v1/me) — the Rail/avatar read it from
    // the session, which this mutation refreshes on success.
    if (profile.name.trim() && profile.name !== userName) {
      await updateMe.mutateAsync({ name: profile.name })
    }
    // Nickname + interface language are personal (PATCH /v1/me/preferences).
    await updatePrefs.mutateAsync({ nickname: profile.nickname, language: profile.language })
    notify('Profile saved')
  }

  const {
    dirty: profileDirty,
    saving: profileSaving,
    error: profileError,
    saved: profileSaved,
    markDirty: markProfileDirty,
    save: saveProfile,
    discard: discardProfile,
  } = useSectionSave(persistProfile, () => setProfile(PROFILE_INITIAL))

  const editProfile = (key: keyof typeof PROFILE_INITIAL) => (v: string) => {
    setProfile((prev) => ({ ...prev, [key]: v }))
    markProfileDirty()
  }

  // Hydrate from the user + personal preferences when they arrive (unless editing).
  useEffect(() => {
    if (profileDirty) return
    setProfile((prev) => ({
      name: userName || prev.name,
      nickname: typeof prefs?.nickname === 'string' ? prefs.nickname : prev.nickname,
      language: typeof prefs?.language === 'string' ? prefs.language : prev.language,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, userName])

  async function handleAnalyticsToggle() {
    const next = !optedOut
    if (next) telemetryOptOut()
    else telemetryOptIn()
    try {
      await setOptOut.mutateAsync(next)
    } catch (e) {
      notify(errorMessage(e, 'Could not save your analytics choice'))
    }
  }

  async function handleTwoFactor() {
    const next = !account?.twoFactorEnabled
    try {
      await setTwoFactor.mutateAsync(next)
      notify(next ? 'Two-step verification on — we’ll email a code when you sign in' : 'Two-step verification off')
    } catch (e) {
      notify(errorMessage(e, 'Could not change two-step verification'))
    }
  }

  async function handleSignOutDevice(s: SignInSession) {
    try {
      await revokeSession.mutateAsync(s.id)
      notify(s.kind === 'cli' ? `Revoked ${s.label}` : `Signed out of ${s.label}`)
    } catch (e) {
      notify(errorMessage(e, 'Could not sign that device out'))
    }
  }

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      await uploadAvatar.mutateAsync(await fileToDataUrl(file))
      notify('Photo updated')
    } catch (err) {
      notify(errorMessage(err, 'Could not update your photo'))
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
            <span className="flex size-[44px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#FED7AA] text-[15px] font-semibold text-[#9A3412]">
              {account?.avatarUrl ? <img src={account.avatarUrl} alt="" className="size-full object-cover" /> : initialsOf(userName || email || '?')}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[15px] font-semibold text-ink">{userName}</span>
              <span className="text-[12px] text-muted">{email} · {roleLabel} of {account?.companyName ?? companyName}</span>
            </div>
            <input ref={photoInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" aria-label="Upload photo" onChange={(e) => void handlePhotoSelected(e)} />
            <Button variant="secondary" height={28} disabled={uploadAvatar.isPending} onClick={() => photoInputRef.current?.click()}>
              {uploadAvatar.isPending ? 'Uploading…' : 'Change photo'}
            </Button>
          </div>
        </SettingCard>

        <Rule />

        {/* Profile */}
        <SubHeading label="Profile" />
        <SettingCardRows>
          <SettingRow label="Name" desc="How agents address you.">
            <TextInput aria-label="Name" value={profile.name} onChange={editProfile('name')} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Agents call you" desc="Chief learned this in onboarding.">
            <TextInput aria-label="Agents call you" value={profile.nickname} placeholder={userName.split(' ')[0] ?? ''} onChange={editProfile('nickname')} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Your language" desc="Interface language, just for you.">
            <select
              aria-label="Your language"
              value={profile.language}
              onChange={(e) => editProfile('language')(e.target.value)}
              className="h-[34px] min-w-[200px] rounded-base border border-line-strong bg-soft px-[12px] text-[13px] text-ink outline-none focus:border-ink"
            >
              {PROFILE_LANGUAGES.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Sign-in & security */}
        <SubHeading label="Sign-in & security" />
        <SettingCardRows>
          <SettingRow label="Google" desc={email}>
            {account?.googleLinked ? (
              <span className="rounded-pill bg-ok-tint px-[10px] py-[3px] text-[12px] font-medium text-ok">Connected</span>
            ) : (
              <span className="rounded-pill bg-soft px-[10px] py-[3px] text-[12px] font-medium text-muted">Not used yet</span>
            )}
          </SettingRow>
          <RowDivider />
          <SettingRow label="Two-step verification" desc="A code is emailed to you at every password sign-in.">
            <Toggle
              on={!!account?.twoFactorEnabled}
              label="Two-step verification"
              onClick={() => void handleTwoFactor()}
            />
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
          {sessionsLoading && <p className="px-[16px] py-[12px] text-[13px] text-muted">Loading devices…</p>}
          {!sessionsLoading && sessions.length === 0 && (
            <p className="px-[16px] py-[12px] text-[13px] text-muted">No other devices are signed in.</p>
          )}
          {sessions.map((d, i) => {
            const Icon = DEVICE_ICON[d.kind as keyof typeof DEVICE_ICON] ?? Monitor
            return (
              <div
                key={d.id}
                className={`flex items-center gap-[12px] px-[16px] py-[12px] ${i < sessions.length - 1 ? 'border-b border-line' : ''}`}
              >
                <span className="flex size-[28px] shrink-0 items-center justify-center rounded-base outline-1 -outline-offset-1 outline-line-strong bg-soft text-muted">
                  <Icon size={15} aria-hidden />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span className="text-[13px] font-medium text-ink">{d.label}</span>
                  <span className="text-[12px] text-muted">{sessionDesc(d)}</span>
                </div>
                {!d.current && (
                  <Button variant="secondary" height={28} disabled={revokeSession.isPending} onClick={() => void handleSignOutDevice(d)}>
                    {d.kind === 'cli' ? 'Revoke' : 'Sign out'}
                  </Button>
                )}
              </div>
            )
          })}
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
              on={!optedOut}
              onClick={() => void handleAnalyticsToggle()}
              label="Share usage analytics"
            />
          </SettingRow>
        </SettingCardRows>
      </SectionPane>

      <SaveBar
        dirty={profileDirty}
        saving={profileSaving}
        error={profileError}
        saved={profileSaved}
        onSave={saveProfile}
        onDiscard={discardProfile}
      />
    </div>
  )
}
