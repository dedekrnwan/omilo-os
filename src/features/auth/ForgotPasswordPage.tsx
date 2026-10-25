/** Forgot password — /auth/forgot-password (pen frQuc). */
import { ArrowLeft, KeyRound, Mail } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthIconLink, AuthNote, AuthTitle, GoogleLogo } from './AuthPrimitives'

export function ForgotPasswordPage() {
  return (
    <AuthLayout>
      <AuthTitle
        icon={KeyRound}
        iconBg="var(--color-app)"
        iconColor="var(--color-ink-2)"
        title="Forgot your password?"
        sub="Enter your work email and we’ll send a link to set a new one."
      />
      <AuthField id="email" label="Work email" icon={Mail} type="email" placeholder="dede@saga.co.id" />
      <AuthButton to="/auth/forgot-password/sent">Send reset link</AuthButton>
      <AuthIconLink icon={ArrowLeft} to="/auth/sign-in">
        Back to sign in
      </AuthIconLink>
      <AuthNote icon={<GoogleLogo size={14} />} lead>
        Signed up with Google? There’s no password to reset — just continue with Google.
      </AuthNote>
    </AuthLayout>
  )
}
