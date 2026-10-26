/**
 * Send feedback dialog (pen `Send feedback`). Opened from the profile menu.
 * Idea / Bug / Praise, a note, and two opt-ins. Mock-only — submitting toasts.
 */

import { useState } from 'react'
import { Bug, Check, Lightbulb, HeartHandshake, Send } from 'lucide-react'
import { Dialog } from './Dialog'
import { Button } from './Button'
import { notify } from './Toaster'

const KINDS = [
  { id: 'idea', label: 'Idea', icon: Lightbulb },
  { id: 'bug', label: 'Bug', icon: Bug },
  { id: 'praise', label: 'Praise', icon: HeartHandshake },
] as const

function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" onClick={onChange} className="flex items-center gap-[8px] text-left">
      <span
        className={`flex size-[16px] shrink-0 items-center justify-center rounded-sm border transition-colors ${
          checked ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface'
        }`}
      >
        {checked && <Check size={11} strokeWidth={3} aria-hidden />}
      </span>
      <span className="text-[13px] text-ink-2">{label}</span>
    </button>
  )
}

export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('idea')
  const [text, setText] = useState('')
  const [screenshot, setScreenshot] = useState(true)
  const [contact, setContact] = useState(true)

  function submit() {
    notify('Thanks for the feedback!')
    setText('')
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Send feedback"
      subtitle="Goes straight to the Omilo team. We read every one."
      width={480}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="secondary" style={{ height: 32 }} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={Send} style={{ height: 32 }} onClick={submit}>
            Send feedback
          </Button>
        </>
      }
    >
      <div className="flex gap-[6px]">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            className={`inline-flex h-[32px] items-center gap-[6px] rounded-btn px-[12px] text-[12.5px] font-medium outline-1 -outline-offset-1 transition-colors ${
              kind === k.id ? 'bg-surface text-ink outline-ink' : 'bg-surface text-muted outline-line-strong hover:bg-soft'
            }`}
          >
            <k.icon size={13} aria-hidden />
            {k.label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-[6px]">
        <span className="text-[13px] font-medium text-ink-2">What’s on your mind?</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Tell us what would make Omilo better…"
          className="w-full resize-none rounded-base bg-surface px-[10px] py-[9px] text-[13px] leading-[1.5] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary placeholder:text-faint"
        />
      </label>

      <CheckRow checked={screenshot} onChange={() => setScreenshot((v) => !v)} label="Attach a screenshot of this page" />
      <CheckRow checked={contact} onChange={() => setContact((v) => !v)} label="You can contact me about this" />
    </Dialog>
  )
}
