import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { Model } from '../../core/domain/types'

// Static model list — backend-inert
export const MODELS: Model[] = [
  { id: 'claude-opus-5-5',  label: 'Opus 5.5' },
  { id: 'claude-sonnet',    label: 'Claude Sonnet' },
  { id: 'claude-haiku',     label: 'Claude Haiku' },
  { id: 'claude-opus',      label: 'Claude Opus' },
  { id: 'gpt-4o',           label: 'GPT-4o' },
  { id: 'gpt-4o-mini',      label: 'GPT-4o mini' },
]

export const DEFAULT_MODEL = MODELS[0]

/** Small colored square icon used in the model trigger (visual only). */
function ModelIcon() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: 2,
        background: 'var(--helper-brand)',
        flexShrink: 0,
      }}
    />
  )
}

interface ModelMenuProps {
  selected: Model
  onSelect: (model: Model) => void
}

export function ModelMenu({ selected, onSelect }: ModelMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        role="combobox"
        aria-label="model"
        data-model-label={selected.label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          padding: '3px 8px',
          background: 'transparent',
          border: '1px solid var(--line-strong)',
          borderRadius: 'var(--radius-btn)',
          fontSize: '12px',
          fontFamily: 'var(--font-sans)',
          color: 'var(--ink-2)',
          cursor: 'pointer',
          outline: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        <ModelIcon />
        {selected.label}
        <span aria-hidden style={{ fontSize: '10px', color: 'var(--faint)' }}>▾</span>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          align="start"
          style={{
            minWidth: '160px',
            background: 'var(--surface)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius-base)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            padding: '4px',
            zIndex: 50,
          }}
        >
          {MODELS.map(model => (
            <DropdownMenu.Item
              key={model.id}
              onSelect={() => onSelect(model)}
              style={{
                display: 'block',
                padding: '6px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '13px',
                fontFamily: 'var(--font-sans)',
                color: model.id === selected.id ? 'var(--ink)' : 'var(--ink-2)',
                fontWeight: model.id === selected.id ? 500 : 400,
                background: model.id === selected.id ? 'var(--hover)' : 'transparent',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {model.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
