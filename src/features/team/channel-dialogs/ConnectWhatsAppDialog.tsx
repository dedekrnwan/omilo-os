import { useState } from 'react'
import { CircleHelp, History, MessageCircle, QrCode, ShieldCheck, UserCheck } from 'lucide-react'
import type { HelperRecord } from '../teamData'
import { Btn, Drawer, DrawerClose, DrawerTitle, Eyebrow, Radio, choiceRing } from '../ui'
import { ChannelLogo, WA_GREEN } from '../tabs/ChannelsTab'

/** pen `Spinner` (g4C5A): 14px ring, 90° ink arc. */
function Spinner() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" className="shrink-0 animate-spin" aria-hidden>
      <circle cx="7" cy="7" r="5.74" fill="none" stroke="var(--color-line-strong)" strokeWidth="2.52" />
      <path d="M11.06 2.94A5.74 5.74 0 0 0 2.94 2.94" fill="none" stroke="var(--color-ink)" strokeWidth="2.52" />
    </svg>
  )
}

/** Channels · WhatsApp — pen pyuhG (Channel Drawer taFU5, 520 wide). */
export function ConnectWhatsAppDialog({ helper, onClose }: { helper: HelperRecord; onClose: () => void }) {
  const n = helper.name
  const [method, setMethod] = useState<'app' | 'cloud'>('app')
  const methods = [
    { id: 'app' as const, t: 'WhatsApp Business app', d: 'Scan a QR code with the phone that runs your business number. Best for small teams.' },
    { id: 'cloud' as const, t: 'WhatsApp Cloud API', d: 'For higher volume. Needs a verified Meta Business account and a dedicated number.' },
  ]
  const after = [
    { icon: History, t: `${n} reads the last 30 days so it knows ongoing chats` },
    { icon: UserCheck, t: 'Your phone keeps working — you can still reply yourself' },
    { icon: ShieldCheck, t: `${n} never messages anyone who hasn't messaged first` },
  ]
  return (
    <Drawer
      width={520}
      label="Connect WhatsApp Business"
      onClose={onClose}
      bodyClass="gap-[18px] p-[20px]"
      head={
        <>
          <ChannelLogo icon={MessageCircle} bg={WA_GREEN} />
          <DrawerTitle title="Connect WhatsApp Business" sub={`Residents message ${n} on your business number`} />
          <DrawerClose onClose={onClose} />
        </>
      }
      footer={
        <>
          <Btn
            variant="quiet"
            icon={method === 'cloud' ? MessageCircle : CircleHelp}
            onClick={() => setMethod((m) => (m === 'app' ? 'cloud' : 'app'))}
          >
            {method === 'cloud' ? 'Use Business app instead' : 'Use Cloud API instead'}
          </Btn>
          <span className="h-px flex-1" />
          <Btn onClick={onClose}>Cancel</Btn>
        </>
      }
    >
      <div className="flex w-full flex-col gap-[8px]">
        <Eyebrow>HOW TO CONNECT</Eyebrow>
        {methods.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={method === m.id}
            onClick={() => setMethod(m.id)}
            className={`flex w-full gap-[10px] rounded-md px-[12px] py-[10px] text-left ${choiceRing(method === m.id)}`}
          >
            <Radio on={method === m.id} />
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[13px] font-medium text-ink">{m.t}</span>
              <span className="text-[12px] text-muted">{m.d}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="flex w-full items-center gap-[18px] rounded-lg bg-soft p-[16px] outline-1 -outline-offset-1 outline-line">
        <div className="flex size-[148px] shrink-0 items-center justify-center rounded-md bg-white outline-1 -outline-offset-1 outline-line-strong">
          <QrCode size={124} aria-label="QR code" className="text-ink" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
          {['Open WhatsApp Business on your phone', 'Tap ⋮ → Linked devices', 'Tap Link a device and point it here'].map(
            (t, i) => (
              <div key={t} className="flex w-full gap-[8px]">
                <span className="font-mono text-[12.5px] text-muted">{i + 1}.</span>
                <span className="min-w-0 flex-1 text-[13px] text-ink-2">{t}</span>
              </div>
            ),
          )}
          <div className="flex items-center gap-[8px] pt-[6px]">
            <Spinner />
            <span className="text-[12px] text-muted">Waiting for scan · new code in 0:45</span>
          </div>
        </div>
      </div>
      <div className="flex w-full flex-col gap-[8px]">
        <Eyebrow>AFTER CONNECTING</Eyebrow>
        <div className="flex w-full flex-col gap-[6px]">
          {after.map((a) => (
            <div key={a.t} className="flex w-full items-center gap-[8px]">
              <a.icon size={14} aria-hidden className="text-ok" />
              <span className="text-[12.5px] text-ink-2">{a.t}</span>
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  )
}
