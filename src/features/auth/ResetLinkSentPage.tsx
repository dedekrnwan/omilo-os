/** Reset link sent — /auth/forgot-password/sent (pen g4ord). */
import { ArrowLeft, ExternalLink, MailCheck } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthIconLink, AuthTitle } from './AuthPrimitives'
import { useAuthFlow } from './authFlow'

export function ResetLinkSentPage() {
  const email = useAuthFlow((s) => s.email)
  return (
    <AuthLayout>
      <AuthTitle
        icon={MailCheck}
        iconBg="#E0E7FF"
        iconColor="#4338CA"
        title="Check your email"
        sub={
          email
            ? `If ${email} has an account, a reset link is on its way. It works for 30 minutes.`
            : 'If that email has an account, a reset link is on its way. It works for 30 minutes.'
        }
      />
      <AuthButton variant="secondary" icon={ExternalLink} onClick={() => window.open('https://mail.google.com', '_blank')}>
        Open Gmail
      </AuthButton>
      <AuthIconLink icon={ArrowLeft} to="/auth/sign-in">
        Back to sign in
      </AuthIconLink>
    </AuthLayout>
  )
}
