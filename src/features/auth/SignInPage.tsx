/** Sign in — /auth/sign-in (pen YBOIE). */
import { Lock, Mail } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthCheckbox, AuthField, AuthIconLink, AuthLinks, AuthTitle, GoogleButton, OrDivider } from './AuthPrimitives'

export function SignInPage() {
  return (
    <AuthLayout>
      <AuthTitle title="Sign in to Omilo" sub="Welcome back. Use Google or your email and password." lead={false} />
      <GoogleButton to="/auth/choose-company">Continue with Google</GoogleButton>
      <OrDivider />
      <AuthField id="email" label="Work email" icon={Mail} type="email" placeholder="dede@saga.co.id" />
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
        defaultValue="omilo-secret"
      />
      <AuthCheckbox label="Keep me signed in for 30 days" />
      <AuthButton to="/auth/two-step">Sign in</AuthButton>
      <AuthIconLink icon={Mail} size={13} to="/auth/check-email">
        Email me a sign-in code instead
      </AuthIconLink>
      <AuthLinks q="New to Omilo?" a="Create an account" to="/auth/sign-up" />
    </AuthLayout>
  )
}
