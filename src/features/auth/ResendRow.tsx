/** "Resend in 0:42 · Use a different email" (Confirm your email, Check your email). */
import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'

export function ResendRow({
  differentEmailTo = '/auth/sign-in',
  onResend,
  seconds = 42,
}: {
  differentEmailTo?: string
  /** Called when the user clicks Resend. Resets the countdown on resolve. */
  onResend?: () => Promise<void>
  seconds?: number
}) {
  const [left, setLeft] = useState(seconds)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  useEffect(() => {
    timer.current = setInterval(() => {
      setLeft((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => clearInterval(timer.current)
  }, [])

  async function resend() {
    if (!onResend || left > 0 || busy) return
    setBusy(true)
    try {
      await onResend()
      setLeft(seconds)
    } finally {
      setBusy(false)
    }
  }

  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`

  return (
    <div className="flex w-full justify-center gap-[6px] text-[13px]">
      {left > 0 ? (
        <span className="text-faint">Resend in {mmss}</span>
      ) : onResend ? (
        <button
          type="button"
          onClick={resend}
          disabled={busy}
          className="font-medium text-link hover:underline disabled:opacity-60"
        >
          {busy ? 'Resending…' : 'Resend code'}
        </button>
      ) : (
        <span className="text-faint">Resend available</span>
      )}
      <span className="text-faint">·</span>
      <Link to={differentEmailTo} className="font-medium text-link hover:underline">
        Use a different email
      </Link>
    </div>
  )
}
