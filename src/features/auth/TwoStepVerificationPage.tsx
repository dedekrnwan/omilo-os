/** Two-step verification — /auth/two-step (pen cewrH). */
import { ShieldCheck } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthCheckbox, AuthLinks, AuthTitle, CodeRow } from './AuthPrimitives'

export function TwoStepVerificationPage() {
  return (
    <AuthLayout>
      <AuthTitle
        icon={ShieldCheck}
        iconBg="#DCFCE7"
        iconColor="var(--color-ok)"
        title="One more step"
        sub="You own Sahabat Warga, so we ask for a code from your authenticator app."
      />
      <CodeRow digits="30917" caret={5} />
      <AuthCheckbox label="Trust this device for 30 days" />
      <AuthButton to="/auth/choose-company">Continue</AuthButton>
      <AuthLinks q="Lost your phone?" a="Use a backup code" />
    </AuthLayout>
  )
}
