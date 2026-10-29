/**
 * DetectedHarnesses — lists every poolable coding-assistant harness with its
 * brand logo and badges whichever are installed / signed in on this machine
 * (via GET /v1/ai-accounts/detect). Connecting a signed-in harness creates a
 * keyless "local session" account. Self-host / local-runtime feature; in a
 * cloud deployment nothing is detected and the cards read "Not detected".
 */
import { useState } from 'react'
import { Check, Loader } from 'lucide-react'
import { HARNESSES } from '../../features/control-panel/harnesses'
import { useHarnessDetect } from '../../app/queries'
import { HarnessLogo } from './harnessLogos'

export function DetectedHarnesses({
  onConnect,
  connectedHarnessIds,
}: {
  /** Connect a detected harness as a local-session account. */
  onConnect: (harnessId: string, name: string) => Promise<void>
  /** Harness ids already connected (to show "Connected"). */
  connectedHarnessIds: Set<string>
}) {
  const { data: detections, isLoading } = useHarnessDetect()
  const byId = new Map((detections ?? []).map((d) => [d.id, d]))
  const [connectingId, setConnectingId] = useState<string | null>(null)

  async function connect(id: string, name: string) {
    setConnectingId(id)
    try {
      await onConnect(id, name)
    } finally {
      setConnectingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-[6px]">
      {HARNESSES.map((h) => {
        const det = byId.get(h.id)
        const connected = connectedHarnessIds.has(h.id)
        const signedIn = det?.signedIn ?? false
        const installed = det?.installed ?? false
        const busy = connectingId === h.id

        return (
          <div
            key={h.id}
            className="flex w-full items-center gap-[12px] rounded-md px-[14px] py-[10px]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--color-line-strong)' }}
          >
            <span className="flex size-[36px] shrink-0 items-center justify-center rounded-md bg-surface outline-1 -outline-offset-1 outline-line">
              <HarnessLogo id={h.id} size={22} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
              <span className="text-[14px] font-semibold text-ink">{h.name}</span>
              <span className="truncate text-[12px] text-muted">
                {connected
                  ? 'Connected to your pool'
                  : signedIn
                    ? 'Found on this computer · signed in'
                    : installed
                      ? `Found · sign in with the ${h.name} CLI first`
                      : h.blurb}
              </span>
            </div>

            {/* Status + action */}
            {connected ? (
              <span className="flex items-center gap-[5px] text-[12px] font-medium text-ok">
                <Check size={13} aria-hidden /> Connected
              </span>
            ) : isLoading ? (
              <span className="text-[12px] text-faint">Checking…</span>
            ) : signedIn ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => connect(h.id, h.name)}
                className="flex h-[30px] shrink-0 items-center gap-[6px] rounded-btn bg-ink px-[12px] text-[12px] font-medium text-surface disabled:opacity-50"
              >
                {busy && <Loader size={12} className="animate-spin" aria-hidden />}
                {busy ? 'Connecting…' : 'Use this'}
              </button>
            ) : installed ? (
              <span className="shrink-0 rounded-sm bg-warn-tint px-[8px] py-[3px] text-[11px] font-medium text-warn outline-1 -outline-offset-1 outline-warn-line">
                Sign in required
              </span>
            ) : (
              <span className="shrink-0 text-[12px] text-faint">Not detected</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
