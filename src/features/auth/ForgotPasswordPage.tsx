/** Forgot password — /auth/forgot-password (pen frQuc). */
import { useState } from 'react'
import { ArrowLeft, KeyRound, Mail } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '../../app/useAuth'
import { useAuthFlow } from './authFlow'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthIconLink, AuthNote, AuthTitle, GoogleLogo } from './AuthPrimitives'

export function ForgotPasswordPage() {
  const { adapter, mock } = useAuth()
  const navigate = useNavigate()
  const setFlowEmail = useAuthFlow((s) => s.setEmail)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSend() {
    if (!mock) {
      setLoading(true)
      try {
        // Always resolves (the backend never reveals whether an account exists).
        await adapter.forgotPassword(email)
      } catch {
        // Swallow — we still show the neutral "check your email" screen.
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
        icon={KeyRound}
        iconBg="var(--color-app)"
        iconColor="var(--color-ink-2)"
        title="Forgot your password?"
        sub="Enter your work email and we’ll send a link to set a new one."
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
      <AuthButton onClick={handleSend} disabled={loading || !email}>
        {loading ? 'Sending…' : 'Send reset link'}
      </AuthButton>
      <AuthIconLink icon={ArrowLeft} to="/auth/sign-in">
        Back to sign in
      </AuthIconLink>
      <AuthNote icon={<GoogleLogo size={14} />} lead>
        Signed up with Google? There’s no password to reset — just continue with Google.
      </AuthNote>
    </AuthLayout>
  )
}
