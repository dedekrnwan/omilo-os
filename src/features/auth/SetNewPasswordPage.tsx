/** Set new password — /auth/reset-password (pen gweHj). */
import { CircleCheck, Lock, LockKeyhole } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthCheckbox, AuthField, AuthTitle, PasswordStrength } from './AuthPrimitives'

const RULES = ['At least 10 characters', 'Has a number', 'Not your email or company name', 'Passwords match']

export function SetNewPasswordPage() {
  return (
    <AuthLayout>
      <AuthTitle
        icon={LockKeyhole}
        iconBg="var(--color-app)"
        iconColor="var(--color-ink-2)"
        title="Set a new password"
        sub="For dede@saga.co.id. You’ll stay signed in on this device."
      />
      <div className="flex w-full flex-col gap-[6px]">
        <AuthField id="new-password" label="New password" labelTone="ink" icon={Lock} secret defaultValue="omilo-secret-1" />
        <PasswordStrength bars={3} hint="Strong" hintWeight="medium" />
      </div>
      <AuthField id="confirm-password" label="Confirm password" labelTone="ink" icon={Lock} secret defaultValue="omilo-secret-1" />
      <ul className="flex w-full flex-col gap-[6px] rounded-[10px] bg-soft p-[12px]">
        {RULES.map((r) => (
          <li key={r} className="flex items-center gap-[8px]">
            <CircleCheck size={14} aria-hidden className="text-ok" />
            <span className="text-[12.5px] text-ink-2">{r}</span>
          </li>
        ))}
      </ul>
      <AuthCheckbox label="Sign out of my other devices" />
      <AuthButton to="/auth/reset-password/success">Update password</AuthButton>
    </AuthLayout>
  )
}
