import { Edit, Maximize2 } from 'lucide-react'
import type { HelperRecord } from '../teamData'

interface PlaybookTabProps {
  helper: HelperRecord
}

// Sample playbook content for Support
const PLAYBOOK_CONTENT = `## Dues questions

When a resident asks how much they owe:

1. Look up their unit in sahabat-db — never guess the amount.
2. Reply with the balance and the last payment date.
3. Offer the payment link. If they say they already paid, check Midtrans before answering.

## Letter requests (surat pengantar)

- Ask for full name, unit and purpose in one message.
- Fill the RT letter form and send it to the RT head for signing.

**Support added this from chat #12** Keep Undo

If the RT head is away, send the letter to the deputy (Pak Budi) instead and tell the resident.

## Always hand to the owner

- Disputes about money or fines
- Complaints about an RT head
- Anything legal`

export function PlaybookTab({ helper }: PlaybookTabProps) {
  const playbook = helper.workingFiles.find((f) => f.name === 'PLAYBOOK.md')

  if (!playbook) {
    return (
      <div className="flex flex-col items-center gap-[8px] py-[48px] text-center">
        <p className="m-0 text-[13px] text-muted">No playbook yet.</p>
        <p className="m-0 text-[12px] text-faint">
          {helper.name} learns from chats and the owner adds rules over time.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {/* File header */}
      <div className="flex items-center justify-between rounded-md bg-soft px-[12px] py-[8px] outline-1 -outline-offset-1 outline-line-strong">
        <div className="flex items-center gap-[8px]">
          <span className="text-[14px]">☰</span>
          <div>
            <div className="text-[12.5px] font-medium text-ink">{playbook.name}</div>
            <div className="text-[11px] text-faint">
              {helper.name} · Step-by-step answers for common cases
            </div>
          </div>
        </div>
        <div className="flex gap-[2px]">
          <button type="button" className="h-[24px] rounded-sm px-[8px] text-[12px] font-medium text-link hover:bg-hover transition-colors">
            View
          </button>
          <button type="button" className="h-[24px] rounded-sm px-[8px] text-[12px] text-muted hover:bg-hover transition-colors">
            Edit
          </button>
          <button type="button" className="h-[24px] rounded-sm px-[8px] text-[12px] text-muted hover:bg-hover transition-colors">
            History 7
          </button>
        </div>
        <span className="text-[11px] text-faint">Updated by {helper.name} · 2 days ago</span>
      </div>

      {/* Content */}
      <div className="rounded-md bg-surface px-[16px] py-[12px] outline-1 -outline-offset-1 outline-line-strong">
        <div className="prose prose-sm max-w-none text-[13px] text-ink leading-relaxed">
          {PLAYBOOK_CONTENT.split('\n').map((line, i) => {
            if (line.startsWith('## ')) {
              return <h2 key={i} className="mt-[16px] mb-[8px] text-[14px] font-semibold text-ink first:mt-0">{line.slice(3)}</h2>
            }
            if (line.startsWith('- ')) {
              return <p key={i} className="m-0 ml-[12px] text-[12.5px] text-ink-2">• {line.slice(2)}</p>
            }
            if (line.startsWith('**Support added')) {
              return (
                <div key={i} className="my-[8px] flex items-center gap-[8px] rounded-md bg-ok-tint px-[10px] py-[6px] outline-1 -outline-offset-1 outline-ok-line text-[12px] text-ok">
                  <span className="flex-1">{line.replace(/\*\*/g, '')}</span>
                  <button type="button" className="font-medium text-ok">Keep</button>
                  <button type="button" className="text-muted">Undo</button>
                </div>
              )
            }
            if (/^\d+\./.test(line)) {
              return <p key={i} className="m-0 ml-[4px] text-[12.5px] text-ink-2">{line}</p>
            }
            if (line === '') {
              return <div key={i} className="h-[6px]" />
            }
            return <p key={i} className="m-0 text-[12.5px] text-ink-2">{line}</p>
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <button type="button" className="flex items-center gap-[4px] text-[12px] text-link hover:underline">
          <Maximize2 size={12} aria-hidden />
          Open in Docs
        </button>
        <div className="flex items-center gap-[4px] text-[11.5px] text-faint">
          <span>Your edits will also see {helper.name}</span>
          <button type="button" className="flex items-center gap-[4px] rounded-md bg-primary text-primary-ink px-[8px] py-[3px] text-[12px] font-medium hover:bg-primary-hover transition-colors">
            <Edit size={11} aria-hidden />
            Edit
          </button>
        </div>
      </div>
    </div>
  )
}
