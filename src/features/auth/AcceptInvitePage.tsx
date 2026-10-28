/** Accept invite — /auth/invite (pen kIAtu). */
import { useEffect, useState } from 'react'
import { Lock, User as UserIcon } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '../../app/useAuth'
import { MODE_HOME, useUIStore } from '../../app/store'
import { ApiError } from '../../adapters/http/auth'
import type { InvitePreview } from '../../adapters/http/auth'
import { searchParam } from './authFlow'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthTitle } from './AuthPrimitives'

export function AcceptInvitePage() {
  const { adapter, applySignIn, mock } = useAuth()
  const navigate = useNavigate()
  const token = searchParam('token')

  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (mock || !token) return
    let active = true
    adapter
      .getInvite(token)
      .then((p) => active && setPreview(p))
      .catch(() => active && setLoadError('This invite is invalid or has expired.'))
    return () => {
      active = false
    }
  }, [adapter, token, mock])

  // No token in the URL → nothing to accept (derived, not state).
  const missingToken = !mock && !token

  async function accept() {
    if (mock) {
      await navigate({ to: MODE_HOME[useUIStore.getState().mode] })
      return
    }
    if (!token) return
    setError(null)
    setLoading(true)
    try {
      const needsAccount = preview && !preview.hasAccount
      const result = await adapter.acceptInvite(
        token,
        needsAccount ? name : undefined,
        needsAccount ? password : undefined,
      )
      applySignIn(result)
      await navigate({ to: MODE_HOME[useUIStore.getState().mode] })
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setError('Enter your name and a password (at least 8 characters).')
      } else if (err instanceof ApiError && err.status === 400) {
        setError('This invite is invalid or has expired.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const problem = missingToken ? 'This invite link is missing or invalid.' : loadError
  if (problem) {
    return (
      <AuthLayout>
        <AuthTitle title="Invite unavailable" sub={problem} />
        <AuthButton to="/auth/sign-in">Back to sign in</AuthButton>
      </AuthLayout>
    )
  }

  const company = preview?.companyName ?? ''
  const title = preview?.inviterName
    ? `${preview.inviterName} invited you to ${company}`
    : company
      ? `You're invited to ${company}`
      : 'You have an invite'
  const needsAccount = preview != null && !preview.hasAccount

  return (
    <AuthLayout>
      <AuthTitle
        title={title}
        sub={
          preview
            ? `You'll join as a ${preview.role}${
                needsAccount ? '. Create your account to accept.' : `. Accept to join ${company}.`
              }`
            : 'Loading your invite…'
        }
      />

      {preview && (
        <dl className="flex w-full flex-col rounded-lg bg-soft px-[14px] py-[4px]">
          <Row k="Email" v={preview.email} />
          <Row k="Role" v={preview.role} />
          {preview.channels && <Row k="Channels" v={preview.channels} />}
        </dl>
      )}

      {needsAccount && (
        <>
          <AuthField
            id="invite-name"
            label="Your name"
            icon={UserIcon}
            placeholder="Andi Pratama"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <AuthField
            id="invite-password"
            label="Create a password"
            labelTone="ink"
            icon={Lock}
            secret
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </>
      )}

      {error && (
        <p role="alert" className="w-full text-[12.5px] text-danger">
          {error}
        </p>
      )}

      <AuthButton
        onClick={accept}
        disabled={loading || !preview || (needsAccount && (!name || password.length < 8))}
      >
        {loading ? 'Joining…' : needsAccount ? 'Create account & accept' : 'Accept invite'}
      </AuthButton>
      {preview && <p className="w-full text-center text-[12px] text-faint">Invite expires soon</p>}
    </AuthLayout>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div
      className="flex w-full items-center gap-[10px] py-[10px]"
      style={{ boxShadow: 'inset 0 -1px 0 var(--color-line)' }}
    >
      <dt className="flex-1 text-[12.5px] text-muted">{k}</dt>
      <dd className="text-[12.5px] font-medium text-ink">{v}</dd>
    </div>
  )
}
