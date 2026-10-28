/** Two-step verification — /auth/two-step (pen cewrH). */
import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '../../app/useAuth'
import { MODE_HOME, useUIStore } from '../../app/store'
import { ApiError } from '../../adapters/http/auth'
import { useAuthFlow } from './authFlow'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthLinks, AuthTitle, CodeInput } from './AuthPrimitives'

export function TwoStepVerificationPage() {
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
      setError('Start again from sign-in.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const result = await adapter.twoFactorVerify(email, value)
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
        icon={ShieldCheck}
        iconBg="#DCFCE7"
        iconColor="var(--color-ok)"
        title="One more step"
        sub={
          email
            ? `We emailed a 6-digit verification code to ${email}. It expires in 10 minutes.`
            : 'We emailed a 6-digit verification code. It expires in 10 minutes.'
        }
      />
      <CodeInput value={code} onChange={setCode} onComplete={verify} />
      {error && (
        <p role="alert" className="w-full text-center text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <AuthButton onClick={() => verify(code)} disabled={loading || code.length < 6}>
        {loading ? 'Verifying…' : 'Continue'}
      </AuthButton>
      <AuthLinks q="Having trouble?" a="Back to sign in" to="/auth/sign-in" />
    </AuthLayout>
  )
}
