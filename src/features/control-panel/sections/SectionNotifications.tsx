import { useState, useCallback } from 'react'
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

type Channel = 'app' | 'whatsapp' | 'email'

const INITIAL_NOTIFICATIONS: {
  label: string
  desc: string
  channels: Record<Channel, boolean>
}[] = [
  { label: 'Needs your decision', desc: 'Approvals, spend, posts waiting in inbox', channels: { app: true, whatsapp: true, email: false } },
  { label: 'Flow failed', desc: 'A run stopped or timed out', channels: { app: true, whatsapp: true, email: true } },
  { label: 'Budget warning', desc: 'AI spend passed 80%', channels: { app: true, whatsapp: true, email: true } },
  { label: 'Agent finished a task', desc: 'Done items in inbox', channels: { app: true, whatsapp: false, email: false } },
  { label: 'Mentions in chat', desc: 'Someone @mentions you', channels: { app: true, whatsapp: false, email: false } },
  { label: 'Weekly brief', desc: "Chief's Friday summary", channels: { app: false, whatsapp: true, email: true } },
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

export function SectionNotifications() {
  const [notifs, setNotifs] = useState<NotifState>(INITIAL_NOTIFICATIONS)
  const [weekends, setWeekends] = useState(false)
  const [dirty, setDirty] = useState(false)

  const markDirty = useCallback(() => setDirty(true), [])

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

  function handleSave() {
    setDirty(false)
  }

  function handleDiscard() {
    setNotifs(INITIAL_NOTIFICATIONS)
    setWeekends(false)
    setDirty(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Notifications" />
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Notifications</h1>
        <p className="mb-[24px] text-[13px] text-muted">Where Omilo reaches you, for each kind of thing.</p>

        {/* Notification table */}
        <div className="mb-[24px] overflow-hidden rounded-lg border border-line-strong bg-surface">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_80px_80px_80px] border-b border-line bg-soft px-[16px] py-[8px] text-[12px] font-medium text-muted">
            <span />
            <span className="text-center">In app</span>
            <span className="text-center">WhatsApp</span>
            <span className="text-center">Email</span>
          </div>
          {notifs.map((n, i) => (
            <div
              key={n.label}
              className={`grid grid-cols-[1fr_80px_80px_80px] items-center px-[16px] py-[10px] ${i < notifs.length - 1 ? 'border-b border-line' : ''}`}
            >
              <div>
                <p className="text-[13px] font-medium text-ink">{n.label}</p>
                <p className="text-[12px] text-muted">{n.desc}</p>
              </div>
              <span className="flex justify-center">
                <Checkbox checked={n.channels.app} onChange={() => toggleChannel(i, 'app')} />
              </span>
              <span className="flex justify-center">
                <Checkbox checked={n.channels.whatsapp} onChange={() => toggleChannel(i, 'whatsapp')} />
              </span>
              <span className="flex justify-center">
                <Checkbox checked={n.channels.email} onChange={() => toggleChannel(i, 'email')} />
              </span>
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

      <SaveBar dirty={dirty} onSave={handleSave} onDiscard={handleDiscard} />
    </div>
  )
}
