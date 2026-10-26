import { useState } from 'react'
import { GripVertical, Search } from 'lucide-react'
import { PALETTE } from './data'
import type { PaletteItem } from './data'
import { PALETTE_ICON, StepTile } from './icons'

export const PALETTE_MIME = 'application/x-omilo-step'

/**
 * "Add a step" column (244px): search + grouped steps. Click a step to add it
 * under the selected one, or drag it onto the canvas.
 */
export function Palette({ onAdd }: { onAdd: (item: PaletteItem) => void }) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const groups = PALETTE.map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(query)) })).filter(
    (g) => g.items.length > 0,
  )

  return (
    <aside aria-label="Add a step" className="flex w-[244px] shrink-0 flex-col shadow-[inset_-1px_0_0_var(--color-line-strong)]">
      <div className="flex flex-col gap-[9px] px-[10px] pt-[13px] pb-[11px]">
        <h2 className="m-0 text-[13px] font-semibold text-ink">Add a step</h2>
        <label className="flex h-[30px] items-center gap-[7px] rounded-base bg-surface px-[9px] outline-1 -outline-offset-1 outline-line-strong focus-within:outline-ink">
          <Search size={13} aria-hidden className="shrink-0 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search steps and apps..."
            aria-label="Search steps and apps"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
          />
        </label>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[10px] pb-[12px]">
        {groups.map((g) => (
          <section key={g.group} aria-label={g.group} className="flex flex-col">
            <h3 className="m-0 px-[8px] pt-[6px] pb-[5px] text-[10.5px] font-medium tracking-[0.8px] text-faint">{g.group}</h3>
            {g.items.map((item) => {
              const Icon = PALETTE_ICON[item.icon]
              return (
                <button
                  key={item.id}
                  type="button"
                  draggable
                  aria-label={`Add ${item.label}`}
                  onClick={() => onAdd(item)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(PALETTE_MIME, item.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  className="group flex h-[35px] w-full shrink-0 items-center gap-[9px] rounded-base px-[8px] text-left outline-none hover:bg-soft focus-visible:ring-2 focus-visible:ring-ink active:cursor-grabbing"
                >
                  <StepTile icon={Icon} tone={item.tone} size={24} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{item.label}</span>
                  <GripVertical size={13} aria-hidden className="shrink-0 text-faint group-hover:text-muted" />
                </button>
              )
            })}
          </section>
        ))}
        {groups.length === 0 && <p className="m-0 px-[8px] py-[16px] text-[12.5px] text-muted">No step called “{q}”.</p>}
      </div>
    </aside>
  )
}

export function paletteItem(id: string): PaletteItem | undefined {
  for (const g of PALETTE) {
    const hit = g.items.find((i) => i.id === id)
    if (hit) return hit
  }
  return undefined
}
