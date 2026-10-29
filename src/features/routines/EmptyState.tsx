import { useState } from 'react'
import { Repeat, Sparkles } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { TEMPLATES, asArea } from './data'
import { Checkbox, PrimaryButton, SecondaryButton } from './ui'
import { useSession } from '../../app/session'
import { pickHelperForArea, useHelperLookup } from './useHelperLookup'

/** pen `Office · Routines · Empty` (diQBZ) — Chief offers starter routines. */
export function EmptyState({
  onScratch,
  onSetUp,
  busy = false,
}: {
  onScratch: () => void
  onSetUp: (ids: string[]) => void
  busy?: boolean
}) {
  const { helpers } = useHelperLookup()
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const [checked, setChecked] = useState(() => new Set(TEMPLATES.filter((t) => t.checked).map((t) => t.id)))
  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const rows = [TEMPLATES.slice(0, 3), TEMPLATES.slice(3, 6)]
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-[16px] overflow-y-auto px-[24px] py-[18px]">
      <div className="flex w-[760px] max-w-full flex-col items-center gap-[20px]">
        <Mascot size={56} radius={16} area="brand" />
        <div className="flex flex-col items-center gap-[6px]">
          <h2 className="m-0 font-display text-[24px] font-semibold tracking-[-0.4px] text-ink">No routines yet</h2>
          <p className="m-0 w-[520px] max-w-full text-center text-[14px] text-muted">
            Chief can set up the usual ones for a company like {companyName} — you approve each before it runs.
          </p>
        </div>
        <div className="flex w-full flex-col gap-[10px]">
          {rows.map((row, i) => (
            <div key={i} className="flex w-full gap-[10px]">
              {row.map((t) => {
                const on = checked.has(t.id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(t.id)}
                    className={`flex min-w-0 flex-1 flex-col gap-[8px] rounded-lg bg-surface p-[14px] text-left ${
                      on ? 'outline-[1.5px] -outline-offset-[1.5px] outline-[#171717]' : 'outline-1 -outline-offset-1 outline-line-strong'
                    }`}
                  >
                    <span className="flex w-full items-center gap-[8px]">
                      <Mascot size={22} radius={6} area={asArea(pickHelperForArea(helpers, t.area)?.area ?? t.area)} />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{t.name}</span>
                      <Checkbox checked={on} />
                    </span>
                    <span className="flex items-center gap-[5px]">
                      <Repeat size={12} aria-hidden className="text-muted" />
                      <span className="text-[12px] text-muted">
                        {[pickHelperForArea(helpers, t.area)?.name, t.when].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-[8px]">
          <SecondaryButton onClick={onScratch}>Start from scratch</SecondaryButton>
          <PrimaryButton icon={Sparkles} disabled={checked.size === 0 || busy} onClick={() => onSetUp([...checked])}>
            Let Chief set up {checked.size} routines
          </PrimaryButton>
        </div>
        <p className="m-0 text-[12.5px] text-faint">Or tell Chief in any chat: “every Monday at 9, send me…”</p>
      </div>
    </div>
  )
}
