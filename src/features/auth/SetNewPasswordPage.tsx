/** Set new password — /auth/reset-password (pen gweHj). */
import { useState } from 'react'
import { Circle, CircleCheck, Lock, LockKeyhole } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '../../app/useAuth'
import { ApiError } from '../../adapters/http/auth'
import { searchParam } from './authFlow'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthTitle, PasswordStrength } from './AuthPrimitives'

export function SetNewPasswordPage() {
  const { adapter, applySignIn, mock } = useAuth()
  const navigate = useNavigate()
  const token = searchParam('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const rules = [
    { label: 'At least 10 characters', ok: password.length >= 10 },
    { label: 'Has a number', ok: /\d/.test(password) },
    { label: 'Passwords match', ok: password.length > 0 && password === confirm },
  ]
  const allOk = rules.every((r) => r.ok)
  const bars = rules.filter((r) => r.ok).length + 1

  async function handleUpdate() {
    if (mock) {
      await navigate({ to: '/auth/reset-password/success' })
      return
    }
    if (!token) {
      setError('This reset link is missing or invalid. Request a new one.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const result = await adapter.resetPassword(token, password)
      applySignIn(result)
      await navigate({ to: '/auth/reset-password/success' })
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        await navigate({ to: '/auth/reset-password/expired' })
        return
      }
      setError('Could not update your password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <AuthTitle
        icon={LockKeyhole}
        iconBg="var(--color-app)"
        iconColor="var(--color-ink-2)"
        title="Set a new password"
        sub="Choose a new password — you’ll stay signed in on this device."
      />
      <div className="flex w-full flex-col gap-[6px]">
        <AuthField
          id="new-password"
          label="New password"
          labelTone="ink"
          icon={Lock}
          secret
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PasswordStrength
          bars={bars}
          hint={allOk ? 'Strong' : 'Keep going…'}
          hintWeight="medium"
        />
      </div>
      <AuthField
        id="confirm-password"
        label="Confirm password"
        labelTone="ink"
        icon={Lock}
        secret
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <ul className="flex w-full flex-col gap-[6px] rounded-[10px] bg-soft p-[12px]">
        {rules.map((r) => (
          <li key={r.label} className="flex items-center gap-[8px]">
            {r.ok ? (
              <CircleCheck size={14} aria-hidden className="text-ok" />
            ) : (
              <Circle size={14} aria-hidden className="text-faint" />
            )}
            <span className="text-[12.5px] text-ink-2">{r.label}</span>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="w-full text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <AuthButton onClick={handleUpdate} disabled={loading || !allOk}>
        {loading ? 'Updating…' : 'Update password'}
      </AuthButton>
    </AuthLayout>
  )
}
