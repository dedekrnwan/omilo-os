import { Mic, Paperclip, ArrowUp, SkipForward, Clock, Check, Pencil } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { COMPANY_NAME, KNOWLEDGE_NOTES } from './data'

interface StepKnowYouProps {
  onNext: () => void
}

/** Static snapshot of the "Get to know you" conversation — Topic 3 of 7: Goals */
export function StepKnowYou({ onNext }: StepKnowYouProps) {
  const topicIndex = 2 // 0-based; Goals is #3

  const completedNotes = [
    { id: 'company', label: 'Company', snippet: 'Community app for RT/RW neighbourhoods in Jabodetabek, 2 founders, 3 developers.' },
    { id: 'customers', label: 'Customers', snippet: 'RT heads and residents. Each neighbourhood pays monthly.' },
  ]

  const currentNote = { id: 'goals', label: 'Goals', status: 'writing' }

  const upcomingNotes = [
    { id: 'offer', label: 'Offer', meta: 'Next: what you sell and for how much' },
    { id: 'rules', label: 'Rules' },
    { id: 'systems', label: 'Systems' },
    { id: 'voice', label: 'Voice' },
  ]

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Main chat area */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Progress bar header */}
        <div
          className="flex h-[40px] shrink-0 items-center gap-[16px] px-[24px]"
          style={{ borderBottom: '1px solid var(--color-line-strong)' }}
        >
          <span className="text-[12.5px] font-medium text-ink">
            Topic {topicIndex + 1} of {KNOWLEDGE_NOTES.length} · Goals
          </span>
          {/* Progress bar */}
          <div
            className="h-[3px] w-[80px] rounded-pill overflow-hidden"
            style={{ background: 'var(--color-line-strong)' }}
          >
            <div
              className="h-full rounded-pill"
              style={{
                width: `${((topicIndex) / KNOWLEDGE_NOTES.length) * 100}%`,
                background: 'var(--color-helper-brand)',
              }}
            />
          </div>
          <span className="text-[12px] text-muted">~6 min left</span>
          <div className="flex-1" />
          <button
            type="button"
            className="flex items-center gap-[5px] text-[12px] text-muted hover:text-ink transition-colors"
          >
            <SkipForward size={12} aria-hidden />
            Skip this topic
          </button>
          <button
            type="button"
            className="flex items-center gap-[5px] text-[12px] text-muted hover:text-ink transition-colors"
          >
            <Clock size={12} aria-hidden />
            Finish later
          </button>
        </div>

        {/* Conversation */}
        <div className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto px-[32px] py-[24px]">
          {/* Context line */}
          <div className="flex items-center gap-[6px]">
            <Check size={12} className="text-ok" />
            <span className="text-[12px] text-muted">Company and Customers covered · 9 answers</span>
          </div>

          {/* Chief question */}
          <div className="flex items-start gap-[10px]">
            <Mascot size={28} radius={8} area="brand" />
            <div className="flex flex-col gap-[10px]">
              <p className="m-0 text-[14px] font-medium text-ink">
                What would make the next 3 months a win for {COMPANY_NAME}?
              </p>
              {/* Suggestion chips */}
              <div className="flex flex-wrap gap-[6px]">
                {[
                  '100 paying neighbourhoods',
                  'Launch the WhatsApp sign-up',
                  'Fewer support chats',
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="flex items-center gap-[4px] rounded-pill px-[10px] py-[5px] text-[12px] text-ink transition-colors"
                    style={{ border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)' }}
                  >
                    <span style={{ color: 'var(--color-helper-brand)' }}>↗</span>
                    {chip}
                  </button>
                ))}
              </div>
              <p className="m-0 text-[12px] text-muted">
                Not sure? Pick one to start, or say &quot;give me ideas&quot;
              </p>
            </div>
          </div>

          {/* User reply */}
          <div className="flex flex-col items-end gap-[0]">
            <div
              className="max-w-[480px] rounded-lg px-[14px] py-[10px] text-[13.5px] leading-[1.5] text-ink"
              style={{ background: 'var(--color-field-indigo)' }}
            >
              100 paying neighbourhoods using the app by December. And I want fewer manual support
              chats, they eat my whole day.
            </div>
          </div>

          {/* Chief follow-up */}
          <div className="flex items-start gap-[10px]">
            <Mascot size={28} radius={8} area="brand" />
            <div className="flex flex-col gap-[10px]">
              <p className="m-0 text-[14px] font-medium text-ink">
                Got it, two goals. How do you count a &quot;paying neighbourhood&quot; today?
              </p>
              <div className="flex flex-wrap gap-[6px]">
                {[
                  'An RT that paid this month',
                  'Any RT with an active admin',
                  "I don't track it yet",
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="flex items-center gap-[4px] rounded-pill px-[10px] py-[5px] text-[12px] text-ink transition-colors"
                    style={{ border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)' }}
                  >
                    <span style={{ color: 'var(--color-helper-brand)' }}>↗</span>
                    {chip}
                  </button>
                ))}
              </div>
              <div
                className="flex items-center gap-[6px] rounded-base px-[10px] py-[5px] text-[12px] text-ok"
                style={{ background: 'var(--color-ok-tint)', border: '1px solid var(--color-ok-line)' }}
              >
                <Check size={11} />
                Saved to Goals: 100 paying neighbourhoods by Dec · fewer support chats
              </div>
            </div>
          </div>
        </div>

        {/* Composer */}
        <div
          className="flex shrink-0 flex-col gap-[8px] px-[32px] pb-[16px] pt-[10px]"
          style={{ borderTop: '1px solid var(--color-line-strong)' }}
        >
          <div
            className="flex min-h-[42px] items-center gap-[8px] rounded-lg px-[14px] py-[10px]"
            style={{ border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)' }}
          >
            <span className="flex-1 text-[13px] text-muted">
              Type your answer, or hold space to talk…
            </span>
            <button
              type="button"
              className="flex size-[28px] shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover"
            >
              <Mic size={14} aria-hidden />
            </button>
            <button
              type="button"
              onClick={onNext}
              className="flex size-[28px] shrink-0 items-center justify-center rounded-md text-primary-ink transition-colors hover:bg-primary-hover"
              style={{ background: 'var(--color-primary)' }}
            >
              <ArrowUp size={14} aria-hidden />
            </button>
          </div>

          {/* URL skip input */}
          <div className="flex items-center gap-[6px]">
            <span className="text-[12px] text-muted">Skip questions: let me read your website or a doc first.</span>
            <div
              className="flex flex-1 items-center gap-[6px] rounded-base px-[10px] py-[5px]"
              style={{ border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)' }}
            >
              <span className="text-[12px] text-muted">sahabatbisa.id</span>
            </div>
            <button type="button" className="shrink-0 text-muted hover:text-ink transition-colors">
              <Paperclip size={14} aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {/* Right panel — What I've learned */}
      <div
        className="flex w-[280px] shrink-0 flex-col gap-[16px] overflow-y-auto px-[20px] py-[24px]"
        style={{ borderLeft: '1px solid var(--color-line-strong)' }}
      >
        <div className="flex items-center justify-between">
          <p className="m-0 text-[12px] font-semibold text-ink">What I&apos;ve learned</p>
          <span className="text-[12px] text-muted">2 of 7 done</span>
        </div>

        {/* Completed */}
        {completedNotes.map((note) => (
          <div
            key={note.id}
            className="flex flex-col gap-[4px] rounded-base p-[10px]"
            style={{ border: '1px solid var(--color-line-strong)', background: 'var(--color-surface)' }}
          >
            <div className="flex items-center gap-[6px]">
              <Check size={12} className="text-ok shrink-0" />
              <span className="flex-1 text-[12.5px] font-medium text-ink">{note.label}</span>
              <Pencil size={11} className="text-muted cursor-pointer hover:text-ink" />
            </div>
            <p className="m-0 pl-[18px] text-[11.5px] leading-[1.45] text-muted">{note.snippet}</p>
          </div>
        ))}

        {/* Writing */}
        <div
          className="flex items-center gap-[6px] rounded-base p-[10px]"
          style={{
            border: '1px solid var(--color-helper-brand)',
            background: 'var(--color-field-indigo)',
          }}
        >
          <div
            className="size-[10px] shrink-0 rounded-full animate-pulse"
            style={{ background: 'var(--color-helper-brand)' }}
          />
          <span className="text-[12.5px] font-medium text-ink">{currentNote.label}</span>
          <span className="ml-auto text-[11px] text-muted">writing…</span>
        </div>

        {/* Upcoming */}
        {upcomingNotes.map((note) => (
          <div key={note.id} className="flex flex-col gap-[2px] px-[2px]">
            <div className="flex items-center gap-[6px]">
              <div
                className="size-[10px] shrink-0 rounded-full"
                style={{ border: '1.5px solid var(--color-line-strong)' }}
              />
              <span className="text-[12.5px] text-muted">{note.label}</span>
            </div>
            {note.meta && (
              <p className="m-0 pl-[16px] text-[11.5px] leading-[1.4] text-faint">{note.meta}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
