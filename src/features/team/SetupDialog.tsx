import { useState } from 'react'
import { ArrowLeft, Check, Cpu, Crown, Palette, Plus, UserPlus, Wallet } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { LookPicker } from '../../ui/ds/LookPicker'
import type { Look } from '../../app/appearance'
import { HIRE_OPTIONS } from './teamData'
import { Btn, Drawer, DrawerClose, DrawerTitle, IconTile, InputField, SelectField, TextareaField } from './ui'
import type { SelectOption } from './ui'

const CHANNELS = ['Omilo chat', 'WhatsApp', 'Telegram', 'Email'] as const

const REPORTS_TO: readonly SelectOption[] = [
  { value: 'chief', label: 'Chief of Staff' },
  { value: 'you', label: 'You (Dede)' },
]

const MODEL_OPTIONS: readonly SelectOption[] = [
  { value: 'opus-5.5', label: 'Opus 5.5 · default' },
  { value: 'sonnet-5.5', label: 'Sonnet 5.5' },
  { value: 'haiku-5.5', label: 'Haiku 5.5' },
]

export interface HireSubmit {
  name: string
  area: string
  role: string
  jobDescription: string
  model: string
  reportsTo: string
  channels: string[]
}

/** Hire helper · Set up — pen hkw1l (Drawer x1VQBT). */
export function SetupDialog({
  optionId = 'sales',
  onClose,
  onBack,
  onHire,
  submitting = false,
}: {
  optionId?: string
  onClose: () => void
  onBack: () => void
  onHire?: (input: HireSubmit) => void
  submitting?: boolean
}) {
  const option = HIRE_OPTIONS.find((o) => o.id === optionId) ?? HIRE_OPTIONS[0]
  const [name, setName] = useState(option.name)
  const [jobDescription, setJobDescription] = useState(option.tagline)
  const [reportsTo, setReportsTo] = useState('chief')
  const [model, setModel] = useState('opus-5.5')
  const [on, setOn] = useState<Set<string>>(new Set(['Omilo chat', 'WhatsApp']))
  const [look, setLook] = useState<Look>({ color: '#6366f1', initial: name.charAt(0).toUpperCase() })
  const toggle = (c: string) =>
    setOn((s) => {
      const n = new Set(s)
      if (n.has(c)) n.delete(c)
      else n.add(c)
      return n
    })

  const submit = () => {
    onHire?.({
      name: name.trim(),
      area: option.area,
      role: option.name,
      jobDescription: jobDescription.trim(),
      model,
      reportsTo,
      channels: [...on],
    })
  }

  return (
    <Drawer
      label={`Set up ${name}`}
      onClose={onClose}
      head={
        <>
          <IconTile icon={UserPlus} />
          <DrawerTitle title={`Set up ${name}`} sub="Step 2 of 2 · you can fine-tune everything after hiring" />
          <DrawerClose onClose={onClose} />
        </>
      }
      footer={
        <>
          <Btn icon={ArrowLeft} onClick={onBack}>
            Back
          </Btn>
          <span className="h-px flex-1" />
          <Btn variant="primary" icon={Check} onClick={submit} disabled={submitting || name.trim() === ''}>
            {submitting ? 'Hiring…' : `Hire ${name}`}
          </Btn>
        </>
      }
    >
      <div className="flex w-full items-center gap-[14px] rounded-lg bg-soft p-[14px]">
        <Mascot helper size={64} radius={18} area={option.area} title={name} />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[16px] font-semibold text-ink">{name}</span>
          <span className="text-[12.5px] text-muted">{option.tagline}</span>
        </div>
        <LookPicker
          kind="area"
          title={`${name} icon`}
          value={{ color: look.color ?? '#6366f1', initial: look.initial, image: look.image }}
          onChange={(patch) => setLook((prev) => ({ ...prev, ...patch }))}
          onReset={() => setLook({ color: '#6366f1', initial: name.charAt(0).toUpperCase() })}
        >
          <Btn variant="quiet" icon={Palette}>
            Change look
          </Btn>
        </LookPicker>
      </div>
      <InputField label="Name" value={name} onChange={setName} className="w-full" />
      <TextareaField label="Job description" value={jobDescription} onChange={setJobDescription} />
      <div className="flex w-full gap-[12px]">
        <SelectField
          label="Reports to"
          icon={Crown}
          value={reportsTo}
          options={REPORTS_TO}
          onChange={setReportsTo}
          fs={14}
          className="min-w-0 flex-1"
        />
        <SelectField
          label="Model"
          icon={Cpu}
          value={model}
          options={MODEL_OPTIONS}
          onChange={setModel}
          fs={14}
          className="min-w-0 flex-1"
        />
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
