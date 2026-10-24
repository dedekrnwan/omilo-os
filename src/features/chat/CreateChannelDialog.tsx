import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from '../../ui/ds/Button'

// ── Color picker swatches (matches W0f1Ji.png colour row) ────────────────────

const SWATCH_COLORS = [
  { id: 'orange',  value: '#F97316' },
  { id: 'rose',    value: '#F43F5E' },
  { id: 'pink',    value: '#EC4899' },
  { id: 'violet',  value: '#8B5CF6' },
  { id: 'teal',    value: '#14B8A6' },
  { id: 'sky',     value: '#0EA5E9' },
  { id: 'slate',   value: '#64748B' },
  { id: 'stone',   value: '#78716C' },
]

// ── Static agent stubs (matches W0f1Ji.png) ───────────────────────────────────

interface AgentEntry {
  id: string
  name: string
  role: string
  locked?: boolean
  defaultOn?: boolean
}

const AGENTS: AgentEntry[] = [
  { id: 'chief',   name: 'Chief',   role: 'Chief of Staff · default in every chat', locked: true },
  { id: 'support', name: 'Support', role: 'Tickets, refunds, CSAT',                 defaultOn: true },
  { id: 'ops',     name: 'Ops',     role: 'Process & SOP upkeep',                   defaultOn: false },
]

// ── Toggle switch component ───────────────────────────────────────────────────

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-[18px] w-[30px] shrink-0 rounded-pill transition-colors ${
        on ? 'bg-primary' : 'bg-line-strong'
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-surface shadow-[0_1px_3px_#0C0A0929] transition-transform ${
          on ? 'left-[14px]' : 'left-[2px]'
        }`}
      />
    </button>
  )
}

// ── Context radio group ───────────────────────────────────────────────────────

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
      className={`flex cursor-pointer items-start gap-[10px] rounded-base p-[10px] outline-1 -outline-offset-1 transition-colors ${
        active ? 'outline-primary bg-soft' : 'outline-line-strong hover:bg-soft'
      }`}
    >
      <input
        type="radio"
        name="channel-context"
        value={value}
        checked={active}
        onChange={() => onSelect(value)}
        className="mt-[2px] shrink-0 accent-primary"
      />
      <div className="flex flex-col gap-[1px]">
        <span className="text-[12.5px] font-medium text-ink">{label}</span>
        <span className="text-[11.5px] text-muted">{description}</span>
      </div>
    </label>
  )
}

// ── CreateChannelDialog ───────────────────────────────────────────────────────

export interface CreateChannelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * pen `Create channel` dialog (W0f1Ji.png).
 * Visual-only form — does not create a real channel.
 */
export function CreateChannelDialog({ open, onOpenChange }: CreateChannelDialogProps) {
  const [name, setName] = useState('Customer Success')
  const [selectedColor, setSelectedColor] = useState('orange')
  const [agentStates, setAgentStates] = useState<Record<string, boolean>>({
    support: true,
    ops: false,
  })
  const [context, setContext] = useState<ContextOption>('isolated')

  function toggleAgent(id: string, on: boolean) {
    setAgentStates((prev) => ({ ...prev, [id]: on }))
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Overlay */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#0C0A0940] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        {/* Panel */}
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[480px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-dialog bg-surface shadow-[0_24px_64px_#0C0A0929] outline-1 -outline-offset-1 outline-line-strong data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          {/* Header */}
          <div className="flex items-start gap-[8px] px-[22px] pt-[22px] pb-[14px]">
            <div className="flex flex-1 flex-col gap-[4px]">
              <Dialog.Title className="m-0 text-[15px] font-semibold text-ink">
                Create channel
              </Dialog.Title>
              <p className="m-0 text-[12.5px] text-muted leading-[1.4]">
                A channel is a focused space for one area. Its chats, goals, flows
                and docs stay together.
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close dialog"
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-sm text-faint hover:bg-hover hover:text-muted transition-colors"
              >
                <X size={15} aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {/* Scrollable body */}
          <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto px-[22px] pb-[22px]">
            {/* Name & icon */}
            <fieldset className="flex flex-col gap-[8px] border-0 p-0">
              <legend className="text-[12px] font-medium text-ink-2">Name &amp; icon</legend>
              <div className="flex items-center gap-[8px]">
                {/* Icon swatch preview */}
                <span
                  aria-hidden
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-base"
                  style={{ background: SWATCH_COLORS.find((s) => s.id === selectedColor)?.value ?? '#F97316' }}
                >
                  <span className="text-[16px]">☆</span>
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Channel name"
                  aria-label="Channel name"
                  className="min-w-0 flex-1 rounded-base bg-soft px-[10px] py-[7px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary placeholder:text-faint"
                />
              </div>
              {/* Colour swatches */}
              <div className="flex items-center gap-[6px] px-[2px]">
                {SWATCH_COLORS.map((swatch) => (
                  <button
                    key={swatch.id}
                    type="button"
                    aria-label={`Color ${swatch.id}`}
                    aria-pressed={selectedColor === swatch.id}
                    onClick={() => setSelectedColor(swatch.id)}
                    className="h-[20px] w-[20px] shrink-0 rounded-full transition-transform hover:scale-110"
                    style={{
                      background: swatch.value,
                      outline: selectedColor === swatch.id ? `2px solid ${swatch.value}` : 'none',
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
            </fieldset>

            {/* Agents */}
            <fieldset className="flex flex-col gap-[6px] border-0 p-0">
              <div className="flex items-baseline gap-[4px]">
                <legend className="text-[12px] font-medium text-ink-2">Agents in this channel</legend>
                <span className="text-[11.5px] text-faint">Chief is always here</span>
              </div>
              <div className="flex flex-col gap-px rounded-base outline-1 -outline-offset-1 outline-line-strong overflow-hidden">
                {AGENTS.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center gap-[10px] bg-surface px-[12px] py-[9px]"
                  >
                    {/* Avatar */}
                    <span className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-line-strong text-[11px] font-medium text-ink-2">
                      {agent.name.charAt(0)}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                      <span className="text-[12.5px] font-medium text-ink">{agent.name}</span>
                      <span className="text-[11.5px] text-muted truncate">{agent.role}</span>
                    </div>
                    {agent.locked ? (
                      <span className="text-[11px] text-faint">Always</span>
                    ) : (
                      <Toggle
                        on={agentStates[agent.id] ?? false}
                        onChange={(v) => toggleAgent(agent.id, v)}
                        label={`Toggle ${agent.name}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            </fieldset>

            {/* Context */}
            <fieldset className="flex flex-col gap-[8px] border-0 p-0">
              <div className="flex items-baseline gap-[4px]">
                <legend className="text-[12px] font-medium text-ink-2">Context</legend>
                <span className="text-[11.5px] text-faint">What agents in this channel can read</span>
              </div>
              <ContextRadio
                value="isolated"
                selected={context}
                onSelect={setContext}
                label="Isolated"
                description="Only this channel's chats, goals and docs. Recommended."
              />
              <ContextRadio
                value="isolated-general"
                selected={context}
                onSelect={setContext}
                label="Isolated + General"
                description="Also reads company-wide basics from General."
              />
            </fieldset>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-[8px] border-t border-line px-[22px] py-[14px]">
            <span className="text-[12px] text-muted flex-1">Visible to 4 people</span>
            <Button variant="secondary" height={30} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" height={30} onClick={() => onOpenChange(false)}>
              Create channel
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
