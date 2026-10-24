import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Mascot } from '../../ui/ds/Mascot'
import { Button } from '../../ui/ds/Button'
import type { HelperArea } from '../../core/domain/types'
import { HIRE_OPTIONS, HIRE_CATEGORIES } from './teamData'
import type { HireOption, HireCategory } from './teamData'
import { SetupDialog } from './SetupDialog'

// ── HireOptionCard ────────────────────────────────────────────────────────────

function HireOptionCard({
  option,
  selected,
  onSelect,
}: {
  option: HireOption
  selected: boolean
  onSelect: () => void
}) {
  if (option.alreadyOnTeam) {
    return (
      <div className="flex flex-col gap-[6px] rounded-lg p-[12px] outline-1 -outline-offset-1 outline-line-strong bg-soft opacity-60">
        <Mascot size={32} radius={9} area={option.area as HelperArea} title={option.name} />
        <span className="text-[13px] font-medium text-muted">{option.name}</span>
        <span className="text-[11.5px] text-faint">{option.tagline}</span>
        <span className="text-[11px] text-faint">Hired · already on your team</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col gap-[6px] rounded-lg p-[12px] text-left outline-1 -outline-offset-1 transition-all ${
        selected
          ? 'outline-2 outline-primary bg-soft shadow-[0_0_0_2px_var(--color-primary)]'
          : 'outline-line-strong bg-surface hover:bg-soft'
      }`}
    >
      <Mascot size={32} radius={9} area={option.area as HelperArea} title={option.name} />
      <span className="text-[13px] font-medium text-ink">{option.name}</span>
      <span className="text-[11.5px] text-muted">{option.tagline}</span>
    </button>
  )
}

// ── HireDialog ────────────────────────────────────────────────────────────────

interface HireDialogProps {
  onClose: () => void
}

export function HireDialog({ onClose }: HireDialogProps) {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<HireCategory>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const navigate = useNavigate()

  const filtered = HIRE_OPTIONS.filter((opt) => {
    const matchesCategory = activeCategory === 'All' || opt.category === activeCategory
    const matchesQuery =
      query === '' ||
      opt.name.toLowerCase().includes(query.toLowerCase()) ||
      opt.tagline.toLowerCase().includes(query.toLowerCase())
    return matchesCategory && matchesQuery
  })

  const selected = HIRE_OPTIONS.find((o) => o.id === selectedId)

  function handleNext() {
    if (!selectedId) return
    setSetupOpen(true)
  }

  function handleSetupDone(helperId: string) {
    onClose()
    void navigate({ to: '/team/$helperId', params: { helperId } })
  }

  if (setupOpen && selected) {
    return (
      <SetupDialog
        option={selected}
        onBack={() => setSetupOpen(false)}
        onHire={handleSetupDone}
      />
    )
  }

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-40 flex items-start justify-end bg-ink/10"
      onClick={onClose}
    >
      {/* Panel */}
      <div
        className="relative mr-[6px] mt-[6px] mb-[6px] flex h-[calc(100%-12px)] w-[380px] flex-col overflow-hidden rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong shadow-[0_10px_40px_#0C0A091F]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-[20px] pt-[20px] pb-[14px]">
          <div>
            <h2 className="m-0 text-[15px] font-semibold text-ink">Hire a helper</h2>
            <p className="m-0 mt-[2px] text-[12px] text-muted">
              Pick a ready-made helper or describe your own. You can change everything later.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-[24px] items-center justify-center rounded-sm text-muted hover:bg-hover transition-colors"
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        {/* Search */}
        <div className="px-[16px] py-[10px] border-b border-line">
          <div className="relative">
            <Search size={13} aria-hidden className="absolute left-[10px] top-1/2 -translate-y-1/2 text-faint" />
            <input
              type="search"
              placeholder='Search helpers — e.g. "answers WhatsApp"'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-md bg-soft pl-[30px] pr-[10px] py-[7px] text-[12.5px] text-ink placeholder:text-faint outline-none focus:outline-2 focus:-outline-offset-1 focus:outline-primary"
            />
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-[4px] px-[16px] py-[10px]">
          {HIRE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`h-[24px] rounded-pill px-[10px] text-[12px] font-medium transition-colors ${
                activeCategory === cat
                  ? 'bg-primary text-primary-ink'
                  : 'bg-soft text-muted hover:text-ink'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Options grid */}
        <div className="flex-1 overflow-y-auto px-[16px] pb-[16px]">
          <div className="grid grid-cols-2 gap-[8px]">
            {filtered.map((opt) => (
              <HireOptionCard
                key={opt.id}
                option={opt}
                selected={selectedId === opt.id}
                onSelect={() => setSelectedId(selectedId === opt.id ? null : opt.id)}
              />
            ))}
          </div>

          {/* Describe your own */}
          <div className="mt-[12px] flex items-center gap-[10px] rounded-lg p-[12px] outline-1 -outline-offset-1 outline-line-strong bg-soft">
            <span className="text-[20px]">✏️</span>
            <div className="flex-1">
              <p className="m-0 text-[12.5px] font-medium text-ink">Describe your own</p>
              <p className="m-0 text-[11.5px] text-muted">
                Tell Chief the job in a sentence — it drafts the helper for you.
              </p>
            </div>
            <Button variant="secondary" height={28}>
              Describe
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line px-[16px] py-[12px]">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] text-muted hover:text-ink transition-colors"
          >
            Cancel
          </button>
          <Button
            onClick={handleNext}
            disabled={!selectedId}
            className={!selectedId ? 'opacity-40 cursor-not-allowed' : ''}
          >
            {selected ? `Next: set up ${selected.name}` : 'Select a helper'}
          </Button>
        </div>
      </div>
    </div>
  )
}
