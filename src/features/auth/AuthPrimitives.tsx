/**
 * AuthPrimitives — the pen components used by the auth screens:
 * Auth/Google Button (QSXD9), Button/Primary (Upfho), Button/Secondary (sqbAw),
 * Input (PzYhe), Select (gVDns), Checkbox/On (l3E9dD), Logo/Google (w18bV),
 * plus the repeated screen parts (title block, code row, notes, links).
 */

import { useRef, useState } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { Check, ChevronDown, Eye, EyeOff } from 'lucide-react'
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
  /** Disable the button (e.g. while an async action is in flight). */
  disabled?: boolean
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
  disabled = false,
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
      disabled={disabled}
      className={`flex w-full items-center justify-center gap-[6px] rounded-btn px-[14px] text-[14px] font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${look} ${className}`}
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
  const [show, setShow] = useState(false)
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
          type={secret && !show ? 'password' : 'text'}
          className={`min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint ${
            secret && !show ? 'tracking-[1px]' : ''
          }`}
          {...inputProps}
        />
        {secret && (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className="shrink-0 text-muted hover:text-ink transition-colors"
            style={{ marginRight: 2 }}
          >
            {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </button>
        )}
        {children}
      </div>
      {help && <p className="text-[12.5px] text-muted">{help}</p>}
    </div>
  )
}

export function AuthSelect({
  label,
  icon: Icon,
  value,
  defaultValue,
  options,
  onChange,
  id,
}: {
  label: string
  icon?: LucideIcon
  /** Controlled value — pair with onChange. Omit and use defaultValue for uncontrolled. */
  value?: string
  defaultValue?: string
  /** The choices. Falls back to the current value when omitted (single, read-only). */
  options?: string[]
  onChange?: (value: string) => void
  id?: string
}) {
  const choices = options ?? [value ?? defaultValue ?? '']
  const controlled = value !== undefined && onChange !== undefined
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      <div className="flex h-[36px] w-full items-center gap-[8px] rounded-base bg-surface px-[10px] outline-1 -outline-offset-1 outline-line-strong focus-within:outline-wire-strong">
        {Icon && <Icon size={16} aria-hidden className="shrink-0 text-muted" />}
        <select
          id={id}
          aria-label={label}
          {...(controlled ? { value } : { defaultValue: defaultValue ?? value })}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-[14px] text-ink outline-none"
        >
          {choices.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden className="shrink-0 text-muted" />
      </div>
    </div>
  )
}

// ── Checkbox/On ───────────────────────────────────────────────────────────────
export function AuthCheckbox({
  label,
  defaultChecked = true,
  checked,
  onChange,
}: {
  label: string
  defaultChecked?: boolean
  /** When provided (with onChange) the checkbox is controlled. */
  checked?: boolean
  onChange?: (checked: boolean) => void
}) {
  const controlled = checked !== undefined && onChange !== undefined
  return (
    <label className="flex w-full cursor-pointer items-center gap-[8px]">
      <input
        type="checkbox"
        {...(controlled
          ? { checked, onChange: (e) => onChange(e.target.checked) }
          : { defaultChecked })}
        className="peer sr-only"
      />
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

/** Editable verification-code entry: an invisible input over the pen boxes. */
export function CodeInput({
  length = 6,
  value,
  onChange,
  onComplete,
  autoFocus = true,
}: {
  length?: number
  value: string
  onChange: (v: string) => void
  onComplete?: (v: string) => void
  autoFocus?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value.replace(/\D/g, '').slice(0, length)
    onChange(next)
    if (next.length === length) onComplete?.(next)
  }

  const box = (i: number) => {
    const active = i === value.length
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
          <span className="font-mono text-[22px] font-medium text-ink">{value[i] ?? ''}</span>
        )}
      </div>
    )
  }

  const idx = Array.from({ length }, (_, i) => i)
  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        value={value}
        onChange={handle}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="Verification code"
        autoFocus={autoFocus}
        maxLength={length}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer tracking-[0] opacity-0"
      />
      <div className="flex w-full gap-[8px]" aria-hidden>
        {length === 6 ? (
          <>
            {idx.slice(0, 3).map(box)}
            <span className="h-[54px] w-[6px] shrink-0" />
            {idx.slice(3).map(box)}
          </>
        ) : (
          idx.map(box)
        )}
      </div>
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
// Requirement: at least 10 characters, with a number. When a `password` is
// passed the meter computes live strength (bar count + colour + hint). Without
// it, falls back to the static `bars`/`hint` (back-compat for existing callers).
type StrengthTone = 'muted' | 'bad' | 'warn' | 'ok'

export function scorePassword(pw: string): { fill: number; text: string; tone: StrengthTone } {
  if (pw.length === 0) {
    return { fill: 0, text: 'At least 10 characters, with a number', tone: 'muted' }
  }
  const hasLen = pw.length >= 10
  const hasNum = /\d/.test(pw)
  const hasVariety = /[A-Z]/.test(pw) || /[^A-Za-z0-9]/.test(pw)
  const score = [pw.length >= 6, hasLen, hasNum, hasVariety].filter(Boolean).length

  if (!(hasLen && hasNum)) {
    // Requirement not met yet → amber/red, tell them what's missing.
    const missing = !hasLen ? 'Use at least 10 characters' : 'Add a number'
    return { fill: Math.min(Math.max(score, 1), 2), text: missing, tone: score <= 1 ? 'bad' : 'warn' }
  }
  // Requirement met.
  return score >= 4
    ? { fill: 4, text: 'Very strong', tone: 'ok' }
    : { fill: 3, text: 'Strong · at least 10 characters, with a number', tone: 'ok' }
}

export function PasswordStrength({
  password,
  bars = 3,
  hint,
  hintWeight = 'normal',
}: {
  /** When provided, the meter computes strength from this value. */
  password?: string
  bars?: number
  hint?: string
  hintWeight?: 'normal' | 'medium'
}) {
  const live = password !== undefined
  const s = live ? scorePassword(password ?? '') : null
  const fill = s ? s.fill : bars
  const text = s ? s.text : (hint ?? '')
  const tone: StrengthTone = s ? s.tone : 'ok'

  const barColor =
    tone === 'bad' ? '#EF4444' : tone === 'warn' ? '#F59E0B' : tone === 'ok' ? '#22C55E' : '#E7E5E4'
  const textClass =
    tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-[#B45309]' : tone === 'muted' ? 'text-muted' : 'text-ok'

  return (
    <div className="flex w-full flex-col gap-[6px]">
      <div className="flex w-full gap-[4px]">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-[4px] flex-1 rounded-pill transition-colors"
            style={{ background: i < fill ? barColor : '#E7E5E4' }}
          />
        ))}
      </div>
      <p className={`text-[12px] ${textClass} ${hintWeight === 'medium' ? 'font-medium' : ''}`}>{text}</p>
    </div>
  )
}
