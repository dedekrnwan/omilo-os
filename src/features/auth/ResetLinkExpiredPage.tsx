/** Reset link expired — /auth/reset-password/expired (pen GMMNj). */
import { useState } from 'react'
import { ArrowLeft, ClockAlert, Mail } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '../../app/useAuth'
import { useAuthFlow } from './authFlow'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthIconLink, AuthTitle } from './AuthPrimitives'

export function ResetLinkExpiredPage() {
  const { adapter, mock } = useAuth()
  const navigate = useNavigate()
  const setFlowEmail = useAuthFlow((s) => s.setEmail)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  async function resend() {
    if (!mock) {
      setLoading(true)
      try {
        await adapter.forgotPassword(email)
      } catch {
        // Neutral screen regardless.
      } finally {
        setLoading(false)
      }
    }
    setFlowEmail(email)
    await navigate({ to: '/auth/forgot-password/sent' })
  }

  return (
    <AuthLayout>
      <AuthTitle
        icon={ClockAlert}
        iconBg="#FEF3C7"
        iconColor="var(--color-warn)"
        title="This link has expired"
        sub="Reset links work for 30 minutes and only once. Send a fresh one and use the newest email."
      />
      <AuthField
        id="email"
        label="Work email"
        icon={Mail}
        type="email"
        placeholder="dede@saga.co.id"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <AuthButton onClick={resend} disabled={loading || !email}>
        {loading ? 'Sending…' : 'Send a new link'}
      </AuthButton>
      <AuthIconLink icon={ArrowLeft} to="/auth/sign-in">
        Back to sign in
      </AuthIconLink>
    </AuthLayout>
  )
}
