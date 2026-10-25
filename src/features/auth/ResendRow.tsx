/** "Resend in 0:42 · Use a different email" (Confirm your email, Check your email). */
import { Link } from '@tanstack/react-router'

export function ResendRow({ differentEmailTo = '/auth/sign-in' }: { differentEmailTo?: string }) {
  return (
    <div className="flex w-full justify-center gap-[6px] text-[13px]">
      <span className="text-faint">Resend in 0:42</span>
      <span className="text-faint">·</span>
      <Link to={differentEmailTo} className="font-medium text-link hover:underline">
        Use a different email
      </Link>
    </div>
  )
}
