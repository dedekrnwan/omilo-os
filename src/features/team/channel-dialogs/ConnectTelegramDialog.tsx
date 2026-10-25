import { useState } from 'react'
import { Check, CircleCheck, CircleHelp, ChevronUp, ExternalLink, Link2, Lock, Send } from 'lucide-react'
import type { HelperRecord } from '../teamData'
import { Btn, Drawer, DrawerClose, DrawerTitle, InputField, Radio, choiceRing } from '../ui'
import { ChannelLogo, TG_BLUE } from '../tabs/ChannelsTab'

function Step({
  num,
  state,
  title,
  children,
}: {
  num: number
  state: 'done' | 'current' | 'todo'
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex w-full gap-[12px]">
      <div className="flex flex-col items-center gap-[4px]">
        {state === 'done' ? (
          <span className="flex size-[24px] items-center justify-center rounded-pill bg-ok">
            <Check size={13} aria-hidden className="text-white" />
          </span>
        ) : state === 'current' ? (
          <span className="flex size-[24px] items-center justify-center rounded-pill bg-ink text-[12px] font-semibold text-white">
            {num}
          </span>
        ) : (
          <span className="flex size-[24px] items-center justify-center rounded-pill text-[12px] font-semibold text-muted outline-1 -outline-offset-1 outline-line-strong">
            {num}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[10px] pt-[2px] pb-[6px]">
        <span className={`text-[13.5px] font-semibold ${state === 'todo' ? 'text-muted' : 'text-ink'}`}>{title}</span>
        {children}
      </div>
    </div>
  )
}

const AUDIENCE = [
  { id: 'anyone', t: 'Anyone who finds the bot', d: 'Good for a public help line' },
  { id: 'invite', t: 'Only people you invite', d: 'Share a private link with residents' },
  { id: 'group', t: 'A Telegram group', d: "{n} replies when it's mentioned" },
]

/** Channels · Telegram — pen GwcDV (Channel Drawer ZmQMm, 520 wide). */
export function ConnectTelegramDialog({ helper, onClose }: { helper: HelperRecord; onClose: () => void }) {
  const n = helper.name
  const [aud, setAud] = useState('anyone')
  const [howItWorksOpen, setHowItWorksOpen] = useState(false)
  return (
    <Drawer
      width={520}
      label="Connect Telegram"
      onClose={onClose}
      bodyClass="gap-[18px] p-[20px]"
      head={
        <>
          <ChannelLogo icon={Send} bg={TG_BLUE} />
          <DrawerTitle title="Connect Telegram" sub={`${n} answers through your own Telegram bot`} />
          <DrawerClose onClose={onClose} />
        </>
      }
      footer={
        <>
          <Btn
            variant="quiet"
            icon={howItWorksOpen ? ChevronUp : CircleHelp}
            onClick={() => setHowItWorksOpen((v) => !v)}
          >
            How it works
          </Btn>
          <span className="h-px flex-1" />
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" icon={Link2} onClick={onClose}>
            Connect Telegram
          </Btn>
        </>
      }
    >
      {howItWorksOpen && (
        <div className="flex w-full flex-col gap-[6px] rounded-md bg-info-tint p-[14px] outline-1 -outline-offset-1 outline-info-line text-[12.5px] text-ink-2">
          <p className="m-0 font-medium text-ink">How Telegram connect works</p>
          <p className="m-0">1. Create a bot via @BotFather and paste the token here.</p>
          <p className="m-0">2. Omilo verifies the token and links the bot to {n}.</p>
          <p className="m-0">3. Residents message the bot; {n} replies through it.</p>
        </div>
      )}
      <Step num={1} state="done" title="Create a bot">
        <p className="m-0 text-[12.5px] leading-[1.5] text-ink-2">
          In Telegram, open @BotFather, send /newbot and give it a name like "Sahabat Warga {n}".
        </p>
        <Btn
          icon={ExternalLink}
          h={30}
          className="self-start"
          onClick={() => window.open('https://t.me/BotFather', '_blank', 'noopener,noreferrer')}
        >
          Open @BotFather
        </Btn>
      </Step>
      <Step num={2} state="current" title="Paste the bot token">
        <InputField
          focus
          mono
          fs={13}
          label="Bot token"
          value="7104829315:AAH-k3Vq••••••••••Xc"
          help="BotFather sends it right after /newbot"
          className="w-full"
        />
        <div className="flex w-full items-center gap-[8px] rounded-base bg-ok-tint px-[10px] py-[8px] outline-1 -outline-offset-1 outline-ok-line">
          <CircleCheck size={14} aria-hidden className="text-ok" />
          <span className="text-[12.5px] font-medium text-ok">Token works · @sahabatwarga_support_bot</span>
        </div>
      </Step>
      <Step num={3} state="todo" title="Choose who can talk to it">
        {AUDIENCE.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={aud === a.id}
            onClick={() => setAud(a.id)}
            className={`flex w-full items-center gap-[10px] rounded-md px-[12px] py-[10px] text-left ${choiceRing(aud === a.id)}`}
          >
            <Radio on={aud === a.id} />
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[13px] font-medium text-ink">{a.t}</span>
              <span className="text-[12px] text-muted">{a.d.replace('{n}', n)}</span>
            </span>
          </button>
        ))}
      </Step>
      <div className="flex w-full items-center gap-[8px]">
        <Lock size={13} aria-hidden className="text-muted" />
        <span className="text-[12px] text-muted">The token is stored encrypted. Only {n} uses this bot.</span>
      </div>
    </Drawer>
  )
}
