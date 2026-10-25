/** Reset link sent — /auth/forgot-password/sent (pen g4ord). */
import { ArrowLeft, ExternalLink, MailCheck } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthIconLink, AuthTitle } from './AuthPrimitives'

export function ResetLinkSentPage() {
  return (
    <AuthLayout>
      <AuthTitle
        icon={MailCheck}
        iconBg="#E0E7FF"
        iconColor="#4338CA"
        title="Check your email"
        sub="If dede@saga.co.id has an account, a reset link is on its way. It works for 30 minutes."
      />
      <AuthButton variant="secondary" icon={ExternalLink}>
        Open Gmail
      </AuthButton>
      <div className="flex w-full justify-center gap-[6px] text-[13px]">
        <span className="text-muted">Didn’t get it?</span>
        <span className="font-medium text-faint">Resend in 0:58</span>
      </div>
      <AuthIconLink icon={ArrowLeft} to="/auth/sign-in">
        Back to sign in
      </AuthIconLink>
    </AuthLayout>
  )
}
