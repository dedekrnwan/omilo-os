import { useState } from 'react'
import { Check, ChevronDown, ChevronUp, Mail, MessageCircle, MessagesSquare, Plus, Send } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { HelperRecord } from '../teamData'
import { SlackIcon } from '../brandIcons'
import { Btn, Chip, Eyebrow, IconBtn, Segmented, Switch } from '../ui'

export const TG_BLUE = '#229ED9'
export const WA_GREEN = '#25D366'

export function ChannelLogo({ icon: Icon, bg, ink = '#FFFFFF' }: { icon: LucideIcon; bg?: string; ink?: string }) {
  return (
    <span
      className={`flex size-[36px] shrink-0 items-center justify-center rounded-md ${bg ? '' : 'bg-soft'}`}
      style={bg ? { background: bg } : undefined}
    >
      <Icon size={18} aria-hidden style={{ color: bg ? ink : 'var(--color-ink)' }} />
    </span>
  )
}

function SettingLine({
  title,
  desc,
  last,
  children,
}: {
  title: string
  desc?: string
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`flex w-full items-center gap-[16px] py-[12px] ${last ? '' : 'shadow-[inset_0_-1px_0_var(--color-line)]'}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[13px] font-medium text-ink">{title}</span>
        {desc && <span className="text-[12px] text-muted">{desc}</span>}
      </div>
      {children}
    </div>
  )
}

function AvailableRow({
  icon,
  bg,
  name,
  desc,
  last,
  children,
}: {
  icon: LucideIcon
  bg?: string
  name: string
  desc: string
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`flex w-full items-center gap-[12px] px-[16px] py-[12px] ${last ? '' : 'shadow-[inset_0_-1px_0_var(--color-line)]'}`}>
      <ChannelLogo icon={icon} bg={bg} />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[13.5px] font-semibold text-ink">{name}</span>
        <span className="text-[12.5px] text-muted">{desc}</span>
      </div>
      {children}
    </div>
  )
}

/** Channels tab — pen wwL68. */
export function ChannelsTab({
  helper,
  onConnect,
}: {
  helper: HelperRecord
  onConnect: (c: 'telegram' | 'whatsapp' | 'email') => void
}) {
  const n = helper.name
  const [open, setOpen] = useState(true)
  const [who, setWho] = useState<'Anyone' | 'Known residents'>('Anyone')
  const [when, setWhen] = useState<'Always' | 'Work hours'>('Always')
  const [handoff, setHandoff] = useState(true)
  return (
    <div className="flex w-full flex-col gap-[20px]">
      <div className="flex w-full flex-col gap-[2px]">
        <h3 className="m-0 text-[14px] font-semibold text-ink">Where people can reach {n}</h3>
        <p className="m-0 text-[12.5px] leading-[1.5] text-muted">
          Omilo chat is always on. Connect another app and {n} answers there too — same memory, same rules, every
          conversation lands back in #support.
        </p>
      </div>

      <section className="flex w-full flex-col gap-[10px]">
        <Eyebrow>CONNECTED · 2</Eyebrow>
        <div className="flex w-full items-center gap-[12px] overflow-hidden rounded-lg px-[16px] py-[14px] outline-1 -outline-offset-1 outline-line-strong">
          <ChannelLogo icon={MessagesSquare} />
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[14px] font-semibold text-ink">Omilo chat</span>
            <span className="text-[12.5px] text-muted">In-app · #support, #general and direct messages</span>
          </div>
          <Chip tone="neutral">Built in · always on</Chip>
        </div>
        <div className="flex w-full flex-col overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-line-strong">
          <div className="flex w-full items-center gap-[12px] px-[16px] py-[14px]">
            <ChannelLogo icon={MessageCircle} bg={WA_GREEN} />
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[14px] font-semibold text-ink">WhatsApp Business</span>
              <span className="text-[12.5px] text-muted">+62 812 •••• 4410 · Sahabat Warga · 214 chats this month</span>
            </div>
            <Chip tone="ok" icon={Check}>
              Connected
            </Chip>
            <IconBtn
              icon={open ? ChevronUp : ChevronDown}
              label={open ? 'Collapse' : 'Expand'}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            />
          </div>
          {open && (
            <div className="flex w-full flex-col shadow-[inset_0_1px_0_var(--color-line)] bg-soft px-[16px]">
              <SettingLine title="Who can start a chat" desc="Unknown numbers get a short intro first.">
                <Segmented
                  items={['Anyone', 'Known residents'] as const}
                  value={who}
                  onChange={setWho}
                  bg="bg-surface"
                  onBg="bg-soft"
                />
              </SettingLine>
              <SettingLine title={`When ${n} replies`}>
                <Segmented items={['Always', 'Work hours'] as const} value={when} onChange={setWhen} bg="bg-surface" onBg="bg-soft" />
              </SettingLine>
              <SettingLine
                title="Hand off to a person"
                desc={`After 2 tries without an answer, ${n} pings you and tells the resident.`}
              >
                <Switch on={handoff} onChange={setHandoff} label="Hand off to a person" />
              </SettingLine>
              <SettingLine title="Disconnect" desc={`Stops replies on WhatsApp. Past chats stay in #support.`} last>
                <Btn variant="danger" h={30}>
                  Disconnect
                </Btn>
              </SettingLine>
            </div>
          )}
        </div>
      </section>

      <section className="flex w-full flex-col gap-[10px]">
        <Eyebrow>ADD A CHANNEL</Eyebrow>
        <div className="flex w-full flex-col rounded-lg outline-1 -outline-offset-1 outline-line-strong">
          <AvailableRow icon={Send} bg={TG_BLUE} name="Telegram" desc="Connect a bot from @BotFather — paste its token, done.">
            <Btn icon={Plus} h={30} onClick={() => onConnect('telegram')}>
              Connect
            </Btn>
          </AvailableRow>
          <AvailableRow icon={Mail} name="Email" desc={`${n} answers from support@sahabatwarga.id`}>
            <Btn icon={Plus} h={30} onClick={() => onConnect('email')}>
              Connect
            </Btn>
          </AvailableRow>
          <AvailableRow icon={SlackIcon} name="Slack" desc="For teams that live in Slack" last>
            <Chip tone="idle">Coming soon</Chip>
          </AvailableRow>
        </div>
      </section>
    </div>
  )
}
