/**
 * EmptyState — the one way Omilo says "nothing here yet" (or "couldn't load").
 *
 * Chief (the crowned brand mascot) always fronts it, in the routines-empty
 * language (pen diQBZ): mascot, a short title, one line of muted copy that says
 * what will appear here and how, and at most two actions.
 *
 *   size="lg"  a whole page or route is empty   mascot 56 · title 20 display
 *   size="md"  a section, card, tab or drawer   mascot 40 · title 14.5
 *   size="sm"  side panels, pickers, menus      mascot 28 in a row · title 13
 *
 * `mood="worried"` is for load errors (pair it with a Retry action).
 * Renders `data-testid="empty-state"` so tests can find it.
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Mascot } from './Mascot'
import type { MascotMood } from './Mascot'
import { Button } from './Button'

export interface EmptyAction {
  label: string
  onClick: () => void
  icon?: LucideIcon
  disabled?: boolean
}

export interface EmptyStateProps {
  title: string
  description?: ReactNode
  primary?: EmptyAction
  secondary?: EmptyAction
  size?: 'lg' | 'md' | 'sm'
  /** 'worried' for errors; default is Chief's calm face. */
  mood?: MascotMood
  /** Extra content under the copy (e.g. a hint line). */
  children?: ReactNode
  className?: string
}

const MASCOT = { lg: { size: 56, radius: 16 }, md: { size: 40, radius: 11 }, sm: { size: 28, radius: 8 } }

export function EmptyState({
  title,
  description,
  primary,
  secondary,
  size = 'md',
  mood,
  children,
  className = '',
}: EmptyStateProps) {
  const m = MASCOT[size]
  const mascot = <Mascot helper area="brand" size={m.size} radius={m.radius} mood={mood} title="Chief of Staff" />
  const actions =
    primary || secondary ? (
      <div className="flex flex-wrap items-center justify-center gap-[8px]">
        {secondary && (
          <Button variant="secondary" icon={secondary.icon} onClick={secondary.onClick} disabled={secondary.disabled}>
            {secondary.label}
          </Button>
        )}
        {primary && (
          <Button variant="primary" icon={primary.icon} onClick={primary.onClick} disabled={primary.disabled}>
            {primary.label}
          </Button>
        )}
      </div>
    ) : null

  if (size === 'sm') {
    return (
      <div
        data-testid="empty-state"
        role={mood === 'worried' ? 'alert' : undefined}
        className={`flex w-full items-start gap-[10px] px-[10px] py-[12px] ${className}`}
      >
        <span className="shrink-0">{mascot}</span>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-[2px]">
          <p className="m-0 text-[13px] font-medium text-ink">{title}</p>
          {description && <p className="m-0 text-[12px] leading-[1.45] text-muted">{description}</p>}
          {children}
          {(primary || secondary) && <div className="pt-[6px]">{actions}</div>}
        </div>
      </div>
    )
  }

  const lg = size === 'lg'
  return (
    <div
      data-testid="empty-state"
      role={mood === 'worried' ? 'alert' : undefined}
      className={`flex w-full flex-col items-center justify-center text-center ${
        lg ? 'gap-[14px] px-[24px] py-[48px]' : 'gap-[10px] px-[16px] py-[28px]'
      } ${className}`}
    >
      {mascot}
      <div className="flex flex-col items-center gap-[4px]">
        <p
          className={
            lg
              ? 'm-0 font-display text-[20px] font-semibold tracking-[-0.3px] text-ink'
              : 'm-0 text-[14.5px] font-semibold text-ink'
          }
        >
          {title}
        </p>
        {description && (
          <p className={`m-0 max-w-[440px] text-muted ${lg ? 'text-[14px] leading-[1.5]' : 'text-[13px] leading-[1.45]'}`}>
            {description}
          </p>
        )}
      </div>
      {children}
      {actions && <div className={lg ? 'pt-[4px]' : ''}>{actions}</div>}
    </div>
  )
}
