import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ArrowUpRight, Brain, Check, ChevronDown, Eye, Search } from 'lucide-react'
import { useState } from 'react'
import type { Model } from '../../core/domain/types'
import { MenuHeading, MenuSeparatorLine, menuSurface } from '../ds/Menu'

// ── Catalog (pen `Composer/Model Menu` rLmFQ) ─────────────────────────────────

type Provider = 'anthropic' | 'openai'

export interface ModelOption extends Model {
  provider: Provider
  desc: string
  thinking: boolean
  vision: boolean
}

const PROVIDER = {
  anthropic: { letter: 'A', color: '#D97757', heading: 'ANTHROPIC', meta: 'Your key' },
  openai: { letter: 'O', color: '#10A37F', heading: 'OPENAI', meta: 'Omilo credits' },
} as const

export const MODELS: ModelOption[] = [
  { id: 'opus-5-5',     label: 'Opus 5.5',     provider: 'anthropic', desc: 'Best for hard work · 200k context', thinking: true,  vision: true },
  { id: 'sonnet-5-5',   label: 'Sonnet 5.5',   provider: 'anthropic', desc: 'Balanced · ~3× cheaper · 200k',     thinking: true,  vision: true },
  { id: 'haiku-5-5',    label: 'Haiku 5.5',    provider: 'anthropic', desc: 'Fastest · 200k context',            thinking: false, vision: true },
  { id: 'gpt-5-5',      label: 'GPT-5.5',      provider: 'openai',    desc: 'Strong at code · 400k context',     thinking: true,  vision: true },
  { id: 'gpt-5-5-mini', label: 'GPT-5.5 mini', provider: 'openai',    desc: 'Cheap, quick drafts · 400k',        thinking: true,  vision: false },
]

export const DEFAULT_MODEL: Model = MODELS[0]

function providerOf(model: Model): Provider {
  return MODELS.find((m) => m.id === model.id)?.provider ?? 'anthropic'
}

/** Provider letter tile (16px in the trigger, 18px in the menu). */
function ProviderTile({ provider, size }: { provider: Provider | 'google'; size: 16 | 18 }) {
  const p =
    provider === 'google' ? { letter: 'G', color: '#A8A29E' } : PROVIDER[provider]
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-xs font-bold text-white"
      style={{ width: size, height: size, background: p.color, fontSize: size === 16 ? 9 : 9.5 }}
    >
      {p.letter}
    </span>
  )
}

const rowClass =
  'flex w-full cursor-pointer items-center gap-[10px] rounded-sm px-[10px] py-[7px] text-left outline-none select-none data-[highlighted]:bg-hover'

interface ModelMenuProps {
  selected: Model
  onSelect: (model: Model) => void
  defaultOpen?: boolean
}

/** Open trigger: pen draws a 1.5px ink stroke instead of the resting 1px line. */
const openTrigger = 'data-[state=open]:outline-[1.5px] data-[state=open]:-outline-offset-[1.5px] data-[state=open]:outline-ink'

