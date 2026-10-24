import { ArrowLeft, Edit, ExternalLink } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane } from '../ControlPanelShared'

const HANDBOOK_FILES = [
  { name: 'COMPANY.md', desc: 'Who we are, who we serve and the 64 RTs we cover—' },
  { name: 'SERVICES.md', desc: 'Dues, defect and bookings — what each costs and takes.' },
  { name: 'POLICIES.md', desc: 'Refunds, resident data, and what needs an owner\'s OK.', badge: '1 suggested edit' },
  { name: 'VOICE.md', desc: 'How we talk to residents and RT heads.' },
  { name: 'FAQ.md', desc: 'What residents ask every week, answered once.', badge: '3 new from Support' },
  { name: 'PEOPLE.md', desc: 'Who does what, and who to call after hours.' },
]

const AVATARS = [
  { color: '#6366F1', label: 'Chief' },
  { color: '#0EA5E9', label: 'Ops' },
  { color: '#14B8A6', label: 'Dev' },
  { color: '#EC4899', label: 'Support' },
  { color: '#65A30D', label: 'Finance' },
  { color: '#F97316', label: 'Marketing' },
]

function AvatarStack({ items }: { items: typeof AVATARS }) {
  return (
    <span className="flex items-center">
      {items.slice(0, 6).map((a, i) => (
        <span
          key={a.label}
          className="flex size-[20px] items-center justify-center rounded-full border-2 border-surface text-[9px] font-semibold text-white"
          style={{ background: a.color, marginLeft: i === 0 ? 0 : -6, zIndex: 6 - i }}
          aria-label={a.label}
        />
      ))}
    </span>
  )
}

export function SectionHandbook() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[24px]">
        <Breadcrumb section="Company handbook" />
        <div className="ml-auto flex items-center gap-[8px]">
          <Button variant="secondary" height={28} icon={ExternalLink}>Preview as staff</Button>
          <Button variant="primary" height={28} icon={Edit}>New file</Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Company handbook</h1>
        <p className="mb-[24px] text-[13px] text-muted">
          What Sahabat Warga is, how it works and the rules. Every helper reads it before acting, and every person can read it in Docs.
        </p>

        {/* Company brief */}
        <div className="mb-[24px] rounded-lg border border-line-strong bg-surface p-[16px]">
          <div className="mb-[8px] flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-[0.8px] text-faint">Company brief</span>
            <button type="button" className="flex items-center gap-[4px] text-[12px] text-link hover:underline">
              <Edit size={12} aria-hidden /> Edit
            </button>
          </div>
          <p className="mb-[8px] text-[13px] text-ink">
            Sahabat Warga runs neighbourhood admin for 64 RTs in South Jakarta: monthly dues, cover letters, facility bookings and clean-up days. We serve residents first, RT heads second. We speak Bahasa Indonesia, warm and plain. We never share a resident's data outside their RT, and we never promise money we haven't approved...
          </p>
          <div className="flex items-center gap-[6px] text-[11px] text-muted">
            <span>5 drafts · you · 1 year ago</span>
          </div>
          <div className="mt-[12px] flex flex-wrap items-center gap-[8px] border-t border-line pt-[12px]">
            <span className="text-[12px] text-muted">Read by</span>
            <AvatarStack items={AVATARS} />
            <span className="text-[12px] text-muted">6 helpers</span>
            <span className="text-[12px] text-muted">and</span>
            <AvatarStack items={AVATARS.slice(0, 4)} />
            <span className="text-[12px] text-muted">4 people</span>
            <span className="ml-auto text-[11px] text-muted">Pinned in Docs · Company for everyone</span>
          </div>
        </div>

        {/* Files */}
        <p className="mb-[10px] text-[13px] font-medium text-ink">
          Handbook files <span className="font-normal text-muted">— Helpers suggest edits as they learn — nothing changes until you accept.</span>
        </p>
        <div className="grid grid-cols-2 gap-[10px]">
          {HANDBOOK_FILES.map((f) => (
            <button
              key={f.name}
              type="button"
              className="flex min-h-[80px] flex-col gap-[4px] rounded-lg border border-line-strong bg-surface p-[14px] text-left transition-colors hover:bg-soft"
            >
              <div className="flex items-start gap-[8px]">
                <span className="rounded-sm bg-info-tint px-[6px] py-[2px] font-mono text-[10.5px] text-info">{f.name}</span>
                {f.badge && (
                  <span className="rounded-pill bg-warn-tint px-[6px] py-[1px] text-[10px] text-warn">{f.badge}</span>
                )}
              </div>
              <span className="text-[12px] text-muted">{f.desc}</span>
              <span className="mt-auto text-[11px] text-faint">Everyone · 1d ago</span>
              <div className="ml-auto text-muted">
                <ArrowLeft size={12} className="rotate-180" aria-hidden />
              </div>
            </button>
          ))}
        </div>
      </SectionPane>
    </div>
  )
}
