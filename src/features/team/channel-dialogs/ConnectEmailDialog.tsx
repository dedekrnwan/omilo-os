import { useState } from 'react'
import { ChevronUp, CircleHelp, Copy, Link2, Mail } from 'lucide-react'
import type { HelperRecord } from '../teamData'
import { Btn, Drawer, DrawerClose, DrawerTitle, Eyebrow, InputField } from '../ui'
import { ChannelLogo } from '../tabs/ChannelsTab'

/** Channels · Email — pen WruOn (Channel Drawer v414hh, 520 wide). */
export function ConnectEmailDialog({ helper, onClose }: { helper: HelperRecord; onClose: () => void }) {
  const n = helper.name
  const [howItWorksOpen, setHowItWorksOpen] = useState(false)
  return (
    <Drawer
      width={520}
      label="Connect email"
      onClose={onClose}
      bodyClass="gap-[18px] p-[20px]"
      head={
        <>
          <ChannelLogo icon={Mail} />
          <DrawerTitle title="Connect email" sub={`${n} answers emails sent to your support address`} />
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
            Connect email
          </Btn>
        </>
      }
    >
      {howItWorksOpen && (
        <div className="flex w-full flex-col gap-[6px] rounded-md bg-info-tint p-[14px] outline-1 -outline-offset-1 outline-info-line text-[12.5px] text-ink-2">
          <p className="m-0 font-medium text-ink">How email connect works</p>
          <p className="m-0">1. Sign in with your provider or forward mail to the Omilo inbox address.</p>
          <p className="m-0">2. {n} reads incoming emails and writes a reply draft.</p>
          <p className="m-0">3. Replies go out from your domain once you verify it.</p>
        </div>
      )}
      <div className="flex w-full flex-col gap-[8px]">
        <Eyebrow>HOW TO CONNECT</Eyebrow>
        <div className="flex w-full gap-[8px]">
          <Btn icon={Mail} h={40} className="min-w-0 flex-1" onClick={() => { /* OAuth stub */ }}>
            Sign in with Google Workspace
          </Btn>
          <Btn icon={Mail} h={40} className="min-w-0 flex-1" onClick={() => { /* OAuth stub */ }}>
            Sign in with Microsoft 365
          </Btn>
        </div>
        <div className="flex w-full items-center gap-[10px] py-[4px]">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[12px] text-faint">or forward your mail</span>
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="flex w-full flex-col gap-[8px] rounded-md bg-soft p-[14px] outline-1 -outline-offset-1 outline-line">
          <span className="text-[12.5px] text-ink-2">Forward support@sahabatwarga.id to this address:</span>
          <div className="flex w-full items-center gap-[8px] rounded-base bg-surface px-[10px] py-[8px] outline-1 -outline-offset-1 outline-line-strong">
            <span className="min-w-0 flex-1 font-mono text-[13px] text-ink">support-sw7k@in.omilo.app</span>
            <Btn
              variant="quiet"
              icon={Copy}
              h={26}
              px={8}
              fs={12}
              onClick={() => void navigator.clipboard?.writeText('support-sw7k@in.omilo.app')}
            >
              Copy
            </Btn>
          </div>
          <span className="text-[12px] text-muted">
            Replies go out from support@sahabatwarga.id once you verify the domain.
          </span>
        </div>
      </div>
      <div className="flex w-full flex-col gap-[12px]">
        <Eyebrow>HOW EMAILS LOOK</Eyebrow>
        <InputField label="From name" value={`Sahabat Warga ${n}`} className="w-full" />
        <InputField
          label="Signature"
          value={`— ${n}, Sahabat Warga · replies within 1 hour`}
          help={`${n} adds this under every reply.`}
          className="w-full"
        />
      </div>
    </Drawer>
  )
}