export function ModelMenu({ selected, onSelect, defaultOpen }: ModelMenuProps) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const groups = (['anthropic', 'openai'] as const).map((provider) => ({
    provider,
    models: MODELS.filter((m) => m.provider === provider && m.label.toLowerCase().includes(q)),
  }))

  return (
    <DropdownMenu.Root defaultOpen={defaultOpen} modal={false} onOpenChange={(open) => !open && setQuery('')}>
      <DropdownMenu.Trigger
        role="combobox"
        aria-label="model"
        data-model-label={selected.label}
        className={`inline-flex shrink-0 items-center gap-[6px] rounded-base outline-1 -outline-offset-1 outline-line py-[4px] pr-[8px] pl-[6px] transition-colors hover:bg-soft ${openTrigger}`}
      >
        <ProviderTile provider={providerOf(selected)} size={16} />
        <span className="text-[12.5px] font-medium whitespace-nowrap text-ink-2">{selected.label}</span>
        <ChevronDown size={12} aria-hidden className="text-muted" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="end" sideOffset={8} className={`z-50 w-[320px] ${menuSurface}`}>
          <div className="flex items-center gap-[8px] shadow-[inset_0_-1px_0_var(--color-line)] px-[10px] py-[8px]">
            <Search size={14} aria-hidden className="text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Search models"
              aria-label="Search models"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
            />
          </div>

          {groups.map(({ provider, models }) =>
            models.length === 0 ? null : (
              <div key={provider}>
                <MenuHeading label={PROVIDER[provider].heading} meta={PROVIDER[provider].meta} />
                {models.map((m) => {
                  const isSelected = m.id === selected.id
                  return (
                    <DropdownMenu.Item
                      key={m.id}
                      data-model-label={m.label}
                      onSelect={() => onSelect({ id: m.id, label: m.label })}
                      className={`${rowClass} ${isSelected ? 'bg-hover' : ''}`}
                    >
                      <ProviderTile provider={m.provider} size={18} />
                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="text-[13px] font-medium text-ink">{m.label}</span>
                        <span className="text-[11.5px] text-muted">{m.desc}</span>
                      </span>
                      <span className="flex items-center gap-[6px] text-faint">
                        {m.thinking && <Brain size={13} aria-label="Thinking" />}
                        {m.vision && <Eye size={13} aria-label="Reads images" />}
                      </span>
                      <Check size={14} aria-hidden className={isSelected ? 'text-ink' : 'text-transparent'} />
                    </DropdownMenu.Item>
                  )
                })}
              </div>
            ),
          )}

          <MenuHeading label="GOOGLE" meta="Not connected" />
          <DropdownMenu.Item className={rowClass}>
            <ProviderTile provider="google" size={18} />
            <span className="flex-1 text-[12.5px] text-muted">Connect Google to use Gemini</span>
            <ArrowUpRight size={13} aria-hidden className="text-muted" />
          </DropdownMenu.Item>

          <MenuSeparatorLine />
          <div className="flex items-center gap-[12px] px-[10px] py-[6px]">
            <span className="flex items-center gap-[4px] text-[11px] whitespace-nowrap text-faint">
              <Brain size={12} aria-hidden /> Thinking
            </span>
            <span className="flex items-center gap-[4px] text-[11px] whitespace-nowrap text-faint">
              <Eye size={12} aria-hidden /> Reads images
            </span>
            <span className="h-px flex-1" />
            <a href="#" className="text-[11.5px] whitespace-nowrap text-link hover:underline">
              Manage in AI accounts
            </a>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ── Thinking menu (pen `Composer/Thinking Menu` NNyO6) ────────────────────────

export const THINKING_LEVELS = [
  { id: 'off', label: 'Off', desc: 'Answers right away' },
  { id: 'low', label: 'Low', desc: 'A quick think first' },
  { id: 'medium', label: 'Medium', desc: 'Default · balanced' },
  { id: 'high', label: 'High', desc: 'Slower, more careful' },
  { id: 'max', label: 'Max', desc: 'Hardest problems · uses more credits' },
] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]['id']

export function ThinkingMenu({
  model,
  level,
  onSelect,
  defaultOpen,
}: {
  model: Model
  level: ThinkingLevel
  onSelect: (level: ThinkingLevel) => void
  defaultOpen?: boolean
}) {
  const current = THINKING_LEVELS.find((l) => l.id === level) ?? THINKING_LEVELS[2]
  return (
    <DropdownMenu.Root defaultOpen={defaultOpen} modal={false}>
      <DropdownMenu.Trigger
        aria-label="Thinking"
        className={`inline-flex shrink-0 items-center gap-[5px] rounded-base outline-1 -outline-offset-1 outline-line py-[4px] pr-[8px] pl-[7px] transition-colors hover:bg-soft ${openTrigger}`}
      >
        <Brain size={13} aria-hidden className="text-ink-2" />
        <span className="text-[12.5px] font-medium text-ink-2">{current.label}</span>
        <ChevronDown size={12} aria-hidden className="text-muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="end" sideOffset={8} className={`z-50 w-[240px] ${menuSurface}`}>
          <MenuHeading label={`THINKING · ${model.label.toUpperCase()}`} />
          {THINKING_LEVELS.map((l) => {
            const isSelected = l.id === level
            return (
              <DropdownMenu.Item
                key={l.id}
                onSelect={() => onSelect(l.id)}
                className={`${rowClass} ${isSelected ? 'bg-hover' : ''}`}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="text-[13px] font-medium text-ink">{l.label}</span>
                  <span className="text-[11.5px] text-muted">{l.desc}</span>
                </span>
                <Check size={14} aria-hidden className={isSelected ? 'text-ink' : 'text-transparent'} />
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
