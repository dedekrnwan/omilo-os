import { ArrowRight, Building2, Users, Target, Tag, Shield, LayoutGrid, Mic } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { Button } from '../../ui/ds/Button'
import { COMPANY_NAME, KNOWLEDGE_NOTES } from './data'
import type { LucideIcon } from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  'building-2': Building2,
  'users': Users,
  'target': Target,
  'tag': Tag,
  'shield': Shield,
  'layout-grid': LayoutGrid,
  'mic': Mic,
}

interface StepWelcomeProps {
  onNext: () => void
}

export function StepWelcome({ onNext }: StepWelcomeProps) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Left panel */}
      <div className="flex min-h-0 flex-1 flex-col justify-center px-[60px]">
        <div className="flex max-w-[420px] flex-col gap-[28px]">
          {/* Mascots cluster */}
          <div className="flex items-end gap-[-4px]" style={{ gap: 0 }}>
            <div style={{ marginRight: -8 }}>
              <Mascot size={52} area="brand" radius={14} />
            </div>
            <div style={{ marginRight: -8, marginBottom: 4 }}>
              <Mascot size={44} area="marketing" radius={12} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <Mascot size={36} area="dev" radius={10} />
            </div>
            <div style={{ marginLeft: 4 }}>
              <Mascot size={28} area="support" radius={8} />
            </div>
          </div>

          {/* Heading */}
          <div className="flex flex-col gap-[14px]">
            <h1
              className="m-0 font-display text-[36px] font-semibold leading-tight tracking-[-0.5px] text-ink"
              style={{ fontVariationSettings: '"opsz" 96' }}
            >
              Let&apos;s build your AI team
            </h1>
            <p className="m-0 text-[14px] leading-[1.55] text-muted">
              I&apos;m Chief of Staff. I&apos;ll ask about {COMPANY_NAME} the way a good advisor
              would: one question at a time, with ideas when you&apos;re not sure. Then I&apos;ll
              suggest a team that fits.
            </p>
          </div>

          {/* Steps list */}
          <ol className="m-0 flex flex-col gap-[10px] list-none p-0">
            {[
              { n: 1, label: 'Connect the AI you already have', time: '1 min' },
              { n: 2, label: 'Talk about your business', time: '~10 min' },
              { n: 3, label: 'Meet your team and approve their jobs', time: '2 min' },
            ].map((item) => (
              <li key={item.n} className="flex items-center gap-[10px]">
                <span className="text-[13.5px] text-muted">{item.n}</span>
                <span className="flex-1 text-[13.5px] text-ink">{item.label}</span>
                <span className="text-[12px] text-muted">{item.time}</span>
              </li>
            ))}
          </ol>

          {/* CTA */}
          <div className="flex items-center gap-[14px]">
            <Button variant="primary" height={30} icon={ArrowRight} onClick={onNext}>
              Let&apos;s start
            </Button>
            <span className="text-[12px] text-muted">You can stop anytime and pick up later.</span>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div
        className="flex w-[320px] shrink-0 flex-col gap-[18px] overflow-y-auto px-[28px] py-[32px]"
        style={{ borderLeft: '1px solid var(--color-line-strong)' }}
      >
        <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
          What your team will know
        </p>
        <p className="m-0 text-[12.5px] leading-[1.5] text-ink-2">
          Everything you tell me becomes 7 short notes. Helpers read them before every job, and you
          can edit them anytime in Company.
        </p>

        <div className="flex flex-col gap-[2px]">
          {KNOWLEDGE_NOTES.map((note) => {
            const Icon = ICON_MAP[note.icon] ?? Building2
            return (
              <div
                key={note.label}
                className="flex items-center gap-[8px] rounded-base px-[8px] py-[7px]"
              >
                <Icon size={14} className="shrink-0 text-muted" aria-hidden />
                <span className="text-[13px] font-medium text-ink">{note.label}</span>
                <span className="text-[12px] text-muted">{note.meta}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
