import { useState } from 'react'
import { ArrowUpRight, Ban, Eye, FilePlus2, HardDrive } from 'lucide-react'
import { DialogCard, PenButton, Radio } from '../ControlPanelShared'

const CAPS = [
  { icon: Eye, label: 'See files in the folders you choose', can: true },
  { icon: FilePlus2, label: 'Create new files in an “Omilo” folder', can: true },
  { icon: Ban, label: 'Delete or share your files', can: false },
] as const

const FOLDER_OPTS = [
  { id: 'pick' as const, title: 'Only folders I pick', sub: 'Recommended · Warga docs, Surat templates' },
  { id: 'all' as const, title: 'My whole Drive', sub: 'Helpers can search everything you can' },
]

/** Connect Google Drive consent — right drawer (control-panel › Connectors). */
export function DialogConnectDrive({ onClose }: { onClose: () => void }) {
  const [scope, setScope] = useState<'pick' | 'all'>('pick')
  return (
    <DialogCard
      width={460}
      icon={HardDrive}
      title="Connect Google Drive"
      sub="For the whole company. Each helper only sees what you allow in Team → Tools."
      onClose={onClose}
      footer={
        <>
          <PenButton onClick={onClose}>Cancel</PenButton>
          <div className="flex-1" />
          <PenButton variant="primary" icon={ArrowUpRight}>
            Continue with Google
          </PenButton>
        </>
      }
    >
      {/* What Omilo can do */}
      <div className="flex flex-col gap-[8px]">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-faint">OMILO WILL BE ABLE TO</span>
        <div className="flex flex-col gap-[10px] rounded-md p-[14px] outline-1 -outline-offset-1 outline-line">
          {CAPS.map(({ icon: Icon, label, can }) => (
            <div key={label} className="flex items-center gap-[10px]">
              <Icon size={16} aria-hidden className={can ? 'text-ok' : 'text-faint'} />
              <span className={`text-[13.5px] ${can ? 'text-ink' : 'text-muted'}`}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Which folders */}
      <div className="flex flex-col gap-[8px]">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-faint">WHICH FOLDERS</span>
        <div className="flex flex-col gap-[8px]">
          {FOLDER_OPTS.map((o) => {
            const on = scope === o.id
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={on}
                onClick={() => setScope(o.id)}
                className={`flex w-full items-start gap-[12px] rounded-md p-[14px] text-left outline-1 -outline-offset-1 transition-colors ${
                  on ? 'bg-soft outline-ink' : 'outline-line hover:bg-hover'
                }`}
              >
                <span className="pt-[1px]">
                  <Radio on={on} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="text-[14px] font-medium text-ink">{o.title}</span>
                  <span className="text-[12.5px] text-muted">{o.sub}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Sign-in row */}
      <div className="flex items-center gap-[10px] rounded-md bg-soft p-[12px]">
        <span className="flex size-[32px] shrink-0 items-center justify-center rounded-full bg-wire-strong text-[12px] font-semibold text-ink-2">
          DK
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[13.5px] font-medium text-ink">Sign in as dede@sahabatwarga.id</span>
          <span className="text-[12.5px] text-muted">Google opens in a popup</span>
        </span>
      </div>
    </DialogCard>
  )
}
