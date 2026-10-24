import { useState } from 'react'
import { ArrowUpRight, BookOpen, Maximize2, Pencil, Sparkles } from 'lucide-react'
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
  const [mode, setMode] = useState<(typeof MODES)[number]>('View')
  const [learned, setLearned] = useState(true)
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
          <IconBtn icon={Maximize2} label="Open full screen" />
          <DrawerClose onClose={onClose} />
        </>
      }
      footer={
        <>
          <Btn variant="quiet" icon={ArrowUpRight}>
            Open in Docs
          </Btn>
          <span className="h-px flex-1" />
          <span className="text-[11.5px] text-faint">Your edits always win over {helper.name}&apos;s</span>
          <Btn variant="primary" icon={Pencil}>
            Edit
          </Btn>
        </>
      }
    >
      <div className="flex w-full items-center gap-[10px] px-[20px] py-[10px]">
        <Segmented items={MODES} value={mode} onChange={setMode} />
        <span className="h-px flex-1" />
        <span className="flex items-center gap-[6px]">
          <Mascot helper size={18} radius={7} area={helper.area} />
          <span className="text-[12px] text-muted">Updated by {helper.name} · 2 days ago</span>
        </span>
      </div>
      <div className="flex w-full flex-1 flex-col gap-[12px] px-[28px] pt-[8px] pb-[24px]">
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
              <Btn variant="quiet" h={24} px={8} fs={12} labelClass="text-ok! font-medium" onClick={() => setLearned(false)}>
                Keep
              </Btn>
              <Btn variant="quiet" h={24} px={8} fs={12} labelClass="font-medium" onClick={() => setLearned(false)}>
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
      </div>
    </Drawer>
  )
}
