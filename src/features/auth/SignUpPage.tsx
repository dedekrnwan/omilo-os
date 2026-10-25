/** Sign up — /auth/sign-up (pen eAlcQ). */
import { Lock, Mail, User } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthField, AuthLinks, AuthTitle, GoogleButton, OrDivider, PasswordStrength } from './AuthPrimitives'

export function SignUpPage() {
  return (
    <AuthLayout>
      <AuthTitle title="Create your Omilo account" sub="Google is the fastest. Or use your work email and a password." />
      <GoogleButton to="/auth/choose-company">Sign up with Google</GoogleButton>
      <OrDivider />
      <AuthField id="name" label="Your name" icon={User} placeholder="Dede Kurniawan" />
      <AuthField id="email" label="Work email" icon={Mail} type="email" placeholder="dede@saga.co.id" />
      <div className="flex w-full flex-col gap-[6px]">
        <AuthField id="password" label="Password" labelTone="ink" icon={Lock} secret defaultValue="omilo-secret" />
        <PasswordStrength bars={3} hint="Strong · at least 10 characters, with a number" />
      </div>
      <AuthButton to="/auth/confirm-email">Create account</AuthButton>
      <AuthLinks q="Already have an account?" a="Sign in" to="/auth/sign-in" />
    </AuthLayout>
  )
}
