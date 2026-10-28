/** Sign up — /auth/sign-up (pen eAlcQ). */
import { useState } from 'react'
import { Lock, Mail, User } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth, isMockMode } from '../../app/useAuth'
import { useSession } from '../../app/session'
import { ApiError } from '../../adapters/http/auth'
import { isTauri } from '../../platform'
import { useAuthFlow } from './authFlow'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthLinks, AuthTitle, GoogleButton, OrDivider, PasswordStrength } from './AuthPrimitives'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export function SignUpPage() {
  const { adapter, applySignIn, mock } = useAuth()
  const navigate = useNavigate()
  const googleEnabled = useSession((s) => s.googleEnabled)
  const setFlowEmail = useAuthFlow((s) => s.setEmail)

  function handleGoogleSignUp() {
    const client = isTauri() ? 'desktop' : 'web'
    window.location.assign(`${API}/v1/auth/google/start?client=${client}`)
  }
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleCreateAccount() {
    if (mock) {
      // Mock mode: skip network, navigate to onboarding.
      await navigate({ to: '/onboarding' })
      return
    }

    setError(null)
    setLoading(true)
    try {
      const result = await adapter.signUp(name, email, password)
      applySignIn(result)
      // Email a verification code and route through the confirm-email step.
      setFlowEmail(email)
      try {
        await adapter.requestVerifyEmail(email)
      } catch {
        // Non-fatal — the user can resend from the confirm page.
      }
      await navigate({ to: '/auth/confirm-email' })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.message === 'email_unverified') {
        // Existing but UNVERIFIED account (an earlier attempt that never
        // verified) — don't dead-end; resend the code and route to verify.
        setFlowEmail(email)
        try {
          await adapter.requestVerifyEmail(email)
        } catch {
          // Surfaced on the confirm page's resend if it fails.
        }
        await navigate({ to: '/auth/confirm-email' })
      } else if (err instanceof ApiError && (err.status === 401 || err.status === 409)) {
        setError(
          err.status === 409
            ? 'An account with this email already exists. Try signing in.'
            : 'Sign-up failed. Please check your details.',
        )
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <AuthTitle title="Create your Omilo account" sub="Google is the fastest. Or use your work email and a password." />
      {!isMockMode() && googleEnabled && (
        <GoogleButton onClick={handleGoogleSignUp}>Sign up with Google</GoogleButton>
      )}
      {!isMockMode() && googleEnabled && <OrDivider />}
      <AuthField
        id="name"
        label="Your name"
        icon={User}
        placeholder="Dede Kurniawan"
        value={name}
        onChange={(e) => setName(e.target.value)}
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
      <div className="flex w-full flex-col gap-[6px]">
        <AuthField
          id="password"
          label="Password"
          labelTone="ink"
          icon={Lock}
          secret
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <PasswordStrength password={password} />
      </div>
      {error && (
        <p role="alert" className="w-full text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <AuthButton onClick={handleCreateAccount} disabled={loading}>
        {loading ? 'Creating account…' : 'Create account'}
      </AuthButton>
      <AuthLinks q="Already have an account?" a="Sign in" to="/auth/sign-in" />
    </AuthLayout>
  )
}
