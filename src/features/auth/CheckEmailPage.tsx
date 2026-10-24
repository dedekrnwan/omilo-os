/** Check your email (sign-in code) — /auth/check-email (pen A4bMp). */
import { Info, MailCheck } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthNote, AuthTitle, CodeRow } from './AuthPrimitives'
import { ResendRow } from './ResendRow'

export function CheckEmailPage() {
  return (
    <AuthLayout>
      <AuthTitle
        icon={MailCheck}
        iconBg="#E0E7FF"
        iconColor="#4338CA"
        title="Check your email"
        sub="We sent a 6-digit code to dede@saga.co.id. It expires in 10 minutes."
      />
      <CodeRow digits="482" caret={3} />
      <AuthButton>Verify</AuthButton>
      <ResendRow />
      <AuthNote icon={<Info size={13} aria-hidden className="shrink-0 text-muted" />}>
        Can’t find it? Check spam, or open the link in the email instead.
      </AuthNote>
    </AuthLayout>
  )
}
