/** Sign up — /auth/sign-up (pen eAlcQ). */
import { useState } from 'react'
import { Lock, Mail, User } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '../../app/useAuth'
import { ApiError } from '../../adapters/http/auth'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthLinks, AuthTitle, GoogleButton, OrDivider, PasswordStrength } from './AuthPrimitives'

export function SignUpPage() {
  const { adapter, applySignIn, mock } = useAuth()
  const navigate = useNavigate()
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
      await navigate({ to: '/onboarding' })
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 409)) {
        setError(
          err.status === 409
            ? 'An account with this email already exists.'
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
      <GoogleButton to="/auth/choose-company">Sign up with Google</GoogleButton>
      <OrDivider />
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
        <PasswordStrength bars={3} hint="Strong · at least 10 characters, with a number" />
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
