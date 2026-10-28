/** Confirm your email — /auth/confirm-email (pen GuMJL). */
import { useState } from 'react'
import { Info, MailCheck } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '../../app/useAuth'
import { ApiError } from '../../adapters/http/auth'
import { searchParam, useAuthFlow } from './authFlow'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthNote, AuthTitle, CodeInput } from './AuthPrimitives'
import { ResendRow } from './ResendRow'

export function ConfirmEmailPage() {
  const { adapter, mock } = useAuth()
  const navigate = useNavigate()
  const email = useAuthFlow((s) => s.email) ?? searchParam('email')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function confirm(value: string) {
    if (mock) {
      await navigate({ to: '/onboarding' })
      return
    }
    if (!email) {
      setError('Start again from sign-up to receive a code.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await adapter.confirmEmail(email, value)
      await navigate({ to: '/onboarding' })
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? 'That code is invalid or has expired.'
          : 'Something went wrong. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout step="Step 1 of 4">
      <AuthTitle
        icon={MailCheck}
        iconBg="#E0E7FF"
        iconColor="#4338CA"
        title="Confirm your email"
        sub={
          email
            ? `We sent a 6-digit code to ${email} to confirm it’s yours. It expires in 10 minutes.`
            : 'We sent a 6-digit code to confirm your email. It expires in 10 minutes.'
        }
      />
      <CodeInput value={code} onChange={setCode} onComplete={confirm} />
      {error && (
        <p role="alert" className="w-full text-center text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <AuthButton onClick={() => confirm(code)} disabled={loading || code.length < 6}>
        {loading ? 'Confirming…' : 'Confirm email'}
      </AuthButton>
      <ResendRow
        differentEmailTo="/auth/sign-up"
        onResend={() => (email ? adapter.requestVerifyEmail(email) : Promise.resolve())}
      />
      <AuthNote icon={<Info size={13} aria-hidden className="shrink-0 text-muted" />}>
        Can’t find it? Check spam, or open the link in the email instead.
      </AuthNote>
    </AuthLayout>
  )
}
