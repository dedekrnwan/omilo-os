import { useState } from 'react'
import { ArrowRight, Pencil, Search, Sparkles, UserPlus } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Mascot } from '../../ui/ds/Mascot'
import { useHelpers } from '../../app/queries'
import { HIRE_CATEGORIES, HIRE_OPTIONS } from './teamData'
import type { HireCategory, HireOption } from './teamData'
import { Btn, Drawer, DrawerClose, DrawerTitle, IconTile, InputField, Segmented, choiceRing } from './ui'

function OptionCard({
  o,
  selected,
  onTeam,
  onPick,
}: {
  o: HireOption
  selected: boolean
  onTeam: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      disabled={onTeam}
      onClick={onPick}
      aria-pressed={selected}
      className={`flex min-w-0 flex-1 flex-col gap-[10px] rounded-lg p-[14px] text-left transition-colors enabled:hover:bg-soft ${choiceRing(
        selected,
      )} ${onTeam ? 'opacity-55' : ''}`}
    >
      <div className="flex w-full items-center gap-[10px]">
        <Mascot helper size={64} radius={18} area={o.area} />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[15px] font-semibold text-ink">{o.name}</span>
          <span className="text-[11.5px] text-muted">{o.category}</span>
        </div>
      </div>
      <p className="m-0 text-[12.5px] leading-[1.45] text-ink-2">
        {onTeam ? 'Hired · already on your team' : o.tagline}
      </p>
    </button>
  )
}

/** Hire helper · Pick — pen jEooC (Drawer ThYEv). */
export function HireDialog({
  onClose,
  onNext,
}: {
  onClose: () => void
  onNext: (optionId: string) => void
}) {
  const navigate = useNavigate()
  const [category, setCategory] = useState<HireCategory>('All')
  // A ready-made role is "on the team" when a (non-Chief) helper already works that area.
  const { data: team = [] } = useHelpers()
  const onTeam = (o: HireOption) => team.some((h) => !h.isChief && h.area === o.area)
  const firstFree = HIRE_OPTIONS.find((o) => !onTeam(o))?.id ?? HIRE_OPTIONS[0].id
  const [pickedState, setPicked] = useState<string | null>(null)
  const picked = pickedState ?? firstFree
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const options = HIRE_OPTIONS.filter(
    (o) =>
      (category === 'All' || o.category === category) &&
      (q === '' || o.name.toLowerCase().includes(q) || o.tagline.toLowerCase().includes(q)),
  )
  const rows: HireOption[][] = []
  for (let i = 0; i < options.length; i += 2) rows.push(options.slice(i, i + 2))
  const pickedName = HIRE_OPTIONS.find((o) => o.id === picked)?.name ?? 'Sales'

  return (
    <Drawer
      label="Hire a helper"
      onClose={onClose}
      head={
        <>
          <IconTile icon={UserPlus} />
          <DrawerTitle
            title="Hire a helper"
            sub="Pick a ready-made helper or describe your own. You can change everything later."
          />
          <DrawerClose onClose={onClose} />
        </>
      }
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <span className="h-px flex-1" />
          <span className="text-[12px] text-muted">{pickedName} selected</span>
          <Btn variant="primary" icon={ArrowRight} onClick={() => onNext(picked)}>
            Next: set up {pickedName}
          </Btn>
        </>
      }
    >
      <InputField
        icon={Search}
        placeholder="Search helpers — e.g. “answers WhatsApp”"
        value={search}
        onChange={setSearch}
        className="w-full"
      />
      <Segmented items={HIRE_CATEGORIES} value={category} onChange={setCategory} />
      {rows.map((row, i) => (
        <div key={i} className="flex w-full gap-[12px]">
          {row.map((o) => (
            <OptionCard key={o.id} o={o} selected={picked === o.id} onTeam={onTeam(o)} onPick={() => setPicked(o.id)} />
          ))}
          {row.length < 2 && <span className="flex-1" aria-hidden />}
        </div>
      ))}
      <div className="flex w-full items-center gap-[12px] rounded-lg bg-soft p-[14px] outline-1 -outline-offset-1 outline-line">
        <Sparkles size={18} aria-hidden className="shrink-0 text-ink-2" />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[13px] font-semibold text-ink">Describe your own</span>
          <span className="text-[12.5px] whitespace-nowrap text-muted">
            Tell Chief the job in a sentence — it drafts the helper for you.
          </span>
        </div>
        <Btn icon={Pencil} onClick={() => { onClose(); void navigate({ to: '/chat' }) }}>Describe</Btn>
      </div>
    </Drawer>
  )
}
