/** Check your email (sign-in code) — /auth/check-email (pen A4bMp). */
import { useState } from 'react'
import { Info, MailCheck } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '../../app/useAuth'
import { MODE_HOME, useUIStore } from '../../app/store'
import { ApiError } from '../../adapters/http/auth'
import { useAuthFlow } from './authFlow'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthNote, AuthTitle, CodeInput } from './AuthPrimitives'
import { ResendRow } from './ResendRow'

export function CheckEmailPage() {
  const { adapter, applySignIn, mock } = useAuth()
  const navigate = useNavigate()
  const email = useAuthFlow((s) => s.email)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function verify(value: string) {
    if (mock) {
      await navigate({ to: '/auth/choose-company' })
      return
    }
    if (!email) {
      setError('Start again from sign-in to request a code.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const result = await adapter.verifyEmailCode(email, value)
      applySignIn(result)
      await navigate({ to: MODE_HOME[useUIStore.getState().mode] })
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
    <AuthLayout>
      <AuthTitle
        icon={MailCheck}
        iconBg="#E0E7FF"
        iconColor="#4338CA"
        title="Check your email"
        sub={
          email
            ? `We sent a 6-digit code to ${email}. It expires in 10 minutes.`
            : 'We sent a 6-digit code to your email. It expires in 10 minutes.'
        }
      />
      <CodeInput value={code} onChange={setCode} onComplete={verify} />
      {error && (
        <p role="alert" className="w-full text-center text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <AuthButton onClick={() => verify(code)} disabled={loading || code.length < 6}>
        {loading ? 'Verifying…' : 'Verify'}
      </AuthButton>
      <ResendRow onResend={() => (email ? adapter.requestEmailCode(email) : Promise.resolve())} />
      <AuthNote icon={<Info size={13} aria-hidden className="shrink-0 text-muted" />}>
        Can’t find it? Check spam, or open the link in the email instead.
      </AuthNote>
    </AuthLayout>
  )
}
