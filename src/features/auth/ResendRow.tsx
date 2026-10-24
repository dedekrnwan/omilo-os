/** "Resend in 0:42 · Use a different email" (Confirm your email, Check your email). */
export function ResendRow() {
  return (
    <div className="flex w-full justify-center gap-[6px] text-[13px]">
      <span className="text-faint">Resend in 0:42</span>
      <span className="text-faint">·</span>
      <a href="/auth/sign-in" className="font-medium text-link hover:underline">
        Use a different email
      </a>
    </div>
  )
}
