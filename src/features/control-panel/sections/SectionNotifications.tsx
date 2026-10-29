import { useState, useEffect } from 'react'
import { Bell, BellOff, Check, Send } from 'lucide-react'
import {
  Breadcrumb,
  RowDivider,
  SaveBar,
  SectionPane,
  SettingCardRows,
  SettingRow,
  SubHeading,
  TextInput,
  Toggle,
} from '../legacyShared'
import { useSectionSave } from '../ControlPanelShared'
import { Button } from '../../../ui/ds/Button'
import { notify } from '../../../ui/ds/Toaster'
import { usePush } from '../../../app/push'
import { useUIStore } from '../../../app/store'
import { useCompanySettings, useUpdateCompanySettings } from '../../../app/queries'

type Channel = 'app' | 'whatsapp' | 'email' | 'push'

const CHANNEL_COLS: { key: Channel; label: string }[] = [
  { key: 'app', label: 'In app' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
  { key: 'push', label: 'Push' },
]

const INITIAL_NOTIFICATIONS: {
  label: string
  desc: string
  channels: Record<Channel, boolean>
}[] = [
  { label: 'Needs your decision', desc: 'Approvals, spend, posts waiting in inbox', channels: { app: true, whatsapp: true, email: false, push: true } },
  { label: 'Flow failed', desc: 'A run stopped or timed out', channels: { app: true, whatsapp: true, email: true, push: true } },
  { label: 'Budget warning', desc: 'AI spend passed 80%', channels: { app: true, whatsapp: true, email: true, push: true } },
  { label: 'Agent finished a task', desc: 'Done items in inbox', channels: { app: true, whatsapp: false, email: false, push: false } },
  { label: 'Mentions in chat', desc: 'Someone @mentions you', channels: { app: true, whatsapp: false, email: false, push: true } },
  { label: 'Weekly brief', desc: "Chief's Monday summary", channels: { app: false, whatsapp: true, email: true, push: false } },
]

function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className={`flex size-[16px] shrink-0 items-center justify-center rounded-sm border transition-colors cursor-pointer ${
        checked
          ? 'border-ink bg-ink'
          : 'border-line-strong bg-surface hover:border-ink-2'
      }`}
    >
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" className="text-white" aria-hidden>
          <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

type NotifState = { label: string; desc: string; channels: Record<Channel, boolean> }[]

/**
 * Desktop & browser push: the real permission flow. Requesting permission pops
 * the browser prompt; once granted, the preference toggle + a live "Send test"
 * fire actual notifications. Degrades gracefully when unsupported or blocked.
 */
function PushCard() {
  const { supported, permission, request, send } = usePush()
  const pushEnabled = useUIStore((s) => s.pushEnabled)
  const setPushEnabled = useUIStore((s) => s.setPushEnabled)

  async function enable() {
    const result = await request()
    if (result === 'granted') {
      setPushEnabled(true)
      send('Push is on', { body: "You'll get desktop alerts for the things you picked.", tag: 'omilo-push-welcome' })
      notify('Desktop push enabled')
    } else if (result === 'denied') {
      notify('Push blocked — allow notifications in your browser settings')
    }
  }

  function sendTest() {
    const shown = send('Test from Omilo', {
      body: 'This is how a push will look. 🛎️',
      tag: 'omilo-push-test',
    })
    notify(shown ? 'Test notification sent' : 'Enable push first')
  }

  if (!supported) {
    return (
      <SettingCardRows>
        <SettingRow label="Desktop & browser push" desc="This browser can't show notifications. On the desktop app, push works out of the box.">
          <span className="inline-flex items-center gap-[5px] rounded-pill bg-soft px-[8px] py-[3px] text-[12px] text-muted">
            <BellOff size={13} aria-hidden /> Unavailable
          </span>
        </SettingRow>
      </SettingCardRows>
    )
  }

  if (permission === 'denied') {
    return (
      <SettingCardRows>
        <SettingRow label="Desktop & browser push" desc="Notifications are blocked. Allow them for this site in your browser settings, then reload.">
          <span className="inline-flex items-center gap-[5px] rounded-pill bg-bad-tint px-[8px] py-[3px] text-[12px] text-bad outline-1 -outline-offset-1 outline-bad-line">
            <BellOff size={13} aria-hidden /> Blocked
          </span>
        </SettingRow>
      </SettingCardRows>
    )
  }

  if (permission !== 'granted') {
    return (
      <SettingCardRows>
        <SettingRow label="Desktop & browser push" desc="Get alerts even when Omilo is in a background tab or minimised.">
          <Button height={30} icon={Bell} onClick={enable}>
            Enable push
          </Button>
        </SettingRow>
      </SettingCardRows>
    )
  }

  // Granted — show the on/off preference + a live test.
  return (
    <SettingCardRows>
      <SettingRow
        label="Desktop & browser push"
        desc={pushEnabled ? 'On — you’ll get desktop alerts for the things you picked below.' : 'Allowed, but currently paused.'}
      >
        <div className="flex items-center gap-[10px]">
          <span className="inline-flex items-center gap-[5px] rounded-pill bg-ok-tint px-[8px] py-[3px] text-[12px] text-ok outline-1 -outline-offset-1 outline-ok-line">
            <Check size={13} aria-hidden /> Allowed
          </span>
          <Toggle on={pushEnabled} onClick={() => setPushEnabled(!pushEnabled)} label="Desktop push" />
        </div>
      </SettingRow>
      <RowDivider />
      <SettingRow label="Send a test" desc="Fire one right now to see how it looks.">
        <Button variant="secondary" height={30} icon={Send} onClick={sendTest}>
          Send test
        </Button>
      </SettingRow>
    </SettingCardRows>
  )
}

export function SectionNotifications() {
  const { data: settings } = useCompanySettings()
  const updateSettings = useUpdateCompanySettings()

  const [notifs, setNotifs] = useState<NotifState>(INITIAL_NOTIFICATIONS)
  const [weekends, setWeekends] = useState(false)

  async function persist() {
    await updateSettings.mutateAsync({
      notifications: {
        matrix: notifs.map((n) => ({ label: n.label, channels: n.channels })),
        weekends,
      },
    })
    notify('Notification settings saved')
  }

  function reset() {
    setNotifs(INITIAL_NOTIFICATIONS)
    setWeekends(false)
  }

  const { dirty, saving, error, saved, markDirty, save: handleSave, discard: handleDiscard } = useSectionSave(persist, reset)

  // Hydrate from persisted settings when they arrive (unless the user is editing).
  useEffect(() => {
    if (dirty) return
    const n = settings?.notifications as { matrix?: unknown; weekends?: unknown } | undefined
    if (!n) return
    if (typeof n.weekends === 'boolean') setWeekends(n.weekends)
    if (Array.isArray(n.matrix)) {
      setNotifs((prev) =>
        prev.map((row) => {
          const match = (n.matrix as Array<{ label?: string; channels?: Record<Channel, boolean> }>).find(
            (m) => m.label === row.label,
          )
          return match?.channels ? { ...row, channels: { ...row.channels, ...match.channels } } : row
        }),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  function toggleChannel(rowIdx: number, ch: Channel) {
    setNotifs((prev) => {
      const next = prev.map((n, i) =>
        i === rowIdx
          ? { ...n, channels: { ...n.channels, [ch]: !n.channels[ch] } }
          : n,
      )
      return next
    })
    markDirty()
  }

  function toggleWeekends() {
    setWeekends((v) => !v)
    markDirty()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Notifications" />
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Notifications</h1>
        <p className="mb-[24px] text-[13px] text-muted">Where Omilo reaches you, for each kind of thing.</p>

        {/* Desktop & browser push */}
        <SubHeading label="Desktop & browser push" />
        <div className="mb-[24px]">
          <PushCard />
        </div>

        {/* Notification table */}
        <SubHeading label="What reaches you, and where" />
        <div className="mb-[24px] overflow-hidden rounded-lg border border-line-strong bg-surface">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_72px_72px_72px_72px] border-b border-line bg-soft px-[16px] py-[8px] text-[12px] font-medium text-muted">
            <span />
            {CHANNEL_COLS.map((c) => (
              <span key={c.key} className="text-center">{c.label}</span>
            ))}
          </div>
          {notifs.map((n, i) => (
            <div
              key={n.label}
              className={`grid grid-cols-[1fr_72px_72px_72px_72px] items-center px-[16px] py-[10px] ${i < notifs.length - 1 ? 'border-b border-line' : ''}`}
            >
              <div>
                <p className="text-[13px] font-medium text-ink">{n.label}</p>
                <p className="text-[12px] text-muted">{n.desc}</p>
              </div>
              {CHANNEL_COLS.map((c) => (
                <span key={c.key} className="flex justify-center">
                  <Checkbox checked={n.channels[c.key]} onChange={() => toggleChannel(i, c.key)} />
                </span>
              ))}
            </div>
          ))}
        </div>

        {/* Quiet hours */}
        <SubHeading label="Quiet hours" />
        <SettingCardRows>
          <SettingRow label="Don't notify me" desc="Only P0 incidents get through.">
            <TextInput value="21:00 – 08:00" className="min-w-[140px]" />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Weekends" desc="Hold everything except P0 until Monday 08:00.">
            <Toggle on={weekends} onClick={toggleWeekends} label="Weekends" />
          </SettingRow>
        </SettingCardRows>
      </SectionPane>

      <SaveBar dirty={dirty} saving={saving} error={error} saved={saved} onSave={handleSave} onDiscard={handleDiscard} />
    </div>
  )
}
