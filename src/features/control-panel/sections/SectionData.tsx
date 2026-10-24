import { Download } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import {
  Breadcrumb,
  RowDivider,
  Rule,
  SectionPane,
  SelectField,
  SettingCardRows,
  SettingRow,
  SubHeading,
} from '../ControlPanelShared'

const STORAGE_TOTAL = 10
const STORAGE_USED = 3.7

const STORAGE_SEGMENTS = [
  { label: 'Attachments', value: 2.1, color: '#6366F1' },
  { label: 'Docs', value: 1.2, color: '#0EA5E9' },
  { label: 'Run logs', value: 0.34, color: '#F97316' },
  { label: 'Knowledge', value: 0.038, color: '#14B8A6' },
]

const EXPORTS = [
  {
    date: 'Full export · Oct 2',
    desc: 'Chats, docs, flows, knowledge · 3.4 GB zip · link expires in 5 days',
  },
]

export function SectionData() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Data & storage" />
        <div className="ml-auto">
          <Button variant="secondary" height={28} icon={Download}>Export everything</Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Data & storage</h1>
        <p className="mb-[24px] text-[13px] text-muted">What Omilo keeps, for how long, and how to take it with you.</p>

        {/* Storage bar */}
        <div className="mb-[24px] rounded-lg border border-line-strong bg-surface p-[16px]">
          <p className="mb-[4px] text-[28px] font-semibold text-ink">
            {STORAGE_USED} GB <span className="text-[16px] font-normal text-muted">of {STORAGE_TOTAL} GB</span>
          </p>
          {/* Segmented bar */}
          <div className="mb-[8px] h-[8px] overflow-hidden rounded-full bg-line-strong">
            <div className="flex h-full">
              {STORAGE_SEGMENTS.map((s) => (
                <div
                  key={s.label}
                  className="h-full"
                  style={{ width: `${(s.value / STORAGE_TOTAL) * 100}%`, background: s.color }}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-[12px]">
            {STORAGE_SEGMENTS.map((s) => (
              <span key={s.label} className="flex items-center gap-[4px] text-[11.5px] text-muted">
                <span className="size-[8px] rounded-full" style={{ background: s.color }} />
                {s.label} {s.value < 1 ? `${Math.round(s.value * 1000)} MB` : `${s.value} GB`}
              </span>
            ))}
          </div>
        </div>

        {/* Keep for */}
        <SubHeading label="Keep for" />
        <SettingCardRows>
          <SettingRow label="Chat history" desc="Archived chats are kept the same way.">
            <SelectField value="Forever" />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Flow run logs" desc="Inputs and outputs of every step.">
            <SelectField value="90 days" />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Activity log" desc="Who did what, for audits.">
            <SelectField value="1 year" />
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Exports */}
        <SubHeading label="Exports" />
        <div className="overflow-hidden rounded-lg border border-line-strong bg-surface">
          {EXPORTS.map((e) => (
            <div key={e.date} className="flex items-center gap-[12px] px-[16px] py-[12px]">
              <span className="flex size-[32px] shrink-0 items-center justify-center rounded-base border border-line-strong bg-soft text-[16px]">📦</span>
              <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="text-[13px] font-semibold text-ink">{e.date}</span>
                <span className="text-[12px] text-muted">{e.desc}</span>
              </div>
              <Button variant="secondary" height={28} icon={Download}>Download</Button>
            </div>
          ))}
        </div>
      </SectionPane>
    </div>
  )
}
