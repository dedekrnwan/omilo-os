import { useState } from 'react'
import { ArrowLeft, Check, Cpu, Crown, Palette, Plus, UserPlus, Wallet } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { LookPicker } from '../../ui/ds/LookPicker'
import type { Look } from '../../app/appearance'
import { useCompanySettings, useHelpers } from '../../app/queries'
import { useSession } from '../../app/session'
import { creditsInRp, formatCredits } from '../analytics/format'
import { HIRE_OPTIONS } from './teamData'
import { MODEL_IDS, companyDefaultModel } from './model'
import { Btn, Drawer, DrawerClose, DrawerTitle, IconTile, InputField, SelectField, TextareaField } from './ui'
import type { SelectOption } from './ui'

const CHANNELS = ['Omilo chat', 'WhatsApp', 'Telegram', 'Email'] as const
/** Setup chip → helper channel kind ('Omilo chat' is built in, nothing to bind). */
const CHANNEL_KIND: Record<string, string | null> = {
  'Omilo chat': null,
  WhatsApp: 'whatsapp',
  Telegram: 'telegram',
  Email: 'email',
}

export interface HireSubmit {
  name: string
  area: string
  role: string
  jobDescription: string
  /** Model label, or '' for the company default. */
  model: string
  /** 'owner' | helper id */
  reportsTo: string
  /** Channel kinds to bind (telegram | whatsapp | email). */
  channels: string[]
  look: { color?: string; picture?: string | null }
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
  const { data: team = [] } = useHelpers()
  const { data: settings } = useCompanySettings()
  const ownerName = useSession((st) => st.user?.name) ?? 'you'
  const chief = team.find((h) => h.isChief)
  const defaultModel = companyDefaultModel(settings)
  const reportsOptions: SelectOption[] = [
    ...(chief ? [{ value: chief.id, label: chief.title || chief.role || chief.name }] : []),
    { value: 'owner', label: `You (${ownerName})` },
  ]
  const modelOptions: SelectOption[] = [
    { value: '', label: `${defaultModel} · default` },
    ...MODEL_IDS.filter((m) => m !== defaultModel).map((m) => ({ value: m, label: m })),
  ]
  // Monthly cost estimate from the helpers you already have (credits).
  const others = team.filter((h) => !h.isChief && (h.costMonth ?? 0) > 0)
  const estimate = others.length
    ? Math.round(others.reduce((n, h) => n + (h.costMonth ?? 0), 0) / others.length)
    : null
  const [name, setName] = useState(option.name)
  const [jobDescription, setJobDescription] = useState(option.tagline)
  const [reportsToState, setReportsTo] = useState<string | null>(null)
  const reportsTo = reportsToState ?? (chief ? chief.id : 'owner')
  const [model, setModel] = useState('')
  const [on, setOn] = useState<Set<string>>(new Set(['Omilo chat']))
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
      channels: [...on].map((c) => CHANNEL_KIND[c]).filter((k): k is string => !!k),
      look: { color: look.color, picture: look.image ?? null },
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
          options={reportsOptions}
          onChange={setReportsTo}
          fs={14}
          className="min-w-0 flex-1"
        />
        <SelectField
          label="Model"
          icon={Cpu}
          value={model}
          options={modelOptions}
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
      {estimate !== null && (
        <div className="flex w-full items-center gap-[8px] rounded-md bg-info-tint px-[12px] py-[10px] outline-1 -outline-offset-1 outline-info-line">
          <Wallet size={14} aria-hidden className="text-info" />
          <span className="text-[12.5px] text-ink-2">
            About {formatCredits(estimate)} ({creditsInRp(estimate)}) a month, like your other helpers
          </span>
        </div>
      )}
    </Drawer>
  )
}
