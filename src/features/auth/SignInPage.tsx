/** Sign in — /auth/sign-in (pen YBOIE). */
import { useState } from 'react'
import { Lock, Mail } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '../../app/useAuth'
import { ApiError } from '../../adapters/http/auth'
import { MODE_HOME, useUIStore } from '../../app/store'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthCheckbox, AuthField, AuthIconLink, AuthLinks, AuthTitle, GoogleButton, OrDivider } from './AuthPrimitives'

export function SignInPage() {
  const { adapter, applySignIn, mock } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSignIn() {
    if (mock) {
      // Mock mode: app is already authed via synthetic session — navigate home directly.
      const home = MODE_HOME[useUIStore.getState().mode]
      await navigate({ to: home })
      return
    }

    setError(null)
    setLoading(true)
    try {
      const result = await adapter.signIn(email, password)
      applySignIn(result)
      const home = MODE_HOME[useUIStore.getState().mode]
      await navigate({ to: home })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Incorrect email or password. Please try again.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <AuthTitle title="Sign in to Omilo" sub="Welcome back. Use Google or your email and password." lead={false} />
      <GoogleButton to="/auth/choose-company">Continue with Google</GoogleButton>
      <OrDivider />
      <AuthField
        id="email"
        label="Work email"
        icon={Mail}
        type="email"
        placeholder="dede@saga.co.id"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <AuthField
        id="password"
        label="Password"
        labelTone="ink"
        right={
          <Link to="/auth/forgot-password" className="text-[12.5px] font-medium text-link hover:underline">
            Forgot password?
          </Link>
        }
        icon={Lock}
        secret
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && (
        <p role="alert" className="w-full text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <AuthCheckbox label="Keep me signed in for 30 days" />
      <AuthButton onClick={handleSignIn} disabled={loading}>
        {loading ? 'Signing in…' : 'Sign in'}
      </AuthButton>
      <AuthIconLink icon={Mail} size={13} to="/auth/check-email">
        Email me a sign-in code instead
      </AuthIconLink>
      <AuthLinks q="New to Omilo?" a="Create an account" to="/auth/sign-up" />
    </AuthLayout>
  )
}
