import { useState } from 'react'
import {
  Briefcase,
  Code,
  Headphones,
  Lock,
  Megaphone,
  Rocket,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { HelperArea } from '../../core/domain/types'
import { Button } from '../../ui/ds/Button'
import { Dialog } from '../../ui/ds/Dialog'
import { Mascot } from '../../ui/ds/Mascot'
import { createCommands } from '../../adapters/http/commands'

// ── pen `Chat · Create channel` (W0f1Ji) → Dialog bPWTh: right-side sheet ────

const BASE_URL = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? 'http://localhost:8000'
function getToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('omilo_token') : null
}

const SWATCHES = [
  { id: 'support',   value: 'var(--color-helper-support)' },
  { id: 'dev',       value: 'var(--color-helper-dev)' },
  { id: 'marketing', value: 'var(--color-helper-marketing)' },
  { id: 'sales',     value: 'var(--color-helper-sales)' },
  { id: 'ops',       value: 'var(--color-helper-ops)' },
  { id: 'finance',   value: 'var(--color-helper-finance)' },
  { id: 'stone',     value: '#78716C' },
]

/** Icon choices for an area — stored as the icon name string. */
const ICON_OPTIONS = [
  { name: 'rocket',      Icon: Rocket },
  { name: 'megaphone',   Icon: Megaphone },
  { name: 'headphones',  Icon: Headphones },
  { name: 'wallet',      Icon: Wallet },
  { name: 'code',        Icon: Code },
  { name: 'users',       Icon: Users },
  { name: 'sparkles',    Icon: Sparkles },
  { name: 'briefcase',   Icon: Briefcase },
] as const

type IconName = typeof ICON_OPTIONS[number]['name']

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

/** Internal context-scope value matching the backend API. */
type ContextOption = 'isolated' | 'isolated_general'

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
          active
            ? 'shadow-[0_0_0_2.5px_var(--color-primary),inset_0_0_0_2.5px_var(--color-primary)]'
            : 'shadow-[inset_0_0_0_1.5px_#D6D3D1]'
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

export function CreateChannelDialog({ open, onOpenChange }: CreateChannelDialogProps) {
  const [name, setName] = useState('Customer Success')
  const [purpose, setPurpose] = useState('')
  const [color, setColor] = useState('support')
  const [icon, setIcon] = useState<IconName>('headphones')
  const [agents, setAgents] = useState<Record<string, boolean>>({ support: true, ops: false })
  const [context, setContext] = useState<ContextOption>('isolated')
  const [nameError, setNameError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const queryClient = useQueryClient()
  const swatch = SWATCHES.find((s) => s.id === color) ?? SWATCHES[0]
  const SelectedIcon = ICON_OPTIONS.find((o) => o.name === icon)?.Icon ?? Headphones

  async function handleSubmit() {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Name is required')
      return
    }
    setNameError('')
    setSubmitting(true)
    try {
      const commands = createCommands(BASE_URL, getToken)
      await commands.createArea({
        name: trimmed,
        color,
        icon,
        purpose: purpose.trim() || undefined,
        contextScope: context,
      })
      await queryClient.invalidateQueries({ queryKey: ['channels'] })
      onOpenChange(false)
    } catch {
      // Silent — network error; dialog stays open
    } finally {
      setSubmitting(false)
    }
  }

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
          <Button
            variant="primary"
            style={{ height: 32 }}
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
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
            <SelectedIcon size={18} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                if (nameError) setNameError('')
              }}
              placeholder="Area name"
              aria-label="Area name"
              className="h-[40px] min-w-0 w-full rounded-base bg-surface px-[9px] text-[13px] text-ink outline-[1.5px] -outline-offset-1 outline-primary placeholder:text-faint"
            />
            {nameError && (
              <span role="alert" className="text-[12px] font-medium text-danger">
                {nameError}
              </span>
            )}
          </div>
        </div>

        {/* Color swatches */}
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

        {/* Icon picker */}
        <fieldset
          role="group"
          aria-label="Icon"
          className="flex flex-wrap gap-[6px] border-0 p-0 m-0"
        >
          {ICON_OPTIONS.map(({ name: iconName, Icon }) => {
            const selected = icon === iconName
            return (
              <label
                key={iconName}
                className={`flex cursor-pointer items-center justify-center size-[32px] rounded-md transition-colors ${
                  selected
                    ? 'bg-primary text-white'
                    : 'bg-surface text-muted outline-1 -outline-offset-1 outline-line-strong hover:bg-soft'
                }`}
              >
                <input
                  type="radio"
                  role="radio"
                  name="area-icon"
                  value={iconName}
                  checked={selected}
                  onChange={() => setIcon(iconName)}
                  aria-label={iconName}
                  className="sr-only"
                />
                <Icon size={16} aria-hidden />
              </label>
            )
          })}
        </fieldset>
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
          description="Only this channel's chats, goals and docs. Recommended."
        />
        <ContextRadio
          value="isolated_general"
          selected={context}
          onSelect={setContext}
          label="Isolated + General"
          description="Also reads company-wide basics from General."
        />
      </div>
    </Dialog>
  )
}
