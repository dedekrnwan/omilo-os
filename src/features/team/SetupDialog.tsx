import { useState } from 'react'
import { ArrowLeft, Check, Cpu, Crown, Palette, Plus, UserPlus, Wallet } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { Btn, Drawer, DrawerClose, DrawerTitle, IconTile, InputField, SelectField, TextareaField } from './ui'

const CHANNELS = ['Omilo chat', 'WhatsApp', 'Telegram', 'Email'] as const

/** Hire helper · Set up — pen hkw1l (Drawer x1VQBT). */
export function SetupDialog({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const [on, setOn] = useState<Set<string>>(new Set(['Omilo chat', 'WhatsApp']))
  const toggle = (c: string) =>
    setOn((s) => {
      const n = new Set(s)
      if (n.has(c)) n.delete(c)
      else n.add(c)
      return n
    })

  return (
    <Drawer
      label="Set up Sales"
      onClose={onClose}
      head={
        <>
          <IconTile icon={UserPlus} />
          <DrawerTitle title="Set up Sales" sub="Step 2 of 2 · you can fine-tune everything after hiring" />
          <DrawerClose onClose={onClose} />
        </>
      }
      footer={
        <>
          <Btn icon={ArrowLeft} onClick={onBack}>
            Back
          </Btn>
          <span className="h-px flex-1" />
          <Btn variant="primary" icon={Check} onClick={onClose}>
            Hire Sales
          </Btn>
        </>
      }
    >
      <div className="flex w-full items-center gap-[14px] rounded-lg bg-soft p-[14px]">
        <Mascot helper size={64} radius={18} area="sales" title="Sales" />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[16px] font-semibold text-ink">Sales</span>
          <span className="text-[12.5px] text-muted">Follows up leads from WhatsApp and forms</span>
        </div>
        <Btn variant="quiet" icon={Palette}>
          Change look
        </Btn>
      </div>
      <InputField label="Name" value="Sales" className="w-full" />
      <TextareaField
        label="Job description"
        value="Follow up every new lead from WhatsApp and the website form within an hour. Book a viewing or a call, and hand hot leads to me."
      />
      <div className="flex w-full gap-[12px]">
        <SelectField label="Reports to" icon={Crown} value="Chief of Staff" fs={14} className="min-w-0 flex-1" />
        <SelectField label="Model" icon={Cpu} value="Opus 5.5 · default" fs={14} className="min-w-0 flex-1" />
      </div>
      <div className="flex w-full flex-col gap-[8px]">
        <span className="text-[13px] font-medium text-ink-2">Where it works</span>
        <div className="flex gap-[8px]">
          {CHANNELS.map((c) => {
            const active = on.has(c)
            return (
              <button
                key={c}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(c)}
                className={`flex items-center gap-[6px] rounded-pill px-[10px] py-[6px] ${
                  active ? 'bg-ink' : 'outline-1 -outline-offset-1 outline-line-strong hover:bg-soft'
                }`}
              >
                {active ? (
                  <Check size={12} aria-hidden className="text-white" />
                ) : (
                  <Plus size={12} aria-hidden className="text-muted" />
                )}
                <span className={`text-[12.5px] ${active ? 'text-white' : 'text-ink-2'}`}>{c}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex w-full items-center gap-[8px] rounded-md bg-info-tint px-[12px] py-[10px] outline-1 -outline-offset-1 outline-info-line">
        <Wallet size={14} aria-hidden className="text-info" />
        <span className="text-[12.5px] text-ink-2">About Rp 150–250 rb / month at your current volume</span>
      </div>
    </Drawer>
  )
}
