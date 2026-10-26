/** Password updated — /auth/reset-password/success (pen WUakJ). */
import { CircleCheck, ShieldAlert } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthNote, AuthTitle } from './AuthPrimitives'

export function PasswordUpdatedPage() {
  return (
    <AuthLayout>
      <AuthTitle
        icon={CircleCheck}
        iconBg="#DCFCE7"
        iconColor="var(--color-ok)"
        title="Password updated"
        sub="You’re signed in. We signed you out on 2 other devices, just in case."
      />
      <AuthButton to="/chat">Continue to Sahabat Warga</AuthButton>
      <AuthNote icon={<ShieldAlert size={13} aria-hidden className="shrink-0 text-muted" />} lead>
        Didn’t change this yourself? Secure your account and tell an admin.
      </AuthNote>
    </AuthLayout>
  )
}
