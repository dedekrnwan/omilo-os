import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** Popover surface used by Profile / Model / Thinking menus: radius 10 · line-strong · shadow 0 10 24 #0C0A0929 · p-4. */
export const menuSurface =
  'rounded-md outline-1 -outline-offset-1 outline-line-strong bg-surface p-[4px] shadow-[0_10px_24px_#0C0A0929]'

/** pen `Menu Item` (UoNGm) / `Menu Item/Danger` (SiRcv): h-30 · radius 6 · gap 9 · padding 0 10 0 8. */
export function MenuItemBody({
  icon: Icon,
  label,
  hint,
  danger,
}: {
  icon: LucideIcon
  label: string
  hint?: string
  danger?: boolean
}) {
  return (
    <>
      <Icon size={15} aria-hidden className={danger ? 'text-bad' : 'text-muted'} />
      <span className={`flex-1 text-[13px] ${danger ? 'text-bad' : 'text-ink'}`}>{label}</span>
      {hint && <span className="font-mono text-[11px] text-faint">{hint}</span>}
    </>
  )
}

export const menuItemClass =
  'flex h-[30px] w-full cursor-pointer items-center gap-[9px] rounded-sm pr-[10px] pl-[8px] text-left outline-none select-none data-[highlighted]:bg-hover hover:bg-hover'

/** pen `Menu Separator` (qE4Y3): padding 4/6 around a 1px line-strong rule. */
export function MenuSeparatorLine() {
  return (
    <div className="px-[6px] py-[4px]">
      <div className="h-px bg-line-strong" />
    </div>
  )
}

/** Uppercase heading row used inside the Model / Thinking menus. */
export function MenuHeading({ label, meta }: { label: string; meta?: ReactNode }) {
  return (
    <div className="flex items-center gap-[6px] px-[10px] pt-[8px] pb-[4px]">
      <span className="text-[11px] font-medium tracking-[0.55px] text-muted">{label}</span>
      <span className="h-px flex-1" />
      {meta && <span className="text-[11px] text-faint">{meta}</span>}
    </div>
  )
}
