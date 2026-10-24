import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Headphones, Lock, Users, X } from 'lucide-react'
import type { HelperArea } from '../../core/domain/types'
import { Button, IconButton } from '../../ui/ds/Button'
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
  const [color, setColor] = useState('support')
  const [agents, setAgents] = useState<Record<string, boolean>>({ support: true, ops: false })
  const [context, setContext] = useState<ContextOption>('isolated')
  const swatch = SWATCHES.find((s) => s.id === color) ?? SWATCHES[0]

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#0C0A0926]" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed top-[8px] right-[8px] bottom-[8px] z-50 flex w-[480px] flex-col overflow-hidden rounded-lg bg-surface shadow-[-8px_0_48px_#1C19173D] outline-1 -outline-offset-1 outline-line-strong focus:outline-none"
        >
          {/* Header */}
          <div className="flex w-full shrink-0 gap-[12px] shadow-[inset_0_-1px_0_var(--color-line)] pt-[20px] pr-[16px] pb-[16px] pl-[24px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
              <Dialog.Title className="m-0 font-serif text-[22px] font-medium tracking-[-0.22px] text-ink">
                Create channel
              </Dialog.Title>
              <p className="m-0 text-[13px] leading-[1.5] text-muted">
                A channel is a focused space for one area. Its chats, goals, flows and docs stay together.
              </p>
            </div>
            <Dialog.Close asChild>
              <IconButton icon={X} aria-label="Close dialog" />
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto px-[24px] py-[20px]">
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
                  placeholder="Channel name"
                  aria-label="Channel name"
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
              <SectionLabel label="Agents in this channel" hint="Chief is always here" />
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
              <SectionLabel label="Context" hint="What agents in this channel can read" />
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
          </div>

          {/* Footer */}
          <div className="flex w-full shrink-0 items-center gap-[8px] shadow-[inset_0_1px_0_var(--color-line)] bg-soft px-[24px] py-[14px]">
            <span className="flex min-w-0 flex-1 items-center gap-[6px]">
              <Users size={14} aria-hidden className="text-muted" />
              <span className="text-[12.5px] text-muted">Visible to 4 people</span>
            </span>
            <Button variant="secondary" style={{ height: 32 }} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" style={{ height: 32 }} onClick={() => onOpenChange(false)}>
              Create channel
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
