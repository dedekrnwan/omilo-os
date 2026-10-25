/** Confirm your email — /auth/confirm-email (pen GuMJL). */
import { Info, MailCheck } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthNote, AuthTitle, CodeRow } from './AuthPrimitives'
import { ResendRow } from './ResendRow'

export function ConfirmEmailPage() {
  return (
    <AuthLayout step="Step 1 of 4">
      <AuthTitle
        icon={MailCheck}
        iconBg="#E0E7FF"
        iconColor="#4338CA"
        title="Confirm your email"
        sub="We sent a 6-digit code to dede@saga.co.id to confirm it’s yours. It expires in 10 minutes."
      />
      <CodeRow digits="482" caret={3} />
      <AuthButton to="/auth/onboarding/company">Confirm email</AuthButton>
      <ResendRow differentEmailTo="/auth/sign-up" />
      <AuthNote icon={<Info size={13} aria-hidden className="shrink-0 text-muted" />}>
        Can’t find it? Check spam, or open the link in the email instead.
      </AuthNote>
    </AuthLayout>
  )
}
