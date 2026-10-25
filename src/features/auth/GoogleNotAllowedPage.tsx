/** Google account not allowed — /auth/sign-in/google-not-allowed (pen S517J). */
import { CircleAlert, Mail } from 'lucide-react'
import { AuthLayout } from './AuthLayout'
import { AuthButton, AuthLinks, AuthTitle, GoogleButton } from './AuthPrimitives'

export function GoogleNotAllowedPage() {
  return (
    <AuthLayout>
      <AuthTitle title="Sign in to Omilo" sub="Use your work Google account, or we’ll email you a code." />
      <div
        role="alert"
        className="flex w-full gap-[10px] rounded-[10px] bg-bad-tint p-[12px]"
        style={{ boxShadow: 'inset 0 0 0 1px #FECACA' }}
      >
        <CircleAlert size={16} aria-hidden className="shrink-0 text-bad" />
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <p className="text-[13px] font-semibold text-bad">This Google account can’t join Sahabat Warga</p>
          <p className="text-[12.5px] leading-[1.45] text-[#7F1D1D]">
            You signed in as dede.k@gmail.com. This company only allows @saga.co.id accounts.
          </p>
        </div>
      </div>
      <GoogleButton to="/auth/sign-in">Use another Google account</GoogleButton>
      <AuthButton variant="secondary" icon={Mail} to="/auth/check-email">
        Email me a code instead
      </AuthButton>
      <AuthLinks q="Wrong company?" a="Ask an admin for an invite" to="/auth/invite" />
    </AuthLayout>
  )
}
