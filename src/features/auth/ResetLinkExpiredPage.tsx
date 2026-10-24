/** Reset link expired — /auth/reset-password/expired (pen GMMNj). */
import { ArrowLeft, ClockAlert, Mail } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthIconLink, AuthTitle } from './AuthPrimitives'

export function ResetLinkExpiredPage() {
  return (
    <AuthLayout>
      <AuthTitle
        icon={ClockAlert}
        iconBg="#FEF3C7"
        iconColor="var(--color-warn)"
        title="This link has expired"
        sub="Reset links work for 30 minutes and only once. Send a fresh one and use the newest email."
      />
      <AuthField id="email" label="Work email" icon={Mail} type="email" placeholder="dede@saga.co.id" />
      <AuthButton>Send a new link</AuthButton>
      <AuthIconLink icon={ArrowLeft} href="/auth/sign-in">
        Back to sign in
      </AuthIconLink>
    </AuthLayout>
  )
}
