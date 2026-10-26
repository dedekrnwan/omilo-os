import { useState } from 'react'
import { Headphones, Lock, Users } from 'lucide-react'
import type { HelperArea } from '../../core/domain/types'
import { Button } from '../../ui/ds/Button'
import { Dialog } from '../../ui/ds/Dialog'
import { Mascot } from '../../ui/ds/Mascot'

// ── pen `Chat · Create channel` (W0f1Ji) → Dialog bPWTh: right-side sheet ────

const SWATCHES = [
  { id: 'support',   value: 'var(--color-helper-support)' },
  { id: 'dev',       value: 'var(--color-helper-dev)' },
  { id: 'marketing', value: 'var(--color-helper-marketing)' },
  { id: 'sales',     value: 'var(--color-helper-sales)' },
  { id: 'ops',       value: 'var(--color-helper-ops)' },
  { id: 'finance',   value: 'var(--color-helper-finance)' },
  { id: 'stone',     value: '#78716C' },
]

interface AgentEntry {
  id: string
  name: string
  role: string
  area: HelperArea
  locked?: boolean
}

const AGENTS: AgentEntry[] = [
  { id: 'chief',   name: 'Chief',   role: 'Chief of Staff · default in every chat', area: 'brand', locked: true },
  { id: 'support', name: 'Support', role: 'Tickets, refunds, CSAT',                 area: 'support' },
  { id: 'ops',     name: 'Ops',     role: 'Process & SOP upkeep',                   area: 'ops' },
]

/** pen Toggle: 32×18 pill · padding 2 · knob 14 white · on = primary, off = #D6D3D1. */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`flex h-[18px] w-[32px] shrink-0 rounded-pill p-[2px] transition-colors ${
        on ? 'justify-end bg-primary' : 'justify-start bg-wire-strong'
      }`}
    >
      <span aria-hidden className="size-[14px] rounded-full bg-white" />
    </button>
  )
}

type ContextOption = 'isolated' | 'isolated-general'

function ContextRadio({
  value,
  selected,
  onSelect,
  label,
  description,
}: {
  value: ContextOption
  selected: ContextOption
  onSelect: (v: ContextOption) => void
  label: string
  description: string
}) {
  const active = selected === value
  return (
    <label
      className={`flex cursor-pointer gap-[10px] rounded-md p-[9px] -outline-offset-1 transition-colors ${
        active ? 'outline-[1.5px] outline-primary' : 'outline-1 outline-line-strong hover:bg-soft'
      }`}
    >
      <input
        type="radio"
        name="channel-context"
        value={value}
        checked={active}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={`size-[16px] shrink-0 rounded-full ${
          active ? 'shadow-[0_0_0_2.5px_var(--color-primary),inset_0_0_0_2.5px_var(--color-primary)]' : 'shadow-[inset_0_0_0_1.5px_#D6D3D1]'
        }`}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[12.5px] font-medium text-ink">{label}</span>
        <span className="text-[12px] text-muted">{description}</span>
      </span>
    </label>
  )
}

function SectionLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex w-full items-center gap-[6px]">
      <span className="text-[12.5px] font-medium text-ink">{label}</span>
      {hint && <span className="text-[12px] text-faint">{hint}</span>}
    </div>
  )
}

export interface CreateChannelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Visual-only form — does not create a real channel yet. */
export function CreateChannelDialog({ open, onOpenChange }: CreateChannelDialogProps) {
  const [name, setName] = useState('Customer Success')
  const [purpose, setPurpose] = useState('')
  const [color, setColor] = useState('support')
  const [agents, setAgents] = useState<Record<string, boolean>>({ support: true, ops: false })
  const [context, setContext] = useState<ContextOption>('isolated')
  const swatch = SWATCHES.find((s) => s.id === color) ?? SWATCHES[0]

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create area"
      subtitle="An area is a focused space for one part of the company. Its chats, goals, flows and docs stay together."
      width={480}
      footer={
        <>
          <span className="flex min-w-0 flex-1 items-center gap-[6px]">
            <Users size={14} aria-hidden className="text-muted" />
            <span className="text-[12.5px] text-muted">Visible to 4 people</span>
          </span>
          <Button variant="secondary" style={{ height: 32 }} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" style={{ height: 32 }} onClick={() => onOpenChange(false)}>
            Create area
          </Button>
        </>
      }
    >
            <div className="flex flex-col gap-[8px]">
              <SectionLabel label="Name & icon" />
              <div className="flex gap-[8px]">
                <span
                  aria-hidden
                  className="flex size-[40px] shrink-0 items-center justify-center rounded-md text-white"
                  style={{ background: swatch.value }}
                >
                  <Headphones size={18} />
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Area name"
                  aria-label="Area name"
                  className="h-[40px] min-w-0 flex-1 rounded-base bg-surface px-[9px] text-[13px] text-ink outline-[1.5px] -outline-offset-1 outline-primary placeholder:text-faint"
                />
              </div>
              <div className="flex gap-[6px]">
                {SWATCHES.map((s) => {
                  const selected = s.id === color
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-label={`Color ${s.id}`}
                      aria-pressed={selected}
                      onClick={() => setColor(s.id)}
                      className="size-[18px] shrink-0 rounded-full"
                      style={{
                        background: s.value,
                        boxShadow: selected ? `inset 0 0 0 2px #fff, 0 0 0 1px ${s.value}` : undefined,
                      }}
                    />
                  )
                })}
              </div>
            </div>

            <div className="flex flex-col gap-[8px]">
              <SectionLabel label="Purpose" hint="Optional — helps Chief focus" />
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                rows={2}
                placeholder="What is this area for? e.g. Customer onboarding, retention and support."
                aria-label="Area purpose"
                className="w-full resize-none rounded-base bg-surface px-[9px] py-[8px] text-[13px] leading-[1.5] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary placeholder:text-faint"
              />
            </div>

            <div className="flex flex-col gap-[8px]">
              <SectionLabel label="Agents in this area" hint="Chief is always here" />
              <div className="flex flex-col overflow-hidden rounded-md outline-1 -outline-offset-1 outline-line-strong">
                {AGENTS.map((agent, i) => (
                  <div
                    key={agent.id}
                    className={`flex items-center gap-[10px] px-[9px] py-[7px] ${
                      i < AGENTS.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
                    }`}
                  >
                    <Mascot size={24} radius={7} area={agent.area} title={agent.name} />
                    <div className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="text-[12.5px] font-medium text-ink">{agent.name}</span>
                      <span className="truncate text-[12px] text-muted">{agent.role}</span>
                    </div>
                    {agent.locked ? (
                      <Lock size={14} aria-label="Always included" className="text-faint" />
                    ) : (
                      <Toggle
                        on={agents[agent.id] ?? false}
                        onChange={(v) => setAgents((prev) => ({ ...prev, [agent.id]: v }))}
                        label={`Toggle ${agent.name}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-[8px]">
              <SectionLabel label="Context" hint="What agents in this area can read" />
              <ContextRadio
                value="isolated"
                selected={context}
                onSelect={setContext}
                label="Isolated"
                description="Only this channel’s chats, goals and docs. Recommended."
              />
              <ContextRadio
                value="isolated-general"
                selected={context}
                onSelect={setContext}
                label="Isolated + General"
                description="Also reads company-wide basics from General."
              />
            </div>
    </Dialog>
  )
}
