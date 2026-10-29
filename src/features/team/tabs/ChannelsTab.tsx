import { useState } from 'react'
import { Check, ChevronDown, ChevronUp, Clock, Mail, MessageCircle, MessagesSquare, Plus, Send } from 'lucide-react'
import { notify } from '../../../ui/ds/Toaster'
import type { LucideIcon } from 'lucide-react'
import type { HelperChannelBinding, HelperChannelKind } from '../../../core/domain/types'
import { useDisconnectHelperChannel, useHelperChannels, useUpdateHelperChannel } from '../../../app/queries'
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

const KIND_META: Record<HelperChannelKind, { name: string; icon: LucideIcon; bg?: string; add: string }> = {
  telegram: { name: 'Telegram', icon: Send, bg: TG_BLUE, add: 'Connect a bot from @BotFather — paste its token, done.' },
  whatsapp: { name: 'WhatsApp Business', icon: MessageCircle, bg: WA_GREEN, add: 'Answer on your business number.' },
  email: { name: 'Email', icon: Mail, add: 'Answer emails sent to your support address.' },
}

function bindingDesc(b: HelperChannelBinding): string {
  const c = b.config as Record<string, string | undefined>
  const parts: string[] = []
  if (b.kind === 'telegram') {
    parts.push(b.secretsSet.includes('bot_token') ? 'Bot token saved' : 'No bot token yet')
    if (c.audience) parts.push({ anyone: 'anyone', invite: 'invited people', group: 'a group' }[c.audience] ?? c.audience)
  }
  if (b.kind === 'whatsapp') parts.push(c.method === 'cloud' ? 'Cloud API' : 'Business app')
  if (b.kind === 'email') {
    if (c.from_name) parts.push(`From “${c.from_name}”`)
    if (c.method) parts.push({ google: 'Google Workspace', microsoft: 'Microsoft 365', forward: 'forwarding' }[c.method] ?? c.method)
  }
  return parts.join(' · ')
}

function BindingCard({ helperName, binding }: { helperName: string; binding: HelperChannelBinding }) {
  const n = helperName
  const meta = KIND_META[binding.kind]
  const [open, setOpen] = useState(false)
  const update = useUpdateHelperChannel(binding.helperId)
  const disconnect = useDisconnectHelperChannel(binding.helperId)
  const c = binding.config as { who?: string; when?: string; handoff?: boolean }
  const who = c.who === 'known' ? 'Known contacts' : 'Anyone'
  const when = c.when === 'work_hours' ? 'Work hours' : 'Always'
  const handoff = c.handoff ?? true
  const set = (config: Record<string, unknown>) =>
    update.mutate({ channelId: binding.id, config }, { onError: () => notify(`Couldn't update ${meta.name}`) })
  const connected = binding.status === 'connected'
  return (
    <div className="flex w-full flex-col overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-line-strong">
      <div className="flex w-full items-center gap-[12px] px-[16px] py-[14px]">
        <ChannelLogo icon={meta.icon} bg={meta.bg} />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[14px] font-semibold text-ink">{meta.name}</span>
          <span className="text-[12.5px] text-muted">{bindingDesc(binding) || 'Saved'}</span>
        </div>
        <Chip tone={connected ? 'ok' : 'warn'} icon={connected ? Check : Clock}>
          {connected ? 'Connected' : 'Pending setup'}
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
          {!connected && (
            <SettingLine
              title="Not live yet"
              desc={`Omilo saved this ${meta.name} setup for ${n}. Messages start flowing once delivery for ${meta.name} is switched on.`}
            >
              <span />
            </SettingLine>
          )}
          <SettingLine title="Who can start a chat" desc="Unknown contacts get a short intro first.">
            <Segmented
              items={['Anyone', 'Known contacts'] as const}
              value={who}
              onChange={(v) => set({ who: v === 'Anyone' ? 'anyone' : 'known' })}
              bg="bg-surface"
              onBg="bg-soft"
            />
          </SettingLine>
          <SettingLine title={`When ${n} replies`}>
            <Segmented
              items={['Always', 'Work hours'] as const}
              value={when}
              onChange={(v) => set({ when: v === 'Always' ? 'always' : 'work_hours' })}
              bg="bg-surface"
              onBg="bg-soft"
            />
          </SettingLine>
          <SettingLine title="Hand off to a person" desc={`After 2 tries without an answer, ${n} pings you.`}>
            <Switch on={handoff} onChange={(v) => set({ handoff: v })} label="Hand off to a person" />
          </SettingLine>
          <SettingLine title="Disconnect" desc={`Removes ${meta.name} from ${n}. Past chats stay in Omilo.`} last>
            <Btn
              variant="danger"
              h={30}
              disabled={disconnect.isPending}
              onClick={() =>
                disconnect.mutate(binding.id, {
                  onSuccess: () => notify(`${meta.name} disconnected from ${n}`),
                  onError: () => notify(`Couldn't disconnect ${meta.name}`),
                })
              }
            >
              Disconnect
            </Btn>
          </SettingLine>
        </div>
      )}
    </div>
  )
}

/** Channels tab — pen wwL68. Omilo chat is built in; other channels are per-helper bindings. */
export function ChannelsTab({
  helper,
  onConnect,
}: {
  helper: HelperRecord
  onConnect: (c: 'telegram' | 'whatsapp' | 'email') => void
}) {
  const n = helper.name
  const { data: bindings = [], isLoading } = useHelperChannels(helper.id)
  const bound = new Set(bindings.map((b) => b.kind))
  const available = (['telegram', 'whatsapp', 'email'] as const).filter((k) => !bound.has(k))
  return (
    <div className="flex w-full flex-col gap-[20px]">
      <div className="flex w-full flex-col gap-[2px]">
        <h3 className="m-0 text-[14px] font-semibold text-ink">Where people can reach {n}</h3>
        <p className="m-0 text-[12.5px] leading-[1.5] text-muted">
          Omilo chat is always on. Connect another app and {n} answers there too — same memory, same rules, every
          conversation lands back in Omilo.
        </p>
      </div>

      <section className="flex w-full flex-col gap-[10px]">
        <Eyebrow>{`CONNECTED · ${1 + bindings.length}`}</Eyebrow>
        <div className="flex w-full items-center gap-[12px] overflow-hidden rounded-lg px-[16px] py-[14px] outline-1 -outline-offset-1 outline-line-strong">
          <ChannelLogo icon={MessagesSquare} />
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[14px] font-semibold text-ink">Omilo chat</span>
            <span className="text-[12.5px] text-muted">In-app · channels and direct messages</span>
          </div>
          <Chip tone="neutral">Built in · always on</Chip>
        </div>
        {isLoading && <span className="text-[12.5px] text-muted">Loading channels…</span>}
        {bindings.map((b) => (
          <BindingCard key={b.id} helperName={n} binding={b} />
        ))}
      </section>

      <section className="flex w-full flex-col gap-[10px]">
        <Eyebrow>ADD A CHANNEL</Eyebrow>
        <div className="flex w-full flex-col rounded-lg outline-1 -outline-offset-1 outline-line-strong">
          {available.map((k) => (
            <AvailableRow key={k} icon={KIND_META[k].icon} bg={KIND_META[k].bg} name={KIND_META[k].name} desc={KIND_META[k].add}>
              <Btn icon={Plus} h={30} onClick={() => onConnect(k)}>
                Connect
              </Btn>
            </AvailableRow>
          ))}
          <AvailableRow icon={SlackIcon} name="Slack" desc="For teams that live in Slack" last>
            <Chip tone="idle">Coming soon</Chip>
          </AvailableRow>
        </div>
      </section>
    </div>
  )
}
