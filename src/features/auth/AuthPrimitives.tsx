/**
 * AuthPrimitives — the pen components used by the auth screens:
 * Auth/Google Button (QSXD9), Button/Primary (Upfho), Button/Secondary (sqbAw),
 * Input (PzYhe), Select (gVDns), Checkbox/On (l3E9dD), Logo/Google (w18bV),
 * plus the repeated screen parts (title block, code row, notes, links).
 */

import type { InputHTMLAttributes, ReactNode } from 'react'
import { Check, ChevronDown, Eye } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link, useNavigate } from '@tanstack/react-router'

// ── Logo/Google ───────────────────────────────────────────────────────────────
export function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden className="shrink-0">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  )
}

// ── Buttons ───────────────────────────────────────────────────────────────────
export function GoogleButton({ children, onClick, to }: { children: ReactNode; onClick?: () => void; to?: string }) {
  const navigate = useNavigate()
  const handleClick = to ? () => navigate({ to }) : onClick
  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex h-[44px] w-full items-center justify-center gap-[10px] rounded-[10px] bg-surface px-[16px] text-[14px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
      style={{ boxShadow: '0 1px 2px #0C0A090D' }}
    >
      <GoogleLogo />
      {children}
    </button>
  )
}

interface AuthButtonProps {
  children: ReactNode
  variant?: 'primary' | 'secondary'
  icon?: LucideIcon
  /** Icon after the label (pen: Meet Chief → arrow-right). */
  height?: number
  type?: 'button' | 'submit'
  onClick?: () => void
  /** When set, the button navigates to this path via TanStack Router. */
  to?: string
  className?: string
}

/** pen Button/Primary · Button/Secondary at full width (h-44, radius 7, 14/500). */
export function AuthButton({
  children,
  variant = 'primary',
  icon: Icon,
  height = 44,
  type = 'button',
  onClick,
  to,
  className = '',
}: AuthButtonProps) {
  const navigate = useNavigate()
  const handleClick = to ? () => navigate({ to }) : onClick
  const look =
    variant === 'primary'
      ? 'bg-primary text-primary-ink hover:bg-primary-hover'
      : 'bg-surface text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft'
  return (
    <button
      type={type}
      onClick={handleClick}
      className={`flex w-full items-center justify-center gap-[6px] rounded-btn px-[14px] text-[14px] font-medium transition-colors ${look} ${className}`}
      style={{ height }}
    >
      {Icon && <Icon size={16} aria-hidden className="shrink-0" />}
      {children}
    </button>
  )
}

// ── "or" divider ──────────────────────────────────────────────────────────────
export function OrDivider() {
  return (
    <div className="flex w-full items-center gap-[10px]">
      <span className="h-px flex-1 bg-line-strong" />
      <span className="text-[12px] text-faint">or</span>
      <span className="h-px flex-1 bg-line-strong" />
    </div>
  )
}

// ── Input / Select ────────────────────────────────────────────────────────────
interface AuthFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode
  /** Right side of the label row (e.g. "Forgot password?"). */
  right?: ReactNode
  icon?: LucideIcon
  help?: string
  /** Password: show the eye toggle at the right and letter-space the dots. */
  secret?: boolean
  /** Label colour: pen Input label is ink-2; hand-built password labels are ink. */
  labelTone?: 'ink' | 'ink-2'
  children?: ReactNode
}

export function AuthField({
  label,
  right,
  icon: Icon,
  help,
  secret = false,
  labelTone = 'ink-2',
  id,
  children,
  ...inputProps
}: AuthFieldProps) {
  return (
    <div className="flex w-full flex-col gap-[6px]">
      {(label || right) && (
        <div className="flex w-full items-center">
          {label && (
            <label
              htmlFor={id}
              className={`flex-1 text-[13px] font-medium ${labelTone === 'ink' ? 'text-ink' : 'text-ink-2'}`}
            >
              {label}
            </label>
          )}
          {right}
        </div>
      )}
      <div className="flex h-[36px] w-full items-center gap-[8px] rounded-base bg-surface px-[10px] outline-1 -outline-offset-1 outline-line-strong focus-within:outline-wire-strong">
        {Icon && <Icon size={16} aria-hidden className="shrink-0 text-muted" />}
        <input
          id={id}
          type={secret ? 'password' : 'text'}
          className={`min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint ${
            secret ? 'tracking-[1px]' : ''
          }`}
          {...inputProps}
        />
        {secret && <Eye size={16} aria-hidden className="shrink-0 text-muted" style={{ marginRight: 2 }} />}
        {children}
      </div>
      {help && <p className="text-[12.5px] text-muted">{help}</p>}
    </div>
  )
}

export function AuthSelect({ label, icon: Icon, value }: { label: string; icon?: LucideIcon; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-label={label}
        className="flex h-[36px] w-full items-center gap-[8px] rounded-base bg-surface px-[10px] text-left outline-1 -outline-offset-1 outline-line-strong"
      >
        {Icon && <Icon size={16} aria-hidden className="shrink-0 text-muted" />}
        <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{value}</span>
        <ChevronDown size={16} aria-hidden className="shrink-0 text-muted" />
      </button>
    </div>
  )
}

