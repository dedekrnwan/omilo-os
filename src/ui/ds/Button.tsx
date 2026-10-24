import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type Variant = 'primary' | 'secondary'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /** pen "Button" / "Button/Secondary" are 30px tall; pass 28 for compact rows. */
  height?: 28 | 30
  icon?: LucideIcon
  children?: ReactNode
}

/**
 * pen components `Button` (VEo7Q) and `Button/Secondary` (rOtas):
 * h-30 · radius 7 · gap 5 · px 10 · icon 14 · label 12.5/500.
 */
export function Button({
  variant = 'primary',
  height = 30,
  icon: Icon,
  children,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex shrink-0 items-center justify-center gap-[5px] rounded-btn px-[10px] text-[12.5px] font-medium whitespace-nowrap transition-colors'
  const look =
    variant === 'primary'
      ? 'bg-primary text-primary-ink hover:bg-primary-hover'
      : 'outline-1 -outline-offset-1 outline-line-strong bg-surface text-ink hover:bg-soft'
  return (
    <button type={type} className={`${base} ${look} ${className}`} style={{ height }} {...rest}>
      {Icon && (
        <Icon
          size={14}
          className={variant === 'primary' ? 'text-primary-ink' : 'text-ink-2'}
          aria-hidden
        />
      )}
      {children}
    </button>
  )
}

/**
 * pen `Button/Primary` / `Button/Secondary` used as square icon buttons
 * (28×28, radius 7, icon 16) — e.g. the composer's Add and Send.
 */
export function SquareButton({
  variant = 'secondary',
  icon: Icon,
  className = '',
  type = 'button',
  ...rest
}: Omit<ButtonProps, 'height' | 'children'> & { icon: LucideIcon }) {
  const look =
    variant === 'primary'
      ? 'outline-1 -outline-offset-1 outline-primary bg-primary text-primary-ink hover:bg-primary-hover'
      : 'outline-1 -outline-offset-1 outline-line-strong bg-surface text-ink hover:bg-soft'
  return (
    <button
      type={type}
      className={`inline-flex size-[28px] shrink-0 items-center justify-center rounded-btn transition-colors ${look} ${className}`}
      {...rest}
    >
      <Icon size={16} aria-hidden />
    </button>
  )
}

/** pen `Icon Button` (u1cQLT): 28×28 · radius 6 · icon 16 muted. */
export function IconButton({
  icon: Icon,
  size = 16,
  className = '',
  type = 'button',
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { icon: LucideIcon; size?: number }) {
  return (
    <button
      type={type}
      className={`inline-flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover ${className}`}
      {...rest}
    >
      <Icon size={size} aria-hidden />
    </button>
  )
}
