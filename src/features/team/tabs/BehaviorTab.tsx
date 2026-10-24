import { ChevronDown, Plus } from 'lucide-react'
import type { HelperRecord } from '../teamData'

type BehaviorMode = 'Ask first' | 'Act, then report' | 'Fully on its own'

const BEHAVIOR_MODES: { id: BehaviorMode; label: string; desc: string }[] = [
  { id: 'Ask first', label: 'Ask first', desc: 'Drafts every reply, you send it' },
  { id: 'Act, then report', label: 'Act, then report', desc: 'Replies itself, tells you what it did' },
  { id: 'Fully on its own', label: 'Fully on its own', desc: 'Only pings you when stuck' },
]

interface BehaviorTabProps {
  helper: HelperRecord
}

export function BehaviorTab({ helper }: BehaviorTabProps) {
  return (
    <div className="flex flex-col gap-[24px]">
      {/* Autonomy */}
      <section>
        <h3 className="m-0 text-[13px] font-medium text-ink mb-[2px]">
          How much {helper.name} does on its own
        </h3>
        <div className="mt-[10px] flex gap-[8px]">
          {BEHAVIOR_MODES.map((mode) => {
            const active = helper.behaviorMode === mode.id
            return (
              <div
                key={mode.id}
                className={`flex-1 rounded-lg p-[12px] outline-2 -outline-offset-1 transition-all ${
                  active
                    ? 'outline-primary bg-surface shadow-[0_1px_4px_#0C0A091F]'
                    : 'outline-line-strong bg-soft'
                }`}
              >
                <div className="flex items-center gap-[6px] mb-[4px]">
                  {active && <span className="text-[14px]">🎙</span>}
                  <span className={`text-[12.5px] font-medium ${active ? 'text-ink' : 'text-muted'}`}>
                    {mode.label}
                  </span>
                </div>
                <p className={`m-0 text-[11.5px] ${active ? 'text-muted' : 'text-faint'}`}>{mode.desc}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Limits */}
      <section>
        <div className="flex items-center gap-[8px] mb-[12px]">
          <h3 className="m-0 text-[13px] font-medium text-ink">Limits</h3>
          <span className="text-[12px] text-muted">On top of the company's Safety &amp; limits</span>
        </div>
        <div className="flex flex-col divide-y divide-line">
          <div className="flex items-center justify-between py-[10px]">
            <div>
              <div className="text-[13px] text-ink">Spend per task</div>
              <div className="text-[11.5px] text-muted">Pauses and asks above this.</div>
            </div>
            <div className="flex items-center gap-[6px] rounded-md bg-soft px-[10px] py-[6px] outline-1 -outline-offset-1 outline-line-strong">
              <span className="text-[12px] text-muted">💰</span>
              <span className="text-[12.5px] text-ink">{helper.spendLimit}</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-[10px]">
            <div>
              <div className="text-[13px] text-ink">Messages per hour</div>
              <div className="text-[11.5px] text-muted">Stops a runaway loop on WhatsApp.</div>
            </div>
            <div className="flex items-center gap-[6px] rounded-md bg-soft px-[10px] py-[6px] outline-1 -outline-offset-1 outline-line-strong">
              <span className="text-[12px] text-muted">⏱</span>
              <span className="text-[12.5px] text-ink">{helper.messagesPerHour}</span>
            </div>
          </div>
          <div className="flex items-start justify-between py-[10px]">
            <div>
              <div className="text-[13px] text-ink">Never discuss</div>
              <div className="text-[11.5px] text-muted">Topics {helper.name} always hands to you.</div>
            </div>
            <div className="flex flex-wrap justify-end gap-[4px] max-w-[240px]">
              {helper.neverDiscuss.map((topic) => (
                <span
                  key={topic}
                  className="h-[22px] inline-flex items-center rounded-pill bg-soft px-[8px] text-[11.5px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong"
                >
                  {topic}
                </span>
              ))}
              <button
                type="button"
                className="flex h-[22px] items-center gap-[2px] rounded-pill bg-soft px-[6px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors"
              >
                <Plus size={11} aria-hidden />
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between py-[10px]">
            <div>
              <div className="text-[13px] text-ink">Work hours</div>
              <div className="text-[11.5px] text-muted">Uses the company hours: {helper.workHours}.</div>
            </div>
            <div className="flex items-center gap-[4px]">
              <span className="text-[12px] text-muted">Override</span>
              {/* Toggle off */}
              <div className="relative h-[18px] w-[30px] rounded-full bg-line-strong" aria-hidden>
                <span className="absolute top-[2px] left-[2px] size-[14px] rounded-full bg-surface shadow-sm" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* When stuck */}
      <section>
        <h3 className="m-0 text-[13px] font-medium text-ink mb-[12px]">
          When {helper.name} is stuck
        </h3>
        <div className="flex flex-col divide-y divide-line">
          <div className="flex items-center justify-between py-[10px]">
            <div>
              <div className="text-[13px] text-ink">Hand off to</div>
              <div className="text-[11.5px] text-muted">Gets the chat and a short summary.</div>
            </div>
            <button
              type="button"
              className="flex items-center gap-[6px] rounded-md bg-soft px-[10px] py-[6px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
            >
              <span className="size-[16px] rounded-full bg-[#D6D3D1] text-[10px] font-semibold text-ink-2 inline-flex items-center justify-center">
                D
              </span>
              {helper.handOffTo}
              <ChevronDown size={12} aria-hidden className="text-muted" />
            </button>
          </div>
          <div className="flex items-center justify-between py-[10px]">
            <div>
              <div className="text-[13px] text-ink">Language</div>
              <div className="text-[11.5px] text-muted">Replies in the resident's language if it can.</div>
            </div>
            <button
              type="button"
              className="flex items-center gap-[6px] rounded-md bg-soft px-[10px] py-[6px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
            >
              <span className="text-[14px]">🌐</span>
              {helper.language}
              <ChevronDown size={12} aria-hidden className="text-muted" />
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