// ── Checkbox/On ───────────────────────────────────────────────────────────────
export function AuthCheckbox({ label, defaultChecked = true }: { label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex w-full cursor-pointer items-center gap-[8px]">
      <input type="checkbox" defaultChecked={defaultChecked} className="peer sr-only" />
      <span
        aria-hidden
        className="flex size-[16px] shrink-0 items-center justify-center rounded-xs bg-surface text-transparent outline-1 -outline-offset-1 outline-wire-strong peer-checked:bg-primary peer-checked:text-primary-ink peer-checked:outline-primary"
      >
        <Check size={12} strokeWidth={3} />
      </span>
      <span className="text-[13px] text-ink-2">{label}</span>
    </label>
  )
}

// ── Title block (optional 44px icon tile + H1 + sub) ─────────────────────────
export function AuthTitle({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  sub,
  lead = true,
}: {
  icon?: LucideIcon
  iconBg?: string
  iconColor?: string
  title: ReactNode
  sub: ReactNode
  /** Sub uses lineHeight 1.5 (all screens except Sign in). */
  lead?: boolean
}) {
  return (
    <div className="flex w-full flex-col gap-[6px]">
      {Icon && (
        <>
          <span
            className="flex size-[44px] items-center justify-center rounded-lg"
            style={{ background: iconBg }}
          >
            <Icon size={20} style={{ color: iconColor }} aria-hidden />
          </span>
          <span aria-hidden className="h-[6px] w-px" />
        </>
      )}
      <h1 className="font-display w-full text-[26px] font-semibold tracking-[-0.5px] text-ink">{title}</h1>
      <p className={`w-full text-[13.5px] text-muted ${lead ? 'leading-[1.5]' : ''}`}>{sub}</p>
    </div>
  )
}

// ── 6-digit code row ──────────────────────────────────────────────────────────
/** Six boxes split 3 + 3; `caret` = index of the focused (empty) box. */
export function CodeRow({ digits, caret }: { digits: string; caret: number }) {
  const box = (i: number) => {
    const active = i === caret
    return (
      <div
        key={i}
        className="flex h-[54px] min-w-0 flex-1 items-center justify-center rounded-[10px]"
        style={{
          boxShadow: active
            ? 'inset 0 0 0 1.5px #171717, 0 0 4px #0C0A0914'
            : 'inset 0 0 0 1px var(--color-line-strong)',
        }}
      >
        {active ? (
          <span className="h-[22px] w-[1.5px] animate-pulse bg-ink" />
        ) : (
          <span className="font-mono text-[22px] font-medium text-ink">{digits[i] ?? ''}</span>
        )}
      </div>
    )
  }
  return (
    <div role="group" aria-label="Verification code" className="flex w-full gap-[8px]">
      {[0, 1, 2].map(box)}
      <span aria-hidden className="h-[54px] w-[6px] shrink-0" />
      {[3, 4, 5].map(box)}
    </div>
  )
}

// ── Soft note (icon + text on $soft) ─────────────────────────────────────────
export function AuthNote({ icon, children, lead = false }: { icon: ReactNode; children: ReactNode; lead?: boolean }) {
  return (
    <div className="flex w-full items-center gap-[8px] rounded-[10px] bg-soft p-[10px]">
      {icon}
      <p className={`min-w-0 flex-1 text-[12px] text-ink-2 ${lead ? 'leading-[1.45]' : ''}`}>{children}</p>
    </div>
  )
}

// ── Centered "Question? Link" row ─────────────────────────────────────────────
export function AuthLinks({ q, a, href = '#', to, gap = 4 }: { q: ReactNode; a: ReactNode; href?: string; to?: string; gap?: number }) {
  return (
    <div className="flex w-full justify-center" style={{ gap }}>
      <span className="text-[13px] text-muted">{q}</span>
      {to ? (
        <Link to={to} className="text-[13px] font-medium text-link hover:underline">
          {a}
        </Link>
      ) : (
        <a href={href} className="text-[13px] font-medium text-link hover:underline">
          {a}
        </a>
      )}
    </div>
  )
}

/** Centered link with a leading icon (Back to sign in, Email me a code…). */
export function AuthIconLink({ icon: Icon, size = 14, children, href = '#', to }: { icon: LucideIcon; size?: number; children: ReactNode; href?: string; to?: string }) {
  return (
    <div className="flex w-full justify-center">
      {to ? (
        <Link to={to} className="flex items-center gap-[6px] text-[13px] font-medium text-link hover:underline">
          <Icon size={size} aria-hidden />
          {children}
        </Link>
      ) : (
        <a href={href} className="flex items-center gap-[6px] text-[13px] font-medium text-link hover:underline">
          <Icon size={size} aria-hidden />
          {children}
        </a>
      )}
    </div>
  )
}

// ── Strength meter (4 bars) ───────────────────────────────────────────────────
export function PasswordStrength({ bars = 3, hint, hintWeight = 'normal' }: { bars?: number; hint: string; hintWeight?: 'normal' | 'medium' }) {
  return (
    <div className="flex w-full flex-col gap-[6px]">
      <div className="flex w-full gap-[4px]">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-[4px] flex-1 rounded-pill"
            style={{ background: i < bars ? '#22C55E' : '#E7E5E4' }}
          />
        ))}
      </div>
      <p className={`text-[12px] text-ok ${hintWeight === 'medium' ? 'font-medium' : ''}`}>{hint}</p>
    </div>
  )
}
