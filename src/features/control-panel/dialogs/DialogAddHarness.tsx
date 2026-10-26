import { useState } from 'react'
import { Check, ExternalLink, Shield } from 'lucide-react'
import { Modal } from '../legacyShared'
import { Button } from '../../../ui/ds/Button'
import { HARNESSES } from '../harnesses'
import type { HarnessId } from '../harnesses'

interface Props {
  onClose: () => void
}

/**
 * Add an account to the shared pool. The pool holds coding-assistant
 * *subscriptions* (Claude Code, Codex, Copilot, …) rather than per-token API
 * keys — pick a harness, then sign in to add a seat agents can share.
 */
export function DialogAddHarness({ onClose }: Props) {
  const [selected, setSelected] = useState<HarnessId>('claude-code')
  const picked = HARNESSES.find((h) => h.id === selected)!

  return (
    <Modal
      title="Add an account to the pool"
      subtitle="Pool a coding-assistant subscription. Agents share every account and move to the next one when a limit is hit."
      width={440}
      onClose={onClose}
      footer={
        <>
          <span className="flex flex-1 items-center gap-[6px] text-[12px] text-muted">
            <Shield size={13} aria-hidden /> We never see your password.
          </span>
          <Button variant="secondary" height={30} onClick={onClose}>Cancel</Button>
          <Button variant="primary" height={30} icon={ExternalLink}>Sign in with {picked.name}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-[16px]">
        <div>
          <p className="mb-[8px] text-[12px] font-medium text-muted">Harness</p>
          <div className="flex flex-col gap-[6px]">
            {HARNESSES.map((h) => {
              const on = h.id === selected
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setSelected(h.id)}
                  aria-pressed={on}
                  className={`flex items-center gap-[12px] rounded-lg px-[12px] py-[10px] text-left transition-colors outline-1 -outline-offset-1 ${
                    on ? 'bg-soft outline-ink' : 'bg-surface outline-line-strong hover:bg-hover'
                  }`}
                >
                  <span className="flex size-[32px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
                    <h.icon size={16} className="text-ink-2" aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="text-[13px] font-medium text-ink">{h.name}</span>
                    <span className="text-[12px] text-muted">{h.blurb}</span>
                  </span>
                  {on && <Check size={16} className="shrink-0 text-ink" aria-hidden />}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-[6px] rounded-lg bg-soft px-[12px] py-[10px]">
          <p className="text-[12.5px] font-medium text-ink">How pooling works</p>
          <p className="text-[12px] text-muted">
            A browser window opens to sign in with {picked.name}. The account joins the pool and runs
            jobs alongside the others — if it hits its rate-limit window, the next ready account takes over.
          </p>
        </div>
      </div>
    </Modal>
  )
}
