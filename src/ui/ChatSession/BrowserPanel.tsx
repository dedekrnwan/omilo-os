/**
 * BrowserPanel — right-hand agent browser panel (pen ref E5554m / ocar6).
 *
 * Split pane state: session thread on the left, this panel on the right.
 * Two sub-states:
 *   - Agent browsing (E5554m): normal browser chrome + status bar.
 *   - You took over  (ocar6):  warning banner at top + "Hand back to Dev" footer.
 */

import { useState } from 'react'
import { ArrowLeft, ArrowRight, RefreshCw, X } from 'lucide-react'
import { IconButton } from '../ds/Button'

// ── Sub-components ────────────────────────────────────────────────────────────

function BrowserChrome({ url }: { url: string }) {
  return (
    <div className="flex h-[36px] shrink-0 items-center gap-[6px] border-b border-line px-[10px]">
      <IconButton icon={ArrowLeft} aria-label="Back" size={14} />
      <IconButton icon={ArrowRight} aria-label="Forward" size={14} />
      <IconButton icon={RefreshCw} aria-label="Reload" size={14} />
      {/* URL bar */}
      <div className="flex flex-1 items-center gap-[6px] rounded-base bg-soft px-[8px] py-[4px] outline-1 -outline-offset-1 outline-line-strong">
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">{url}</span>
      </div>
    </div>
  )
}

// ── Main BrowserPanel ─────────────────────────────────────────────────────────

export interface BrowserPanelProps {
  onClose: () => void
}

const DEMO_URL = 'console.saqa.id/auth/passkeys'

export function BrowserPanel({ onClose }: BrowserPanelProps) {
  const [takenOver, setTakenOver] = useState(false)

  return (
    <div
      className="relative flex min-h-0 w-[380px] shrink-0 flex-col border-l border-line-strong bg-surface"
      aria-label="Agent browser"
      data-testid="browser-panel"
    >
      {/* Takeover warning banner (ocar6) */}
      {takenOver && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-[8px] bg-warn px-[14px] py-[7px] text-[12.5px] font-medium text-white"
        >
          <span className="flex-1">You&rsquo;re controlling this tab — Dev won&rsquo;t click or type</span>
        </div>
      )}

      {/* Panel header */}
      <div className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
        {/* Tab strip — one tab */}
        <div className="flex flex-1 items-center gap-[6px]">
          <div className="flex items-center gap-[5px] rounded-sm bg-soft px-[8px] py-[4px] outline-1 -outline-offset-1 outline-line-strong">
            <span className="text-[12px] font-medium text-ink">Auth console · Passkeys</span>
          </div>
        </div>
        <IconButton icon={X} aria-label="Close browser panel" onClick={onClose} />
      </div>

      {/* Browser chrome */}
      <BrowserChrome url={DEMO_URL} />

      {/* Faux page content */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#F8F8F8] px-[20px] py-[16px]">
        <div className="mb-[4px] text-[11px] font-medium uppercase tracking-[0.55px] text-muted">Authentication</div>
        <h2 className="m-0 mb-[4px] text-[20px] font-semibold text-ink">Passkeys</h2>
        <p className="m-0 mb-[16px] text-[13px] text-muted">
          Let people sign in with Face ID, Touch ID or a security key.
        </p>

        <div className="flex flex-col gap-[12px]">
          {[
            { label: 'Enable passkeys', sub: 'Show "Sign in with passkey" on the login page', on: true },
            { label: 'Staged rollout', sub: 'Start with 10% of Engineering, then everyone', on: true },
            { label: 'Require on new devices', sub: 'Ask for a passkey when a device is unknown', on: false },
          ].map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-[12px] rounded-md bg-white px-[14px] py-[10px] outline-1 -outline-offset-1 outline-line-strong">
              <div className="flex flex-col gap-[2px]">
                <span className="text-[13px] font-medium text-ink">{row.label}</span>
                <span className="text-[12px] text-muted">{row.sub}</span>
              </div>
              {/* Faux toggle — pointer-events-none, presentation only */}
              <div
                aria-hidden
                className={`mt-[2px] flex h-[20px] w-[36px] shrink-0 rounded-full px-[2px] items-center ${row.on ? 'justify-end bg-primary' : 'justify-start bg-line-strong'}`}
              >
                <div className="size-[16px] rounded-full bg-white shadow-sm" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Status / control bar */}
      <div className="flex h-[40px] shrink-0 items-center gap-[8px] border-t border-line px-[14px]">
        {takenOver ? (
          <>
            <span className="flex-1 text-[12.5px] text-ok">You&rsquo;re in control · Dev is watching</span>
            <button
              type="button"
              onClick={() => setTakenOver(false)}
              className="inline-flex items-center gap-[5px] rounded-btn bg-primary px-[10px] py-[4px] text-[12px] font-medium text-primary-ink transition-colors hover:bg-primary-hover"
            >
              Hand back to Dev
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 text-[12.5px] text-muted">Dev turned on passkeys · checking the login page next</span>
            <button
              type="button"
              onClick={() => setTakenOver(true)}
              className="inline-flex items-center gap-[5px] rounded-btn px-[10px] py-[4px] text-[12px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
            >
              Take over
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-[5px] rounded-btn bg-primary px-[10px] py-[4px] text-[12px] font-medium text-primary-ink transition-colors hover:bg-primary-hover"
            >
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  )
}
