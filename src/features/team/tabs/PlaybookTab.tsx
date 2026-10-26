import { useState } from 'react'
import { ArrowUpRight, BookOpen, Check, Maximize2, Pencil, Sparkles, X } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { notify } from '../../../ui/ds/Toaster'
import { Mascot } from '../../../ui/ds/Mascot'
import type { HelperRecord } from '../teamData'
import { Btn, Drawer, DrawerClose, DrawerTitle, IconBtn, IconTile, Segmented } from '../ui'

function H2({ children }: { children: string }) {
  return <h3 className="m-0 font-display text-[17px] font-semibold text-ink">{children}</h3>
}

function List({ items, ordered }: { items: string[]; ordered?: boolean }) {
  return (
    <div className="flex w-full flex-col gap-[6px]">
      {items.map((t, i) => (
        <div key={t} className="flex w-full gap-[8px]">
          <span className={`text-[13.5px] leading-[1.55] text-muted ${ordered ? 'font-mono' : ''}`}>
            {ordered ? `${i + 1}.` : '•'}
          </span>
          <span className="min-w-0 flex-1 text-[13.5px] leading-[1.55] text-ink-2">{t}</span>
        </div>
      ))}
    </div>
  )
}

const MODES = ['View', 'Edit', 'History · 7'] as const

/** PLAYBOOK.md doc drawer — pen vDIEL (Doc Drawer TfYVJ, 520 wide). */
export function PlaybookDrawer({ helper, onClose }: { helper: HelperRecord; onClose: () => void }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<(typeof MODES)[number]>('View')
  const [learned, setLearned] = useState(true)
  const [editContent, setEditContent] = useState('')

  const handleModeChange = (m: (typeof MODES)[number]) => {
    if (m === 'Edit' && editContent === '') {
      setEditContent('Dues questions\n\n1. Look up their unit in sahabat-db — never guess the amount.\n2. Reply with the balance and the last payment date.\n3. Offer the payment link. If they say they already paid, check Midtrans before answering.\n\nLetter requests (surat pengantar)\n\n• Ask for full name, unit and purpose in one message.\n• Fill the RT letter form and send it to the RT head for signing.\n\nAlways hand to the owner\n\n• Disputes about money or fines\n• Complaints about an RT head\n• Anything legal')
    }
    setMode(m)
  }

  return (
    <Drawer
      width={520}
      label="PLAYBOOK.md"
      onClose={onClose}
      bodyClass=""
      head={
        <>
          <IconTile icon={BookOpen} />
          <DrawerTitle mono title="PLAYBOOK.md" sub={`${helper.name} · step-by-step answers for common cases`} />
          <IconBtn icon={Maximize2} label="Open full screen" onClick={() => void navigate({ to: '/docs' })} />
          <DrawerClose onClose={onClose} />
        </>
      }
      footer={
        <>
          <Btn
            variant="quiet"
            icon={ArrowUpRight}
            onClick={() => {
              onClose()
              void navigate({ to: '/docs' })
            }}
          >
            Open in Docs
          </Btn>
          <span className="h-px flex-1" />
          {mode === 'Edit' ? (
            <>
              <Btn variant="quiet" icon={X} onClick={() => setMode('View')}>Cancel</Btn>
              <Btn variant="primary" icon={Check} onClick={() => setMode('View')}>Save</Btn>
            </>
          ) : (
            <>
              <span className="text-[11.5px] text-faint">Your edits always win over {helper.name}&apos;s</span>
              <Btn variant="primary" icon={Pencil} onClick={() => handleModeChange('Edit')}>
                Edit
              </Btn>
            </>
          )}
        </>
      }
    >
      <div className="flex w-full items-center gap-[10px] px-[20px] py-[10px]">
        <Segmented items={MODES} value={mode} onChange={handleModeChange} />
        <span className="h-px flex-1" />
        <span className="flex items-center gap-[6px]">
          <Mascot helper size={18} radius={7} area={helper.area} />
          <span className="text-[12px] text-muted">Updated by {helper.name} · 2 days ago</span>
        </span>
      </div>
      {mode === 'Edit' && (
        <div className="flex w-full flex-1 flex-col px-[28px] pt-[8px] pb-[24px]">
          <textarea
            autoFocus
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full flex-1 resize-none rounded-md bg-soft px-[14px] py-[12px] font-mono text-[12.5px] leading-[1.6] text-ink-2 outline-1 -outline-offset-1 outline-ink"
            rows={16}
          />
        </div>
      )}
      {mode !== 'Edit' && <div className="flex w-full flex-1 flex-col gap-[12px] px-[28px] pt-[8px] pb-[24px]">
        <H2>Dues questions</H2>
        <p className="m-0 text-[13.5px] leading-[1.6] text-ink-2">When a resident asks how much they owe:</p>
        <List
          ordered
          items={[
            'Look up their unit in sahabat-db — never guess the amount.',
            'Reply with the balance and the last payment date.',
            'Offer the payment link. If they say they already paid, check Midtrans before answering.',
          ]}
        />
        <H2>Letter requests (surat pengantar)</H2>
        <List
          items={[
            'Ask for full name, unit and purpose in one message.',
            'Fill the RT letter form and send it to the RT head for signing.',
          ]}
        />
        {learned && (
          <div className="flex w-full flex-col gap-[8px] rounded-md bg-ok-tint px-[12px] py-[10px] outline-1 -outline-offset-1 outline-ok-line">
            <div className="flex w-full items-center gap-[6px]">
              <Sparkles size={13} aria-hidden className="text-ok" />
              <span className="text-[12px] font-medium text-ok">{helper.name} added this from chat #412</span>
              <span className="h-px flex-1" />
              <Btn variant="quiet" h={24} px={8} fs={12} labelClass="text-ok! font-medium" onClick={() => { setLearned(false); notify('Kept') }}>
                Keep
              </Btn>
              <Btn variant="quiet" h={24} px={8} fs={12} labelClass="font-medium" onClick={() => { setLearned(false); notify('Reverted') }}>
                Undo
              </Btn>
            </div>
            <p className="m-0 text-[13.5px] leading-[1.55] text-ink">
              If the RT head is away, send the letter to the deputy (Pak Budi) instead and tell the resident.
            </p>
          </div>
        )}
        <H2>Always hand to the owner</H2>
        <List items={['Disputes about money or fines', 'Complaints about an RT head', 'Anything legal']} />
      </div>}
    </Drawer>
  )
}
