import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, Ban, Eye, FilePlus2, HardDrive } from 'lucide-react'
import { DialogCard, PenButton, Radio } from '../ControlPanelShared'
import { useConnectors, useInstallConnector, useMarketplace } from '../../../app/queries'
import { useSession } from '../../../app/session'
import { notify } from '../../../ui/ds/Toaster'
import { errorMessage, initialsOf } from '../format'

const CAPS = [
  { icon: Eye, label: 'See files in the folders you choose', can: true },
  { icon: FilePlus2, label: 'Create new files in an “Omilo” folder', can: true },
  { icon: Ban, label: 'Delete or share your files', can: false },
] as const

const FOLDER_OPTS = [
  { id: 'pick' as const, title: 'Only folders I pick', sub: 'Recommended · you choose them in Google after connecting' },
  { id: 'all' as const, title: 'My whole Drive', sub: 'Helpers can search everything you can' },
]

/** Connect Google Drive consent — right drawer (control-panel › Connectors). */
const isDrive = (id: string, label: string) => /google[\s_-]?drive|gdrive/i.test(`${id} ${label}`)

export function DialogConnectDrive({ onClose }: { onClose: () => void }) {
  const [scope, setScope] = useState<'pick' | 'all'>('pick')
  const navigate = useNavigate()
  const user = useSession((s) => s.user)
  const { data: pieces = [], isLoading } = useMarketplace({ q: 'drive' })
  const { data: connectors = [] } = useConnectors()
  const install = useInstallConnector()
  const piece = pieces.find((p) => isDrive(p.id, p.label))
  const existing = connectors.find((c) => isDrive(c.pieceId, c.label))

  /** Install the Google Drive connector, then finish auth in Connectors. */
  async function handleContinue() {
    if (!piece && !existing) return
    try {
      if (!existing && piece) await install.mutateAsync(piece.id)
      notify(existing ? 'Google Drive is already installed' : 'Google Drive installed — finish connecting it')
      onClose()
      void navigate({ to: '/control-panel/$section', params: { section: 'connectors' } })
    } catch (e) {
      notify(errorMessage(e, 'Could not install Google Drive'))
    }
  }
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
          <PenButton
            variant="primary"
            icon={ArrowUpRight}
            disabled={(!piece && !existing) || install.isPending}
            onClick={() => void handleContinue()}
          >
            {install.isPending ? 'Installing…' : 'Continue with Google'}
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
          {initialsOf(user?.name ?? user?.email ?? '?')}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[13.5px] font-medium text-ink">Sign in as {user?.email ?? 'your Google account'}</span>
          <span className="text-[12.5px] text-muted">
            {!piece && !existing && !isLoading
              ? 'Google Drive isn’t in your marketplace yet — refresh it in Connectors.'
              : 'You finish connecting in Control panel › Connectors'}
          </span>
        </span>
      </div>
    </DialogCard>
  )
}
