import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Wallet, X } from 'lucide-react'
import { IconButton } from '../../ui/ds/Button'
import { Mascot } from '../../ui/ds/Mascot'
import type { HelperStat } from './data'
import { BigButton, Switch } from './parts'

const QUICK = [10, 15, 25, 50]
const THRESHOLDS = ['50%', '80%', '90%']

function runsOut(name: string) {
  return [
    { id: 'pause', t: 'Pause and ask me', d: `${name} finishes the current reply, then waits for you in Inbox.` },
    { id: 'keep', t: 'Keep going, just tell me', d: 'Spending continues. You get a notification.' },
    { id: 'stop', t: 'Stop right away', d: 'Even mid-reply. Customers may see a half answer.' },
  ]
}

/** pen b10Wfq · Set budget — right-hand drawer (480 wide, inset 8) over a scrim. */
export function BudgetDrawer({ helper, onClose }: { helper: HelperStat | null; onClose: () => void }) {
  return (
    <Dialog.Root open={!!helper} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#0C0A0926]" />
        {helper && <DrawerBody helper={helper} onClose={onClose} />}
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DrawerBody({ helper, onClose }: { helper: HelperStat; onClose: () => void }) {
  const suggested = helper.budget?.limit ?? 15
  const [amount, setAmount] = useState(String(suggested))
  const [threshold, setThreshold] = useState('80%')
  const [mode, setMode] = useState('pause')
  const [askBig, setAskBig] = useState(true)
  return (
    <Dialog.Content
      aria-describedby={undefined}
      onOpenAutoFocus={(e) => e.preventDefault()}
      className="fixed top-[8px] right-[8px] bottom-[8px] z-50 flex w-[480px] flex-col overflow-hidden rounded-lg bg-surface shadow-[-8px_0_48px_#1C19173D] outline-1 -outline-offset-1 outline-line-strong focus:outline-none"
    >
      <header className="flex w-full items-center gap-[12px] pt-[18px] pr-[16px] pb-[16px] pl-[20px] shadow-[inset_0_-1px_0_var(--color-line)]">
        <Mascot helper area={helper.area} size={40} radius={11} />
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <Dialog.Title className="m-0 text-[16px] font-semibold text-ink">Budget for {helper.name}</Dialog.Title>
          <span className="text-[12px] text-muted">{helper.spend} spent this month · resets Nov 1</span>
        </div>
        <Dialog.Close asChild>
          <IconButton icon={X} aria-label="Close" />
        </Dialog.Close>
      </header>

      <div className="flex min-h-0 w-full flex-1 flex-col gap-[20px] overflow-y-auto p-[20px]">
        <div className="flex w-full flex-col gap-[8px]">
          <label className="flex w-full flex-col gap-[6px]">
            <span className="text-[13px] font-medium text-ink-2">Monthly budget</span>
            <input
              value={`$${amount}`}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="h-[36px] w-full rounded-base bg-surface px-[10px] text-[14px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-ink"
            />
            <span className="text-[12.5px] text-muted">
              Last 3 months {helper.name} spent $4–$9. We suggest $15.
            </span>
          </label>
          <div className="flex gap-[6px]">
            {QUICK.map((q) => {
              const on = String(q) === amount
              return (
                <button
                  key={q}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setAmount(String(q))}
                  className={`flex h-[28px] items-center rounded-pill px-[12px] font-mono text-[12px] outline-1 -outline-offset-1 ${
                    on ? 'bg-ink text-primary-ink outline-ink' : 'bg-surface text-ink-2 outline-line-strong hover:bg-soft'
                  }`}
                >
                  ${q}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex w-full flex-col gap-[8px]">
          <span className="text-[13px] font-medium text-ink-2">Tell me when it reaches</span>
          <div role="radiogroup" className="flex gap-[2px] self-start rounded-base bg-soft p-[2px] outline-1 -outline-offset-1 outline-line">
            {THRESHOLDS.map((t) => {
              const on = t === threshold
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setThreshold(t)}
                  className={`flex h-[28px] items-center rounded-sm px-[10px] text-[12px] font-medium ${
                    on ? 'bg-surface text-ink shadow-[0_1px_2px_#00000014]' : 'text-muted'
                  }`}
                >
                  {t}
                </button>
              )
            })}
          </div>
        </div>

        <div role="radiogroup" aria-label="When the budget runs out" className="flex w-full flex-col gap-[8px]">
          <span className="text-[13px] font-medium text-ink-2">When the budget runs out</span>
          {runsOut(helper.name).map((o) => {
            const on = o.id === mode
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMode(o.id)}
                className={`flex w-full gap-[12px] rounded-md px-[14px] py-[12px] text-left ${
                  on ? 'outline-2 -outline-offset-2 outline-ink' : 'outline-1 -outline-offset-1 outline-line-strong hover:bg-soft'
                }`}
              >
                {on ? (
                  <span className="flex size-[16px] shrink-0 items-center justify-center rounded-full bg-primary">
                    <span className="size-[6px] rounded-full bg-primary-ink" />
                  </span>
                ) : (
                  <span className="size-[16px] shrink-0 rounded-full bg-surface outline-1 -outline-offset-1 outline-faint" />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="text-[13px] font-semibold text-ink">{o.t}</span>
                  <span className="text-[12px] text-muted">{o.d}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex w-full gap-[12px] py-[12px] shadow-[inset_0_-1px_0_var(--color-line)]">
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[13.5px] font-medium text-ink">Ask before any single job over $1</span>
            <span className="text-[12.5px] leading-[1.5] text-muted">
              Catches runaway jobs early, like a long research task.
            </span>
          </div>
          <Switch on={askBig} label="Ask before any single job over $1" onChange={setAskBig} />
        </div>
      </div>

      <footer className="flex w-full items-center gap-[8px] bg-soft px-[20px] py-[14px] shadow-[inset_0_1px_0_var(--color-line)]">
        <BigButton kind="quiet" onClick={onClose}>
          Remove budget
        </BigButton>
        <div className="h-px min-w-0 flex-1" />
        <BigButton kind="secondary" onClick={onClose}>
          Cancel
        </BigButton>
        <BigButton kind="primary" onClick={onClose}>
          Save budget
        </BigButton>
      </footer>
    </Dialog.Content>
  )
}

/** pen `Toast/Decision` (qcZzz) as used in EIxIX · Budget reached. */
export function BudgetToast({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <div
      role="status"
      className="fixed right-[24px] bottom-[24px] z-30 flex w-[360px] gap-[10px] rounded-lg bg-surface py-[12px] pr-[8px] pl-[14px] shadow-[0_10px_24px_#0C0A0929] outline-1 -outline-offset-1 outline-line-strong"
    >
      <Wallet size={18} aria-hidden className="shrink-0 text-warn" />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[14px] font-medium text-ink">{title}</span>
        <span className="text-[13px] leading-[1.45] text-muted">{body}</span>
      </div>
      <IconButton icon={X} size={14} aria-label="Dismiss" onClick={onClose} />
    </div>
  )
}
