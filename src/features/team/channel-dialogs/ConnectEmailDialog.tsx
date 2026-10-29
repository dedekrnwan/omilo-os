import { useState } from 'react'
import { ChevronUp, CircleHelp, Link2, Mail } from 'lucide-react'
import type { HelperRecord } from '../teamData'
import { notify } from '../../../ui/ds/Toaster'
import { useConnectHelperChannel } from '../../../app/queries'
import { useSession } from '../../../app/session'
import { Btn, Drawer, DrawerClose, DrawerTitle, Eyebrow, InputField } from '../ui'
import { ChannelLogo } from '../tabs/ChannelsTab'

/** Channels · Email — pen WruOn (Channel Drawer v414hh, 520 wide). */
export function ConnectEmailDialog({ helper, onClose }: { helper: HelperRecord; onClose: () => void }) {
  const n = helper.name
  const [howItWorksOpen, setHowItWorksOpen] = useState(false)
  const company = useSession((st) => st.company?.name) ?? ''
  const [fromName, setFromName] = useState(company ? `${company} ${n}` : n)
  const [signature, setSignature] = useState(`— ${n}${company ? `, ${company}` : ''}`)
  const connectChannel = useConnectHelperChannel(helper.id)
  // Email provider OAuth / inbound mail isn't live yet — we save the binding and
  // its settings and show an honest "pending setup" state rather than fake a handshake.
  const connect = (method: 'google' | 'microsoft' | 'forward') =>
    connectChannel.mutate(
      { kind: 'email', config: { method, from_name: fromName.trim(), signature: signature.trim() } },
      {
        onSuccess: () => {
          notify('Email saved — pending provider setup')
          onClose()
        },
        onError: () => notify("Couldn't save the email channel"),
      },
    )
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
          <Btn variant="primary" icon={Link2} onClick={() => connect('forward')} disabled={connectChannel.isPending}>
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
          <Btn icon={Mail} h={40} className="min-w-0 flex-1" onClick={() => connect('google')}>
            Sign in with Google Workspace
          </Btn>
          <Btn icon={Mail} h={40} className="min-w-0 flex-1" onClick={() => connect('microsoft')}>
            Sign in with Microsoft 365
          </Btn>
        </div>
        <div className="flex w-full items-center gap-[10px] py-[4px]">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[12px] text-faint">or forward your mail</span>
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="flex w-full flex-col gap-[8px] rounded-md bg-soft p-[14px] outline-1 -outline-offset-1 outline-line">
          <span className="text-[12.5px] text-ink-2">
            Forward your support address to {n}. Omilo shows the forwarding address here once inbound email is
            switched on for your workspace.
          </span>
          <span className="text-[12px] text-muted">Replies go out from your own domain once you verify it.</span>
        </div>
      </div>
      <div className="flex w-full flex-col gap-[12px]">
        <Eyebrow>HOW EMAILS LOOK</Eyebrow>
        <InputField label="From name" value={fromName} onChange={setFromName} className="w-full" />
        <InputField
          label="Signature"
          value={signature}
          onChange={setSignature}
          help={`${n} adds this under every reply.`}
          className="w-full"
        />
      </div>
    </Drawer>
  )
}
