/** Sign in — /auth/sign-in (pen YBOIE). */
import { useState } from 'react'
import { Lock, Mail } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { useAuth, isMockMode } from '../../app/useAuth'
import { useSession } from '../../app/session'
import { ApiError, isTwoFactorChallenge } from '../../adapters/http/auth'
import { MODE_HOME, useUIStore } from '../../app/store'
import { isTauri } from '../../platform'
import { useAuthFlow } from './authFlow'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthCheckbox, AuthField, AuthLinks, AuthTitle, GoogleButton, OrDivider } from './AuthPrimitives'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export function SignInPage() {
  const { adapter, applySignIn, mock } = useAuth()
  const navigate = useNavigate()
  const googleEnabled = useSession((s) => s.googleEnabled)
  const setFlowEmail = useAuthFlow((s) => s.setEmail)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [keepSignedIn, setKeepSignedIn] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  /** Persist the "keep me signed in" preference so the token layer can honour it. */
  function rememberPreference() {
    try {
      localStorage.setItem('omilo.keepSignedIn', keepSignedIn ? '1' : '0')
    } catch {
      /* storage unavailable — preference is best-effort */
    }
  }

  function handleGoogleSignIn() {
    const client = isTauri() ? 'desktop' : 'web'
    window.location.assign(`${API}/v1/auth/google/start?client=${client}`)
  }

  async function goHome() {
    const home = MODE_HOME[useUIStore.getState().mode]
    await navigate({ to: home })
  }

  async function handleSignIn() {
    rememberPreference()
    if (mock) {
      // Mock mode: app is already authed via synthetic session — navigate home directly.
      await goHome()
      return
    }

    setError(null)
    setLoading(true)
    try {
      const result = await adapter.signIn(email, password, keepSignedIn)
      if (isTwoFactorChallenge(result)) {
        // 2FA on: a code was emailed — finish on the two-step page.
        setFlowEmail(result.email)
        await navigate({ to: '/auth/two-step' })
        return
      }
      applySignIn(result)
      await goHome()
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

  async function handleEmailCode() {
    if (mock) {
      await navigate({ to: '/auth/check-email' })
      return
    }
    if (!email) {
      setError('Enter your email first, then request a code.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await adapter.requestEmailCode(email)
      setFlowEmail(email)
      await navigate({ to: '/auth/check-email' })
    } catch {
      setError('Could not send a code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <AuthTitle title="Sign in to Omilo" sub="Welcome back. Use Google or your email and password." lead={false} />
      {!isMockMode() && googleEnabled && (
        <GoogleButton onClick={handleGoogleSignIn}>Continue with Google</GoogleButton>
      )}
      {!isMockMode() && googleEnabled && <OrDivider />}
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
      <AuthCheckbox label="Keep me signed in for 30 days" checked={keepSignedIn} onChange={setKeepSignedIn} />
      <AuthButton onClick={handleSignIn} disabled={loading}>
        {loading ? 'Signing in…' : 'Sign in'}
      </AuthButton>
      <button
        type="button"
        onClick={handleEmailCode}
        disabled={loading}
        className="flex w-full items-center justify-center gap-[6px] text-[13px] font-medium text-link hover:underline disabled:opacity-60"
      >
        <Mail size={13} aria-hidden />
        Email me a sign-in code instead
      </button>
      <AuthLinks q="New to Omilo?" a="Create an account" to="/auth/sign-up" />
    </AuthLayout>
  )
}
