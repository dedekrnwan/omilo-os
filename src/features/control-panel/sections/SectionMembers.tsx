import { ChevronDown, Ellipsis, UserPlus } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane } from '../ControlPanelShared'
import type { DialogKind } from '../types'

const MEMBERS = [
  { initials: 'DK', color: '#FED7AA', textColor: '#9A3412', name: 'Dede Kurniawan', email: 'dede@saga.co.id', status: 'active now', channels: 'All channels', role: 'Owner', roleIcon: true },
  { initials: 'RA', color: '#E0E7FF', textColor: '#4338CA', name: 'Rina Ayu', email: 'rina@saga.co.id', status: 'active 2h ago', channels: 'All channels', role: 'Admin' },
  { initials: 'BY', color: '#CCFBF1', textColor: '#0F766E', name: 'Bayu Pratama', email: 'bayu@saga.co.id', status: 'active now', channels: 'Engineering, General', role: 'Member' },
  { initials: 'SN', color: '#FCE7F3', textColor: '#9D174D', name: 'Sari Nur', email: 'sari@saga.co.id', status: 'active Yesterday', channels: 'Marketing, General', role: 'Member' },
  { initials: null, color: '#F5F5F4', textColor: '#78716C', name: 'and@saga.co.id', email: 'Invite sent · expires in 6 days', status: null, channels: 'Business', role: 'Member', pending: true },
]

const ROLE_DESCRIPTIONS = [
  { role: 'Owner', desc: 'Everything, including billing and deleting the company.' },
  { role: 'Admin', desc: 'Settings, connectors and approving spend. No billing.' },
  { role: 'Member', desc: "Chat, goals and flows in their channels. Approves their own flows." },
  { role: 'Viewer', desc: "Reads goals, docs and runs. Can't approve or change anything. Free — doesn't use a seat." },
]

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionMembers({ onDialog }: Props) {
  const seats = 5
  const used = 4
  const pct = (used / seats) * 100

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Members & roles" />
        <div className="ml-auto">
          <Button variant="primary" height={28} icon={UserPlus} onClick={() => onDialog('invite')}>
            Invite people
          </Button>
        </div>
      </div>

      <SectionPane>
        <div className="mb-[24px] flex items-start justify-between">
          <div>
            <h1 className="m-0 font-display text-[28px] font-semibold text-ink">Members & roles</h1>
            <p className="mt-[4px] text-[13px] text-muted">People in Sahabat Warga and what they can approve.</p>
          </div>
        </div>

        {/* Seat bar */}
        <div className="mb-[20px] rounded-lg border border-line-strong bg-surface p-[16px]">
          <div className="mb-[8px] flex items-center gap-[8px]">
            <span className="text-[13px] font-medium text-ink">{used} of {seats} seats</span>
            <span className="rounded-pill bg-ok-tint px-[8px] py-[1px] text-[11px] font-medium text-ok">Full</span>
            <span className="text-[12px] text-muted">Team plan · {seats} included, up to 15</span>
            <div className="ml-auto flex flex-col items-end gap-[1px]">
              <Button variant="secondary" height={28} onClick={() => onDialog('add-seats')}>+ Add seats</Button>
              <span className="text-[11px] text-muted">Rp 150 rb / seat / month</span>
            </div>
          </div>
          <div className="h-[6px] overflow-hidden rounded-full bg-line-strong">
            <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-[6px] flex items-center gap-[16px] text-[11.5px] text-muted">
            <span className="flex items-center gap-[4px]"><span className="inline-block size-[6px] rounded-full bg-ink" />{used} people</span>
            <span className="flex items-center gap-[4px]"><span className="inline-block size-[6px] rounded-full bg-warn" />1 pending invite (holds a seat)</span>
            <span className="flex items-center gap-[4px]"><span className="inline-block size-[6px] rounded-full bg-line-strong" />Viewers are free · 0 of 20</span>
          </div>
        </div>

        {/* Table */}
        <div className="mb-[32px] overflow-hidden rounded-lg border border-line-strong bg-surface">
          {/* Header */}
          <div className="grid grid-cols-[1fr_180px_140px_32px] items-center border-b border-line bg-soft px-[16px] py-[8px] text-[11px] font-medium uppercase tracking-[0.8px] text-faint">
            <span>Person</span>
            <span>Channels</span>
            <span>Role</span>
            <span />
          </div>
          {MEMBERS.map((m, i) => (
            <div
              key={m.email}
              className={`grid grid-cols-[1fr_180px_140px_32px] items-center px-[16px] py-[10px] ${
                i < MEMBERS.length - 1 ? 'border-b border-line' : ''
              }`}
            >
              {/* Person */}
              <div className="flex items-center gap-[10px]">
                <span
                  className="flex size-[28px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{ background: m.color, color: m.textColor, opacity: m.pending ? 0.5 : 1 }}
                >
                  {m.initials ?? '?'}
                </span>
                <div>
                  <p className={`text-[13px] ${m.pending ? 'text-muted' : 'font-medium text-ink'}`}>{m.name}</p>
                  <p className="text-[11.5px] text-muted">{m.pending ? m.email : `${m.email} · ${m.status}`}</p>
                </div>
              </div>
              {/* Channels */}
              <span className="text-[12.5px] text-ink">{m.channels}</span>
              {/* Role */}
              <button type="button" className="flex items-center gap-[4px] text-[12.5px] text-ink">
                {m.roleIcon && <span aria-hidden className="text-ok">✓</span>}
                {m.role}
                {m.role !== 'Owner' && <ChevronDown size={12} className="text-muted" aria-hidden />}
              </button>
              {/* Actions */}
              <button type="button" aria-label="Member options" className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover">
                <Ellipsis size={14} aria-hidden />
              </button>
            </div>
          ))}
        </div>

        {/* Role descriptions */}
        <h2 className="mb-[12px] text-[15px] font-semibold text-ink">What each role can do</h2>
        <div className="grid grid-cols-4 gap-[12px]">
          {ROLE_DESCRIPTIONS.map((r) => (
            <div key={r.role} className="rounded-lg border border-line-strong bg-soft p-[12px]">
              <p className="mb-[4px] text-[13px] font-semibold text-ink">{r.role}</p>
              <p className="text-[12px] text-muted">{r.desc}</p>
            </div>
          ))}
        </div>
      </SectionPane>
    </div>
  )
}
